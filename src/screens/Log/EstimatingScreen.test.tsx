import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { storePhoto } from '@/db/logging';
import { DEMO_IDS } from '@/db/seed/demo';
import { now } from '@/domain/clock';
import type { EstimateMealOptions } from '@/estimate/service';
import type { EstimateContext, EstimateRequest, EstimateResult } from '@/estimate/types';
import { resetUiState, useUiStore } from '@/state/ui';
import { photoDraft, textDraft } from './drafts';
import { PENDING_ESTIMATE_HINT, ROUGH_GUESS_HINT } from '@/components/ReviewItemRow/ReviewItemRow';
import { SIGN_IN_HINT, SLOW_AFTER_MS, resetSignInHint } from './EstimatingScreen';
import { initialContext, timeSettings } from './mealTime';
import { renderLogRoutes } from './testHarness';

type EstimateFn = (req: EstimateRequest, ctx: EstimateContext, opts?: EstimateMealOptions) => Promise<EstimateResult>;

/** Lets a test stand in for the estimator; the real one runs otherwise. */
const override = vi.hoisted(() => ({ estimate: null as EstimateFn | null }));

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const session = vi.hoisted(() => ({
  configured: false,
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => null),
}));

vi.mock('@/estimate/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/estimate/service')>();
  return {
    ...actual,
    estimateMeal: (req: EstimateRequest, ctx: EstimateContext, opts?: EstimateMealOptions) =>
      override.estimate ? override.estimate(req, ctx, opts) : actual.estimateMeal(req, ctx, opts),
  };
});

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => session.configured,
  getAccessToken: () => session.getAccessToken(),
}));

/** The deployed app: the Supabase Edge Function is the endpoint; signed in when a token is given. */
function deployed(token: string | null): void {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  session.configured = true;
  session.getAccessToken.mockImplementation(async () => token);
}

const AI_RESULT = {
  items: [{ id: 'ai-1', name: 'Durian crepe', unitMacros: { kcal: 380, proteinG: 6, carbsG: 50, fatG: 17 }, source: 'aiGuess' }],
  questions: [],
  unmatched: [],
};

