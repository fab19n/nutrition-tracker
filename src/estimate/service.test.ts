import type { Place } from '@/domain/types';
import { estimateMeal, getEstimator, needsAi, withPendingEstimates } from './service';
import type { EstimateResult } from './types';

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

/** Fully matched by the local estimator: five catalogue items, nothing unmatched. */
const NASI_KANDAR = 'nasi kandar ayam goreng, kubis, kuah campur, teh o ais';

const AI_RESULT = {
  items: [{ id: 'ai-1', name: 'Durian crepe', unitMacros: { kcal: 380, proteinG: 6, carbsG: 50, fatG: 17 }, source: 'aiGuess' }],
  questions: [],
  unmatched: [],
};

const KEDAI: Place = { id: 'kedai', name: 'Kedai near home', type: 'economyRice', defaultVariants: {}, createdAt: '2026-10-01T00:00:00.000Z' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sequentialIds(): () => string {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

function aiFetch() {
  return vi.fn<typeof fetch>(async () => jsonResponse(AI_RESULT));
}

const offlineFetch = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch')));

/** The deployed app: Supabase configured (the Edge Function is the endpoint), signed in with a token. */
function deployed(token: string | null): void {
  vi.stubEnv('VITE_ESTIMATE_URL', '');
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  session.configured = true;
  session.getAccessToken.mockImplementation(async () => token);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  offlineFetch.mockClear();
  session.configured = false;
  session.getAccessToken.mockReset();
  session.getAccessToken.mockImplementation(async () => null);
});

describe('getEstimator without an endpoint', () => {
  it('estimates locally and never calls the network when VITE_ESTIMATE_URL is unset', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getEstimator().estimate({ text: 'teh tarik kurang manis' }, { personal: [] });
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('notConfigured');
    expect(result.items.map((i) => i.catalogueId)).toEqual(['teh-tarik']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps unknown food as a local guess, not pending: there is no AI to wait for', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.items.map((i) => [i.source, i.pendingEstimate])).toEqual([['aiGuess', undefined]]);
  });

  it('holds a photo as one pending "Meal from photo"', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const result = await getEstimator({ newId: sequentialIds() }).estimate({ photo: new Blob(['jpeg']) }, { personal: [] });
    expect(result.items).toMatchObject([{ id: 'id-1', name: 'Meal from photo', source: 'aiGuess', pendingEstimate: true }]);
    expect(result.aiSkipped).toBe('notConfigured');
  });

  it('reads a photo caption it recognises instead', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const result = await estimateMeal({ photo: new Blob(['jpeg']), caption: 'teh tarik' }, { personal: [] });
    expect(result.items.map((i) => [i.catalogueId, i.pendingEstimate])).toEqual([['teh-tarik', undefined]]);
  });
});

describe("mode 'off'", () => {
  it('never calls the endpoint, even for food it cannot match', async () => {
    const fetchMock = aiFetch();
    const estimator = getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true, mode: 'off' });
    const result = await estimator.estimate({ text: 'durian crepe' }, { personal: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('off');
    expect(result.items.map((i) => [i.name, i.source, i.pendingEstimate])).toEqual([['Durian crepe', 'aiGuess', undefined]]);
  });

  it('keeps a photo as a pending "Meal from photo" without sending it', async () => {
    const fetchMock = aiFetch();
    const estimator = getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true, mode: 'off', newId: sequentialIds() });
    const result = await estimator.estimate({ photo: new Blob(['jpeg']) }, { personal: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toMatchObject([{ name: 'Meal from photo', pendingEstimate: true }]);
    expect(result.aiSkipped).toBe('off');
  });

  it('works through estimateMeal with a signed-in session too', async () => {
    deployed('user-jwt');
    const fetchSpy = aiFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] }, { mode: 'off' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.aiSkipped).toBe('off');
    expect(session.getAccessToken).not.toHaveBeenCalled();
  });
});

describe("mode 'auto' (the default)", () => {
  it('skips the AI when the local estimator matched everything', async () => {
    const fetchMock = aiFetch();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate({ text: NASI_KANDAR }, { personal: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('notNeeded');
    expect(result.items).toHaveLength(5);
    expect(result.items.every((i) => i.source !== 'aiGuess')).toBe(true);
  });

  it('calls the AI for food it cannot match', async () => {
    const fetchMock = aiFetch();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true, mode: 'auto' }).estimate(
      { text: 'durian crepe' },
      { personal: [] },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('ai');
    expect(result.aiSkipped).toBeUndefined();
    expect(result.items.map((i) => i.name)).toEqual(['Durian crepe']);
  });

  it('uses the AI estimate and sends the local matches as candidates', async () => {
    const fetchMock = aiFetch();
    const estimator = getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true, newId: sequentialIds() });

    const result = await estimator.estimate({ text: 'nasi, durian crepe' }, { place: KEDAI, personal: [] });
    expect(result.method).toBe('ai');
    expect(result.items.map((i) => i.name)).toEqual(['Durian crepe']);
    const body: unknown = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      place: { type: 'economyRice' },
      candidates: [{ catalogueId: 'rice-economy', selectedVariant: 1, quantity: 1, source: 'catalogue' }],
    });
  });

  it('always sends a photo, which cannot be read offline', async () => {
    const fetchMock = aiFetch();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate(
      { photo: new Blob(['jpeg']), caption: 'teh tarik' },
      { personal: [] },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('ai');
  });

  it('reads the endpoint from VITE_ESTIMATE_URL', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', URL);
    const fetchMock = aiFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.method).toBe('ai');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL);
  });

  it('marks guesses as waiting for the AI when offline and nothing matched', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const estimator = getEstimator({ url: URL, fetch: fetchMock, isOnline: () => false });
    const result = await estimator.estimate({ text: 'durian crepe' }, { personal: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('offline');
    expect(result.items.map((i) => [i.name, i.source, i.pendingEstimate])).toEqual([['Durian crepe', 'aiGuess', true]]);
  });

  it('keeps local guesses as they are when part of the meal matched', async () => {
    const estimator = getEstimator({ url: URL, isOnline: () => false });
    const result = await estimator.estimate({ text: 'teh tarik, durian crepe' }, { personal: [] });
    expect(result.aiSkipped).toBe('offline');
    expect(result.items.some((i) => i.pendingEstimate)).toBe(false);
  });

  it('always sends a nutrition label photo, even on its own', async () => {
    const fetchMock = aiFetch();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate(
      { label: new Blob(['jpeg']), caption: '1 tbsp' },
      { personal: [] },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('ai');
  });

  it('holds a label-only meal as one pending item when offline', async () => {
    const estimator = getEstimator({ url: URL, isOnline: () => false, newId: sequentialIds() });
    const result = await estimator.estimate({ label: new Blob(['jpeg']) }, { personal: [] });
    expect(result.items).toMatchObject([{ id: 'id-1', name: 'Meal from photo', pendingEstimate: true }]);
  });

  it('holds a photo-only meal as one pending item when offline', async () => {
    const estimator = getEstimator({ url: URL, isOnline: () => false, newId: sequentialIds() });
    const result = await estimator.estimate({ photo: new Blob(['jpeg']) }, { personal: [] });
    expect(result.items).toMatchObject([{ id: 'id-1', name: 'Meal from photo', source: 'aiGuess', pendingEstimate: true }]);
  });

  it('does not call the endpoint for an empty request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate({ text: '  ' }, { personal: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.aiSkipped).toBe('notNeeded');
  });
});

