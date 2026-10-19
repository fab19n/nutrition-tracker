import type { Place } from '@/domain/types';
import { estimateMeal, getEstimator, withPendingEstimates } from './service';
import type { EstimateResult } from './types';

const URL = 'https://estimate.test/api/estimate';

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

const offlineFetch = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch')));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  offlineFetch.mockClear();
});

describe('getEstimator without an endpoint', () => {
  it('estimates locally and never calls the network when VITE_ESTIMATE_URL is unset', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getEstimator().estimate({ text: 'teh tarik kurang manis' }, { personal: [] });
    expect(result.method).toBe('local');
    expect(result.items.map((i) => i.catalogueId)).toEqual(['teh-tarik']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps unknown food as a local guess, not pending: there is no AI to wait for', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.items.map((i) => [i.source, i.pendingEstimate])).toEqual([['aiGuess', undefined]]);
  });
});

describe('getEstimator with an endpoint', () => {
  it('uses the AI estimate and sends the local matches as candidates', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_RESULT));
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

  it('reads the endpoint from VITE_ESTIMATE_URL', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', URL);
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(AI_RESULT));
    vi.stubGlobal('fetch', fetchMock);

    const result = await estimateMeal({ text: 'durian crepe' }, { personal: [] });
    expect(result.method).toBe('ai');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL);
  });

  it('falls back to the local estimate when the endpoint fails', async () => {
    const estimator = getEstimator({ url: URL, fetch: offlineFetch, isOnline: () => true });
    const result = await estimator.estimate({ text: 'nasi kandar ayam goreng, kubis, kuah campur, teh o ais' }, { personal: [] });

    expect(offlineFetch).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('local');
    expect(result.items).toHaveLength(5);
    expect(result.items.some((i) => i.pendingEstimate)).toBe(false);
  });

  it('falls back on a server error too', async () => {
    const failing = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'busy' }, 503));
    const result = await getEstimator({ url: URL, fetch: failing, isOnline: () => true }).estimate({ text: 'teh tarik' }, { personal: [] });
    expect(result.method).toBe('local');
  });

  it('marks guesses as waiting for the AI when offline and nothing matched', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const estimator = getEstimator({ url: URL, fetch: fetchMock, isOnline: () => false });
    const result = await estimator.estimate({ text: 'durian crepe' }, { personal: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.method).toBe('local');
    expect(result.items.map((i) => [i.name, i.source, i.pendingEstimate])).toEqual([['Durian crepe', 'aiGuess', true]]);
  });

  it('keeps local guesses as they are when part of the meal matched', async () => {
    const estimator = getEstimator({ url: URL, isOnline: () => false });
    const result = await estimator.estimate({ text: 'teh tarik, durian crepe' }, { personal: [] });
    expect(result.items.some((i) => i.pendingEstimate)).toBe(false);
  });

  it('holds a photo-only meal as one pending item', async () => {
    const estimator = getEstimator({ url: URL, isOnline: () => false, newId: sequentialIds() });
    const result = await estimator.estimate({ photo: new Blob(['jpeg']) }, { personal: [] });
    expect(result.items).toMatchObject([{ id: 'id-1', name: 'Meal from photo', source: 'aiGuess', pendingEstimate: true }]);
  });

  it('does not call the endpoint for an empty request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await getEstimator({ url: URL, fetch: fetchMock, isOnline: () => true }).estimate({ text: '  ' }, { personal: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });

  it('does not fall back after a Cancel', async () => {
    const controller = new AbortController();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const pending = getEstimator({ url: URL, fetch: hanging, isOnline: () => true }).estimate(
      { text: 'teh tarik' },
      { personal: [] },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('withPendingEstimates', () => {
  const empty: EstimateResult = { items: [], questions: [], unmatched: [], method: 'local' };

  it('leaves an empty text result empty', () => {
    expect(withPendingEstimates(empty, { text: '' }, sequentialIds())).toEqual(empty);
  });
});