function aiFetch() {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(AI_RESULT), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(async () => {
  override.estimate = null;
  // No endpoint unless a test sets one, whatever .env.local says.
  vi.stubEnv('VITE_ESTIMATE_URL', '');
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_KEY', '');
  resetSignInHint();
  await resetAll();
  await loadDemoData();
  resetUiState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  session.configured = false;
  session.getAccessToken.mockReset();
  session.getAccessToken.mockImplementation(async () => null);
});

function context(placeId?: string) {
  const ctx = initialContext(now(), timeSettings(undefined));
  return placeId ? { ...ctx, placeId } : ctx;
}

describe('S10 Estimating', () => {
  it('sends a direct visit with no draft to Today', async () => {
    renderLogRoutes(PATHS.estimating);
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
  });

  it('reads the text with the Place and your corrections, then replaces itself with Review', async () => {
    const seen: { req?: EstimateRequest; ctx?: EstimateContext } = {};
    const actual = await vi.importActual<typeof import('@/estimate/service')>('@/estimate/service');
    override.estimate = (req, ctx, opts) => {
      seen.req = req;
      seen.ctx = ctx;
      return actual.estimateMeal(req, ctx, opts);
    };
    useUiStore.getState().setReviewDraft(textDraft('roti canai, teh tarik', context(DEMO_IDS.places.nasiKandar)));
    const { router } = renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.review);
    expect(seen.req?.text).toBe('roti canai, teh tarik');
    expect(seen.ctx?.place?.id).toBe(DEMO_IDS.places.nasiKandar);
    expect(seen.ctx?.personal.length).toBe(3);
    expect(useUiStore.getState().reviewDraft?.items.map((i) => i.name)).toEqual(['Roti canai', 'Teh tarik']);
  });

  it('shows the typed text, skeleton rows and Still working after 6 s, and Cancel goes back to Log', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let aborted = false;
    override.estimate = (_req, _ctx, opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('cancelled', 'AbortError'));
        });
      });
    useUiStore.getState().setLogText('mee goreng mamak');
    useUiStore.getState().setReviewDraft(textDraft('mee goreng mamak', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Reading your meal' })).toBeInTheDocument();
    expect(screen.getByText('“mee goreng mamak”')).toBeInTheDocument();
    expect(screen.getByText('Estimating… matching to your library and MyFCD')).toBeInTheDocument();
    expect(screen.getByText('Estimating your meal')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 100);
    });
    expect(screen.getByText('Still working…')).toBeInTheDocument();

    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(aborted).toBe(true);
    // Back on Today with the Log sheet open and the text still there.
    expect(await screen.findByRole('heading', { name: /Today screen \/\?sheet=log/ })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'What did you eat?' })).toHaveValue('mee goreng mamak');
  });

  it('Cancel brings the Log sheet back with the Place, time and slot the estimate started with', async () => {
    override.estimate = (_req, _ctx, opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      });
    // The check-in's "Let me add it": last night's dinner time, at a Place picked in the sheet.
    const lastNight = '2026-10-15T13:00:00.000Z';
    const ctx = { ...initialContext(now(), timeSettings(undefined), lastNight), placeId: DEMO_IDS.places.nasiKandar };
    useUiStore.getState().setLogText('nasi lemak');
    useUiStore.getState().setReviewDraft(textDraft('nasi lemak', ctx));
    const { router } = renderLogRoutes(PATHS.estimating);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log a meal' });
    expect(router.state.location.search).toContain('sheet=log');
    expect(await within(sheet).findByRole('button', { name: /^Time:\s*Last night 9:00pm$/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Place:\s*Nasi kandar near home/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Meal:\s*Dinner$/ })).toBeInTheDocument();
    expect(useUiStore.getState().logResume).toBeNull();

    // Estimating again keeps last night's time, so the meal lands on Thursday.
    await user.click(within(sheet).getByRole('button', { name: 'Estimate' }));
    expect(useUiStore.getState().reviewDraft?.meta).toMatchObject({ eatenAt: lastNight, placeId: DEMO_IDS.places.nasiKandar, slot: 'dinner' });
  });

  it('turns a photo it cannot read yet into a pending "Meal from photo"', async () => {
    const photoId = await storePhoto(db, new Blob(['jpeg'], { type: 'image/jpeg' }), new Blob(['jpg'], { type: 'image/jpeg' }));
    useUiStore.getState().setReviewDraft(photoDraft(photoId, '', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Meal from photo' })).toBeInTheDocument();
    // Online without an AI endpoint nothing re-runs by itself, so the hint doesn't promise it.
    expect(screen.getByText(ROUGH_GUESS_HINT)).toBeInTheDocument();
    expect(screen.queryByText(PENDING_ESTIMATE_HINT)).toBeNull();
    expect(useUiStore.getState().reviewDraft?.items[0]?.pendingEstimate).toBe(true);
  });

  it('says the estimate runs once back online when the photo was taken offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const photoId = await storePhoto(db, new Blob(['jpeg'], { type: 'image/jpeg' }), new Blob(['jpg'], { type: 'image/jpeg' }));
    useUiStore.getState().setReviewDraft(photoDraft(photoId, '', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByText(PENDING_ESTIMATE_HINT)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe('S47 estimate failed', () => {
  it('keeps the text and offers try again, your library or your own kcal', async () => {
    const user = userEvent.setup();
    let calls = 0;
    override.estimate = async () => {
      calls += 1;
      throw new Error('server down');
    };
    useUiStore.getState().setReviewDraft(textDraft('nasi goreng pattaya', context()));
    renderLogRoutes(PATHS.estimating);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Couldn't estimate this right now." })).toBeInTheDocument();
    expect(screen.getByText('“nasi goreng pattaya”')).toBeInTheDocument();
    expect(calls).toBe(1);

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Enter kcal yourself' }));
    const sheet = await screen.findByRole('dialog', { name: 'Enter kcal yourself' });
    expect(within(sheet).getByLabelText('What was it?')).toHaveValue('nasi goreng pattaya');
    await user.type(within(sheet).getByLabelText('kcal'), '720');
    await user.click(within(sheet).getByRole('button', { name: 'Add to review' }));

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Nasi goreng pattaya' })).toBeInTheDocument();
    expect(screen.getByText('720 kcal')).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.meta.text).toBe('nasi goreng pattaya');
  });

  it('starts your own kcal with the text cut to 60 characters, never half an emoji', async () => {
    const user = userEvent.setup();
    override.estimate = async () => {
      throw new Error('server down');
    };
    useUiStore.getState().setReviewDraft(textDraft(`${'a'.repeat(59)}🍜🍜 malam`, context()));
    renderLogRoutes(PATHS.estimating);

    await user.click(await screen.findByRole('button', { name: 'Enter kcal yourself' }));
    const sheet = await screen.findByRole('dialog', { name: 'Enter kcal yourself' });
    expect(within(sheet).getByLabelText('What was it?')).toHaveValue(`${'a'.repeat(59)}🍜`);
  });

  it('fails in place when nothing in the text is food, and lets you pick from your library', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft(textDraft('yesterday at the office', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pick from your library' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pick from your library' });
    const box = within(sheet).getByRole('searchbox', { name: 'Search food' });
    await user.clear(box);
    await user.type(box, 'roti canai');
    await user.click(await within(sheet).findByRole('button', { name: /^Roti canai\s*·/ }));

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Roti canai' })).toBeInTheDocument();
  });
});

describe('S10 AI estimates setting and sign-in', () => {
  it("passes the profile's AI estimates setting to the estimator", async () => {
    await db.profile.update('me', { aiEstimates: 'off' });
    const modes: (string | undefined)[] = [];
    const actual = await vi.importActual<typeof import('@/estimate/service')>('@/estimate/service');
    override.estimate = (req, ctx, opts) => {
      modes.push(opts?.mode);
      return actual.estimateMeal(req, ctx, opts);
    };
    useUiStore.getState().setReviewDraft(textDraft('teh tarik', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(modes).toEqual(['off']);
  });

  it("with 'off', never sends a meal even when signed in", async () => {
    await db.profile.update('me', { aiEstimates: 'off' });
    deployed('user-jwt');
    const fetchSpy = aiFetch();
    vi.stubGlobal('fetch', fetchSpy);
    useUiStore.getState().setReviewDraft(textDraft('durian crepe', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useUiStore.getState().reviewDraft?.items.map((i) => i.name)).toEqual(['Durian crepe']);
  });

  it("with 'always', sends even a fully matched meal, with the session token", async () => {
    await db.profile.update('me', { aiEstimates: 'always' });
    deployed('user-jwt');
    const fetchSpy = aiFetch();
    vi.stubGlobal('fetch', fetchSpy);
    useUiStore.getState().setReviewDraft(textDraft('teh tarik', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://abcdefgh.supabase.co/functions/v1/estimate');
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer user-jwt');
    expect(useUiStore.getState().reviewDraft?.items.map((i) => i.name)).toEqual(['Durian crepe']);
  });

  it('says once per session to sign in when a meal needed the AI and nobody is signed in', async () => {
    deployed(null);
    const fetchSpy = aiFetch();
    vi.stubGlobal('fetch', fetchSpy);
    useUiStore.getState().setReviewDraft(textDraft('durian crepe', context()));
    const first = renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(await screen.findByText(SIGN_IN_HINT)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The local guess is still there to adjust.
    expect(useUiStore.getState().reviewDraft?.items.map((i) => [i.name, i.source])).toEqual([['Durian crepe', 'aiGuess']]);
    first.unmount();

    // The next meal that needs the AI goes through quietly.
    resetUiState();
    useUiStore.getState().setReviewDraft(textDraft('kuih ketayap pandan', context()));
    renderLogRoutes(PATHS.estimating);
    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(useUiStore.getState().toast).toBeNull();
    expect(screen.queryByText(SIGN_IN_HINT)).toBeNull();
  });

  it('says nothing about signing in for a meal the local estimator matched', async () => {
    deployed(null);
    useUiStore.getState().setReviewDraft(textDraft('nasi kandar ayam goreng, kubis, kuah campur, teh o ais', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.items).toHaveLength(5);
    expect(session.getAccessToken).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('keeps a photo as a pending "Meal from photo" and hints at signing in', async () => {
    // The session lookup can keep S10 up long enough to show the photo, and the stored test
    // photo isn't a real Blob after fake-indexeddb's clone, so object URLs are stubbed.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:meal-photo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    deployed(null);
    const fetchSpy = aiFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const photoId = await storePhoto(db, new Blob(['jpeg'], { type: 'image/jpeg' }), new Blob(['jpg'], { type: 'image/jpeg' }));
    useUiStore.getState().setReviewDraft(photoDraft(photoId, '', context()));
    renderLogRoutes(PATHS.estimating);

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Meal from photo' })).toBeInTheDocument();
    expect(await screen.findByText(SIGN_IN_HINT)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useUiStore.getState().reviewDraft?.items[0]?.pendingEstimate).toBe(true);
  });
});