describe("mode 'always'", () => {
  it('calls the AI even when the local estimator matched everything', async () => {
    const fetchMock = aiFetch();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true, mode: 'always' }).estimate(
      { text: NASI_KANDAR },
      { personal: [] },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('ai');
  });

  it('is what estimateMeal uses when asked', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', URL);
    const fetchMock = aiFetch();
    vi.stubGlobal('fetch', fetchMock);
    const result = await estimateMeal({ text: NASI_KANDAR }, { personal: [] }, { mode: 'always' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('ai');
  });

  it('falls back to the local estimate when the endpoint fails', async () => {
    const estimator = getEstimator({ url: URL, fetch: offlineFetch, isOnline: () => true, mode: 'always' });
    const result = await estimator.estimate({ text: NASI_KANDAR }, { personal: [] });

    expect(offlineFetch).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('network');
    expect(result.items).toHaveLength(5);
    expect(result.items.some((i) => i.pendingEstimate)).toBe(false);
  });

  it('falls back on a server error too', async () => {
    const failing = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'busy' }, 503));
    const result = await getEstimator({ url: URL, fetch: failing, isOnline: () => true, mode: 'always' }).estimate(
      { text: 'teh tarik' },
      { personal: [] },
    );
    expect(failing).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('http');
  });

  it('does not fall back after a Cancel', async () => {
    const controller = new AbortController();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const pending = getEstimator({ url: URL, fetch: hanging, isOnline: () => true, mode: 'always' }).estimate(
      { text: 'teh tarik' },
      { personal: [] },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('sign-in', () => {
  it('sends the session token to the Edge Function when a meal needs the AI', async () => {
    deployed('user-jwt');
    const fetchMock = aiFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.method).toBe('ai');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/estimate`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt');
  });

  it('falls back locally with notSignedIn, sending nothing, when signed out', async () => {
    deployed(null);
    const fetchMock = aiFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('notSignedIn');
    expect(result.items.map((i) => i.name)).toEqual(['Durian crepe']);
  });

  it('does not need a session for a meal the local estimator matched', async () => {
    deployed(null);
    const result = await estimateMeal({ text: NASI_KANDAR }, { personal: [] });
    expect(session.getAccessToken).not.toHaveBeenCalled();
    expect(result.aiSkipped).toBe('notNeeded');
  });

  it('reads a 401 from the server as notSignedIn', async () => {
    deployed('expired-jwt');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => jsonResponse({ error: 'unauthorized' }, 401)));
    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.method).toBe('local');
    expect(result.aiSkipped).toBe('notSignedIn');
  });

  it('reads a 403 from the server as forbidden', async () => {
    deployed('someone-else');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => jsonResponse({ error: 'forbidden' }, 403)));
    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.aiSkipped).toBe('forbidden');
  });
});

describe('needsAi', () => {
  const local = (text: string) => getEstimator({ mode: 'off' }).estimate({ text }, { personal: [] });

  it('is false for a fully matched meal and an empty request', async () => {
    expect(needsAi({ text: NASI_KANDAR }, await local(NASI_KANDAR))).toBe(false);
    expect(needsAi({ text: ' ' }, await local(' '))).toBe(false);
  });

  it('is true for unknown food, unmatched words and photos', async () => {
    expect(needsAi({ text: 'durian crepe' }, await local('durian crepe'))).toBe(true);
    expect(needsAi({ text: 'teh tarik, durian crepe' }, await local('teh tarik, durian crepe'))).toBe(true);
    expect(needsAi({ text: 'yesterday at the office' }, await local('yesterday at the office'))).toBe(true);
    expect(needsAi({ photo: new Blob(['jpeg']) }, { items: [], questions: [], unmatched: [], method: 'local' })).toBe(true);
  });
});

describe('withPendingEstimates', () => {
  const empty: EstimateResult = { items: [], questions: [], unmatched: [], method: 'local' };

  it('leaves an empty text result empty', () => {
    expect(withPendingEstimates(empty, { text: '' }, sequentialIds())).toEqual(empty);
  });
});
