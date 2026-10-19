import type { Place } from '@/domain/types';
import { EstimateUnavailableError, createAiEstimator, postEstimate, readEstimateUrl, type PostEstimateOptions } from './aiClient';
import { parseEstimateResponse } from './aiResponse';

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const session = vi.hoisted(() => ({
  configured: false,
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => null),
}));

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => session.configured,
  getAccessToken: () => session.getAccessToken(),
}));

const URL = 'https://estimate.test/api/estimate';
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/estimate`;
const PUBLISHABLE_KEY = 'sb_publishable_test_key';

/** The deployed app: Supabase configured, and signed in when a token is given. */
function deployed(token: string | null): void {
  vi.stubEnv('VITE_ESTIMATE_URL', '');
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', PUBLISHABLE_KEY);
  session.configured = true;
  session.getAccessToken.mockImplementation(async () => token);
}

const NASI_KANDAR: Place = {
  id: 'place-1',
  name: 'Nasi kandar near home',
  type: 'mamak',
  coords: { lat: 3.14, lng: 101.68 },
  defaultVariants: { 'rice-nasi-kandar': 2 },
  oilLevel: 'high',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const AI_BODY = {
  items: [
    {
      id: 'a1',
      name: 'Kuah campur',
      catalogueId: 'kuah-campur',
      unitMacros: { kcal: 220, proteinG: 3.7, carbsG: 12.8, fatG: 16.5 },
      quantity: 1,
      uncertainty: 0.2,
      source: 'catalogue',
    },
    { name: 'Durian crepe', unitMacros: { kcal: 380 }, source: 'aiGuess', question: 'Roughly how big was it?' },
  ],
  questions: [{ itemId: 'a1', question: 'Is there kuah under the rice?' }],
  unmatched: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sequentialIds(): () => string {
  let n = 0;
  return () => `gen-${(n += 1)}`;
}

function options(fetchImpl: typeof fetch, extra: Partial<PostEstimateOptions> = {}): PostEstimateOptions {
  return { url: URL, fetch: fetchImpl, isOnline: () => true, newId: sequentialIds(), ...extra };
}

/** A request that never answers until it's aborted. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

async function unavailableReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EstimateUnavailableError) return error.reason;
    throw error;
  }
  throw new Error('Expected the estimate to fail');
}

afterEach(() => {
  vi.unstubAllEnvs();
  session.configured = false;
  session.getAccessToken.mockReset();
  session.getAccessToken.mockImplementation(async () => null);
});

describe('postEstimate', () => {
  it('is unavailable when no endpoint is configured', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const fetchMock = vi.fn<typeof fetch>();
    expect(await unavailableReason(postEstimate({ text: 'teh tarik' }, { fetch: fetchMock }))).toBe('notConfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable offline without sending anything', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(await unavailableReason(postEstimate({ text: 'teh tarik' }, options(fetchMock, { isOnline: () => false })))).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts text as JSON with the Place defaults but nothing personal', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    await postEstimate(
      { text: 'nasi kandar ayam goreng', slot: 'dinner', placeId: NASI_KANDAR.id },
      options(fetchMock, {
        hints: {
          place: { type: 'mamak', defaultVariants: NASI_KANDAR.defaultVariants },
          candidates: [{ catalogueId: 'rice-nasi-kandar', selectedVariant: 2, quantity: 1, source: 'yourCorrection' }],
        },
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toEqual({
      text: 'nasi kandar ayam goreng',
      slot: 'dinner',
      place: { type: 'mamak', defaultVariants: { 'rice-nasi-kandar': 2 } },
      candidates: [{ catalogueId: 'rice-nasi-kandar', selectedVariant: 2, quantity: 1, source: 'yourCorrection' }],
    });
    expect(String(init?.body)).not.toContain('Nasi kandar near home');
  });

  it('posts a photo as multipart with the caption alongside', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    const photo = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
    await postEstimate({ photo, caption: 'kuah banjir' }, options(fetchMock));

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('photo')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(form.get('request')))).toEqual({ caption: 'kuah banjir' });
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('returns the parsed items marked as an AI estimate', async () => {
    const result = await postEstimate({ text: 'durian crepe' }, options(vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY))));

    expect(result.method).toBe('ai');
    expect(result.items.map((i) => [i.id, i.name, i.unitMacros.kcal, i.source])).toEqual([
      ['a1', 'Kuah campur', 220, 'catalogue'],
      ['gen-1', 'Durian crepe', 380, 'aiGuess'],
    ]);
    expect(result.questions).toEqual([{ itemId: 'a1', question: 'Is there kuah under the rice?' }]);
    expect(result.items[0]?.question).toBe('Is there kuah under the rice?');
    expect(result.items[1]?.question).toBeUndefined();
  });

  it('only trusts a catalogue source it can check, and never a correction or database claim', async () => {
    const body = {
      items: [
        { name: 'Kuah campur', catalogueId: 'kuah-campur', unitMacros: { kcal: 220 }, source: 'catalogue' },
        { name: 'Kuah campur', catalogueId: 'kuah-campur', unitMacros: { kcal: 999 }, source: 'catalogue' },
        { name: 'Rice', catalogueId: 'rice-nasi-kandar', unitMacros: { kcal: 430 }, source: 'yourCorrection' },
        { name: 'Nasi lemak', unitMacros: { kcal: 490 }, source: 'myfcd' },
        { name: 'Teh tarik', catalogueId: 'not-in-catalogue', unitMacros: { kcal: 200 }, source: 'catalogue' },
      ],
    };
    const result = await postEstimate({ text: 'x' }, options(vi.fn<typeof fetch>(async () => jsonResponse(body))));
    expect(result.items.map((i) => i.source)).toEqual(['catalogue', 'aiGuess', 'aiGuess', 'aiGuess', 'aiGuess']);
  });

  it.each([
    ['an HTTP error', async () => jsonResponse({ error: 'busy' }, 503), 'http'],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 }), 'badResponse'],
    ['a body without items', async () => jsonResponse({ ok: true }), 'badResponse'],
    ['a network failure', async () => Promise.reject(new TypeError('Failed to fetch')), 'network'],
  ] as const)('is unavailable on %s', async (_label, impl, reason) => {
    expect(await unavailableReason(postEstimate({ text: 'teh tarik' }, options(vi.fn<typeof fetch>(impl))))).toBe(reason);
  });

  it('keeps the HTTP status', async () => {
    const failing = postEstimate({ text: 'teh tarik' }, options(vi.fn<typeof fetch>(async () => jsonResponse({}, 502))));
    await expect(failing).rejects.toMatchObject({ reason: 'http', status: 502 });
  });

  it('times out', async () => {
    expect(await unavailableReason(postEstimate({ text: 'teh tarik' }, options(hangingFetch, { timeoutMs: 20 })))).toBe('timeout');
  });

  it('rejects with the abort reason when cancelled, not as unavailable', async () => {
    const controller = new AbortController();
    const pending = postEstimate({ text: 'teh tarik' }, options(hangingFetch, { signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toBeInstanceOf(EstimateUnavailableError);
  });

  it('reads the endpoint from VITE_ESTIMATE_URL', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', URL);
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    await postEstimate({ text: 'teh tarik' }, { fetch: fetchMock, isOnline: () => true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL);
  });
});

describe('readEstimateUrl', () => {
  it('prefers VITE_ESTIMATE_URL', () => {
    deployed('token');
    vi.stubEnv('VITE_ESTIMATE_URL', ' /api/estimate ');
    expect(readEstimateUrl()).toBe('/api/estimate');
  });

  it('falls back to the Supabase Edge Function when sign-in is configured', () => {
    deployed('token');
    expect(readEstimateUrl()).toBe(FUNCTION_URL);
    vi.stubEnv('VITE_SUPABASE_URL', `${SUPABASE_URL}/`);
    expect(readEstimateUrl()).toBe(FUNCTION_URL);
  });

  it('has no endpoint without either', () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
    expect(readEstimateUrl()).toBeUndefined();
  });
});

describe('postEstimate with sign-in', () => {
  it('sends the access token and the publishable key to the Edge Function', async () => {
    deployed('user-jwt');
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    const result = await postEstimate({ text: 'durian crepe' }, { fetch: fetchMock, isOnline: () => true });

    expect(result.method).toBe('ai');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(FUNCTION_URL);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer user-jwt');
    expect(headers.get('apikey')).toBe(PUBLISHABLE_KEY);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('sends them with a photo too, leaving the multipart Content-Type to the browser', async () => {
    deployed('user-jwt');
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    await postEstimate({ photo: new Blob(['jpeg'], { type: 'image/jpeg' }) }, { fetch: fetchMock, isOnline: () => true });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer user-jwt');
    expect(headers.get('apikey')).toBe(PUBLISHABLE_KEY);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('is unavailable as notSignedIn without a session, before anything is sent', async () => {
    deployed(null);
    const fetchMock = vi.fn<typeof fetch>();
    expect(await unavailableReason(postEstimate({ text: 'durian crepe' }, { fetch: fetchMock, isOnline: () => true }))).toBe('notSignedIn');
    expect(session.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports offline without asking for a token', async () => {
    deployed('user-jwt');
    const fetchMock = vi.fn<typeof fetch>();
    expect(await unavailableReason(postEstimate({ text: 'durian crepe' }, { fetch: fetchMock, isOnline: () => false }))).toBe('offline');
    expect(session.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'notSignedIn'],
    [403, 'forbidden'],
  ] as const)('maps a %i from the server to %s', async (status, reason) => {
    deployed('expired-jwt');
    const failing = postEstimate({ text: 'durian crepe' }, { fetch: vi.fn<typeof fetch>(async () => jsonResponse({ error: 'no' }, status)), isOnline: () => true });
    await expect(failing).rejects.toMatchObject({ reason, status });
  });

  it('treats a session that cannot be refreshed as a network failure, not a sign-out', async () => {
    deployed(null);
    session.getAccessToken.mockImplementation(async () => Promise.reject(new TypeError('Failed to fetch')));
    const fetchMock = vi.fn<typeof fetch>();
    expect(await unavailableReason(postEstimate({ text: 'durian crepe' }, { fetch: fetchMock, isOnline: () => true }))).toBe('network');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets Cancel and the timeout stop a token refresh that hangs', async () => {
    deployed(null);
    session.getAccessToken.mockImplementation(() => new Promise<string | null>(() => {}));
    const fetchMock = vi.fn<typeof fetch>();

    const controller = new AbortController();
    const cancelled = postEstimate({ text: 'teh tarik' }, { fetch: fetchMock, isOnline: () => true, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    expect(await unavailableReason(postEstimate({ text: 'teh tarik' }, { fetch: fetchMock, isOnline: () => true, timeoutMs: 20 }))).toBe('timeout');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes an explicit auth over the session', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    await postEstimate({ text: 'teh tarik' }, options(fetchMock, { auth: { getAccessToken: async () => 'given', apiKey: 'key' } }));
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer given');
    expect(headers.get('apikey')).toBe('key');
  });

  it('in local dev without Supabase, calls /api/estimate with no auth headers', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '/api/estimate');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_KEY', '');
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    const result = await postEstimate({ text: 'durian crepe' }, { fetch: fetchMock, isOnline: () => true });

    expect(result.method).toBe('ai');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/estimate');
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('apikey')).toBe(false);
    expect(session.getAccessToken).not.toHaveBeenCalled();
  });
});

describe('createAiEstimator', () => {
  it("sends the Place's type and defaults, never its name or location", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_BODY));
    await createAiEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate(
      { text: 'nasi kandar' },
      { place: NASI_KANDAR, personal: [] },
    );
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ place: { type: 'mamak', defaultVariants: { 'rice-nasi-kandar': 2 }, oilLevel: 'high' } });
    expect(body).not.toContain('Nasi kandar near home');
    expect(body).not.toContain('101.68');
  });
});

describe('parseEstimateResponse', () => {
  it('drops malformed items and fills safe defaults', () => {
    const result = parseEstimateResponse(
      {
        items: [
          { name: 'Teh tarik', unitMacros: { kcal: 200 }, quantity: -1, uncertainty: 4, source: 'made-up' },
          { name: '', unitMacros: { kcal: 100 } },
          { name: 'No macros' },
          'not an item',
        ],
        unmatched: ['plugh', 3],
      },
      sequentialIds(),
    );
    expect(result.items).toEqual([
      {
        id: 'gen-1',
        name: 'Teh tarik',
        unitMacros: { kcal: 200, proteinG: 0, carbsG: 0, fatG: 0 },
        quantity: 1,
        uncertainty: 0.25,
        source: 'aiGuess',
      },
    ]);
    expect(result.unmatched).toEqual(['plugh']);
  });

  it('caps questions at two and keeps item ids unique', () => {
    const item = (q: string) => ({ id: 'same', name: q, unitMacros: { kcal: 300 }, question: q });
    const result = parseEstimateResponse({ items: [item('One?'), item('Two?'), item('Three?')] }, sequentialIds());
    expect(new Set(result.items.map((i) => i.id)).size).toBe(3);
    expect(result.questions.map((q) => q.question)).toEqual(['One?', 'Two?']);
    expect(result.items.filter((i) => i.question)).toHaveLength(2);
  });

  it('accepts an empty estimate (nothing recognisable in a photo)', () => {
    expect(parseEstimateResponse({ items: [] }, sequentialIds())).toEqual({ items: [], questions: [], unmatched: [], method: 'ai' });
  });

  it('keeps valid chips and a selected chip in range only', () => {
    const [item] = parseEstimateResponse(
      {
        items: [
          {
            name: 'Rice',
            unitMacros: { kcal: 330 },
            variants: [{ id: 'small', label: 'Small', macros: { kcal: 250 } }, { label: 'broken' }],
            selectedVariant: 3,
          },
        ],
      },
      sequentialIds(),
    ).items;
    expect(item?.variants?.map((v) => v.label)).toEqual(['Small']);
    expect(item?.selectedVariant).toBeUndefined();
  });
});
