import type { Place } from '@/domain/types';
import { EstimateUnavailableError, createAiEstimator, postEstimate, type PostEstimateOptions } from './aiClient';
import { parseEstimateResponse } from './aiResponse';

const URL = 'https://estimate.test/api/estimate';

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
