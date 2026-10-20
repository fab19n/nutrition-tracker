import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import type { MealLog } from '@/domain/types';
import { resetUiState, useUiStore } from '@/state/ui';
import DiaryDayScreen from './DiaryDayScreen';

const SLOW = { timeout: 4000 };

// The meal badge reads the sync engine's phase; the engine itself never runs in these tests.
const syncEngine = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: import('@/sync').EngineState } = { state: { phase: 'starting' } };
  return {
    current,
    listeners,
    set(state: import('@/sync').EngineState) {
      current.state = state;
      for (const listener of [...listeners]) listener();
    },
  };
});
vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  getEngineState: () => syncEngine.current.state,
  subscribeEngine: (listener: () => void) => {
    syncEngine.listeners.add(listener);
    return () => syncEngine.listeners.delete(listener);
  },
}));

/** This device synced with an account, and the meal is still queued to go there. */
async function queueForSync(mealId: string) {
  await db.syncMeta.put({
    id: 'sync',
    link: { userId: 'user-1', dataset: 'dataset-1', deviceId: 'device-1', cursor: 0, protocol: 1, linkedAt: 0 },
  });
  await db.syncOutbox.put({ table: 'meals', key: mealId, changedAt: 1, nonce: 'nonce-1' });
}

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

function renderDiary(url = '/diary') {
  const router = createMemoryRouter(
    [
      { path: '/diary', element: <DiaryDayScreen /> },
      { path: '/diary/week', element: <Probe name="Week" /> },
      { path: '/diary/entry/:id', element: <Probe name="Entry" /> },
      { path: '/more/weight', element: <Probe name="Weight" /> },
      { path: '/more/soon/:what', element: <Probe name="Soon" /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The ledger row of a meal, found through its overflow button. */
function rowOf(name: string): HTMLElement {
  const more = screen.getByRole('button', { name: `More actions for ${name}` });
  const root = more.parentElement?.parentElement;
  if (!root) throw new Error(`No row for ${name}`);
  return root;
}

beforeEach(async () => {
  resetUiState();
  syncEngine.current.state = { phase: 'starting' };
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('DiaryDayScreen (S12)', () => {
  it('has the search button in its TopBar (search itself comes in a later build)', async () => {
    const user = userEvent.setup();
    const router = renderDiary();
    await user.click(screen.getByRole('button', { name: 'Search your diary' }));
    expect(router.state.location.pathname).toBe('/more/soon/search');
  });

  it('shows today in progress with the timeline, meals, weight and no workout', async () => {
    renderDiary();

    expect(screen.getByRole('heading', { level: 1, name: 'Diary' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Fri 16 Oct · Today')).toBeInTheDocument();

    expect(await screen.findByText('In progress', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('of 1,800 kcal', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Window opened 10:40am')).toBeInTheDocument();
    expect(screen.getByText('closes 10:40pm')).toBeInTheDocument();
    expect(screen.getByText('now')).toBeInTheDocument();
    expect(screen.getAllByText('5am')).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Breakfast 10:40am, late for you\. Lunch 2:15pm\. Now 7:10pm\./ })).toBeInTheDocument();

    const breakfast = rowOf('Roti canai + teh tarik');
    expect(within(breakfast).getByText('Breakfast · 10:40am · Nasi kandar near home · RM 4.80')).toBeInTheDocument();
    expect(within(breakfast).getByText('~560')).toBeInTheDocument();
    expect(within(breakfast).getByText('Late for you')).toBeInTheDocument();
    const lunch = rowOf('Economy rice');
    expect(within(lunch).getByText('Lunch · 2:15pm · Kedai near home · RM 9.50')).toBeInTheDocument();
    expect(within(lunch).getByText('~670')).toBeInTheDocument();

    expect(await screen.findByText('Weight · 8:05am', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('77.8 kg')).toBeInTheDocument();
    expect(screen.getByText('Trend 78.0')).toBeInTheDocument();
    expect(screen.getByText('No workout today')).toBeInTheDocument();
  });

  it('steps back to yesterday and forward again, never past today', async () => {
    const user = userEvent.setup();
    const router = renderDiary();
    await screen.findByText('In progress', {}, SLOW);

    expect(screen.getByRole('button', { name: 'Next: Sat' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous: Thu' }));

    expect(router.state.location.search).toBe('?day=2026-10-15');
    expect(await screen.findByText('Thu 15 Oct · Yesterday')).toBeInTheDocument();
    expect(await screen.findByText('Complete', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('1,680', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('closed 9:30pm')).toBeInTheDocument();
    expect(screen.queryByText('now')).not.toBeInTheDocument();
    expect(screen.getByText('5pm')).toBeInTheDocument();
    expect(screen.getByText('No workout this day')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next: Fri' }));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText('Fri 16 Oct · Today')).toBeInTheDocument();
  });

  it('clamps a future ?day= to today and stops at the first day of use', async () => {
    renderDiary('/diary?day=2026-10-30');
    expect(await screen.findByText('Fri 16 Oct · Today')).toBeInTheDocument();
  });

  it('disables going back before the first day of use', async () => {
    renderDiary('/diary?day=2026-09-28');
    expect(await screen.findByText('Mon 28 Sep')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Previous' }, SLOW)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next: Tue' })).toBeEnabled();
  });

  it('dims a not-counted day and explains it', async () => {
    renderDiary('/diary?day=2026-10-11');
    expect(await screen.findByText('Sun 11 Oct')).toBeInTheDocument();
    expect(await screen.findByText('Not counted', { selector: 'span' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/This day counts as exactly 1,800, whatever was/, {}, SLOW)).toBeInTheDocument();
  });

  it('shows a workout and its add-back in the day total', async () => {
    renderDiary('/diary?day=2026-10-06');
    expect(await screen.findByText('Futsal · 60 min · moderate', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('+470 kcal')).toBeInTheDocument();
    expect(await screen.findByText('of 2,270 kcal', {}, SLOW)).toBeInTheDocument();
  });

  it('marks a past day without a check-in as unconfirmed and opens the check-in', async () => {
    const user = userEvent.setup();
    await db.days.delete('2026-10-15');
    const router = renderDiary('/diary?day=2026-10-15');

    expect(await screen.findByText('Unconfirmed', {}, SLOW)).toBeInTheDocument();
    const banner = await screen.findByRole('button', { name: /Not confirmed yet\./ }, SLOW);
    await user.click(banner);
    expect(router.state.location.search).toContain('sheet=checkin');
  });

  it('shows a guess entry differently on a guess-added day', async () => {
    const guess: MealLog = {
      id: 'guess-2026-10-15',
      eatenAt: '2026-10-15T13:00:00.000Z',
      logicalDay: '2026-10-15',
      slot: 'supper',
      name: 'Typical supper',
      items: [{ id: 'g1', name: 'Typical supper', unitMacros: { kcal: 300, proteinG: 10, carbsG: 40, fatG: 10 }, quantity: 1, uncertainty: 0.35, source: 'aiGuess' }],
      method: 'guess',
      finished: 'all',
      isGuess: true,
      createdAt: '2026-10-16T01:00:00.000Z',
      updatedAt: '2026-10-16T01:00:00.000Z',
      syncState: 'local',
    };
    await db.meals.put(guess);
    await db.days.put({ logicalDay: '2026-10-15', status: 'guess' });
    renderDiary('/diary?day=2026-10-15');

    expect(await screen.findByText('Guess added', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/Typical supper \(~300\) fills in what wasn.t logged/, {}, SLOW)).toBeInTheDocument();
    expect(within(rowOf('Typical supper')).getByText('Guess')).toBeInTheDocument();
  });

  it('shows a paused day', async () => {
    await db.days.put({ logicalDay: '2026-10-14', status: 'paused' });
    renderDiary('/diary?day=2026-10-14');
    expect(await screen.findByText('Paused', { selector: 'span' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/Logging is optional, and this day stays out of trends/, {}, SLOW)).toBeInTheDocument();
  });

  it('shows the empty state on a day with nothing logged', async () => {
    const user = userEvent.setup();
    await db.meals.bulkDelete([DEMO_IDS.meals.todayBreakfast, DEMO_IDS.meals.todayLunch]);
    const router = renderDiary();

    expect(await screen.findByRole('heading', { name: 'Nothing logged yet today' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('of 1,800 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log a meal' }));
    expect(router.state.location.search).toContain('sheet=log');
  });

  it('opens an entry when a meal is tapped', async () => {
    const user = userEvent.setup();
    const router = renderDiary();
    await user.click(await screen.findByRole('button', { name: /^Breakfast · 10:40am/ }, SLOW));
    expect(router.state.location.pathname).toBe(`/diary/entry/${DEMO_IDS.meals.todayBreakfast}`);
  });

  it('switches to the week of the shown day', async () => {
    const user = userEvent.setup();
    const router = renderDiary('/diary?day=2026-10-08');
    await screen.findByText('Thu 8 Oct');
    await user.click(screen.getByRole('radio', { name: 'Week' }));
    expect(router.state.location.pathname).toBe('/diary/week');
    expect(router.state.location.search).toBe('?week=2026-10-05');
  });

  it('duplicates and deletes from a row, with undo', async () => {
    const user = userEvent.setup();
    renderDiary();
    await screen.findByText('Weight · 8:05am', {}, SLOW);

    const breakfast = rowOf('Roti canai + teh tarik');
    await user.click(within(breakfast).getByRole('button', { name: 'More actions for Roti canai + teh tarik' }));
    await user.click(within(breakfast).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'More actions for Roti canai + teh tarik' })).toHaveLength(2), SLOW);
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Logged again today · ~560 kcal'));

    const lunch = rowOf('Economy rice');
    await user.click(within(lunch).getByRole('button', { name: 'More actions for Economy rice' }));
    await user.click(within(lunch).getByRole('button', { name: 'Delete' }));
    // The delete is async; its toast follows once it has gone through.
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Entry deleted'));
    const toast = useUiStore.getState().toast;
    await screen.findByText(/No workout today/);
    await expect.poll(() => screen.queryByRole('button', { name: 'More actions for Economy rice' })).toBeNull();

    toast?.undo?.();
    expect(await screen.findByRole('button', { name: 'More actions for Economy rice' }, SLOW)).toBeInTheDocument();
  });

  it('goes to the weight screen from the weight row', async () => {
    const user = userEvent.setup();
    const router = renderDiary();
    await user.click(await screen.findByRole('button', { name: /Weight · 8:05am/ }, SLOW));
    expect(router.state.location.pathname).toBe('/more/weight');
  });

  it('shows Waiting to sync on a meal still queued here while sync is stuck, not while it runs', async () => {
    await queueForSync(DEMO_IDS.meals.todayLunch);
    syncEngine.current.state = { phase: 'idle' };
    renderDiary();

    await screen.findByRole('button', { name: 'More actions for Economy rice' }, SLOW);
    expect(screen.queryByText('Waiting to sync')).not.toBeInTheDocument();

    act(() => syncEngine.set({ phase: 'needsSignIn' }));
    expect(await within(rowOf('Economy rice')).findByText('Waiting to sync')).toBeInTheDocument();
    // Breakfast isn't queued.
    expect(within(rowOf('Roti canai + teh tarik')).queryByText('Waiting to sync')).not.toBeInTheDocument();

    act(() => syncEngine.set({ phase: 'idle' }));
    await waitFor(() => expect(screen.queryByText('Waiting to sync')).not.toBeInTheDocument());
  });
});
