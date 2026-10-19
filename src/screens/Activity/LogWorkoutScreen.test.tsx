import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { LAST_WEEK_CLOSED_NOTE } from '@/db/activity';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { useWeekBudget } from '@/db/hooks';
import { deleteDayRecord, putDayRecord } from '@/db/repo';
import { DEMO_EXPECTED } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { resetUiState, useUiStore } from '@/state/ui';
import ActivityScreen from './ActivityScreen';
import LogWorkoutScreen from './LogWorkoutScreen';

const SLOW = { timeout: 4000 };
const TODAY = DEMO_EXPECTED.today.day;
const HELPER = 'Estimated from activity type, time, intensity and your weight.';

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
    </div>
  );
}

/** Log workout opened from Activity (or straight from a link with `direct`). */
function renderLog(opts: { search?: string; direct?: boolean } = {}) {
  const log = `/more/activity/new${opts.search ?? ''}`;
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/more/activity', element: <ActivityScreen /> },
      { path: '/more/activity/new', element: <LogWorkoutScreen /> },
    ],
    { initialEntries: opts.direct ? [log] : ['/more/activity', log], initialIndex: opts.direct ? 0 : 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function estimateLine(): HTMLElement {
  const line = screen.getByText(HELPER).previousElementSibling;
  if (!(line instanceof HTMLElement)) throw new Error('No estimate line');
  return line;
}

function dayChips(): string[] {
  return within(screen.getByRole('group', { name: 'Day' }))
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');
}

async function ready() {
  expect(await screen.findByRole('group', { name: 'Day' }, SLOW)).toBeInTheDocument();
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  vi.useRealTimers();
  await resetAll();
});

describe('LogWorkoutScreen (S29)', () => {
  it('starts from the last workout: Futsal · 60 min · Moderate, ~470 added to this week', async () => {
    renderLog();
    expect(screen.getByRole('heading', { level: 1, name: 'Log workout' })).toBeInTheDocument();
    await ready();

    expect(screen.getByRole('radio', { name: 'Futsal' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: 'Time in minutes' })).toHaveValue('60');
    expect(screen.getByRole('radio', { name: 'Moderate' })).toHaveAttribute('aria-checked', 'true');
    expect(estimateLine()).toHaveTextContent('~470 kcal added to this week');
    expect(screen.getByText(HELPER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Big one-off day?' })).toHaveAttribute('aria-expanded', 'false');
    // Points at the bonus form only while it is there.
    expect(screen.getByRole('button', { name: 'Big one-off day?' })).not.toHaveAttribute('aria-controls');
  });

  it('offers today back to Monday and never a future day', async () => {
    renderLog();
    await ready();
    expect(dayChips()).toEqual(['Today', 'Yesterday', 'Wed', 'Tue', 'Mon']);
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    for (const future of ['Tomorrow', 'Sat', 'Sun']) expect(screen.queryByRole('button', { name: future })).not.toBeInTheDocument();
    expect(screen.queryByText(LAST_WEEK_CLOSED_NOTE)).not.toBeInTheDocument();
  });

  it('ignores a ?day= that is not on offer', async () => {
    renderLog({ search: '?day=2026-10-17' });
    await ready();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on a ?day= this week', async () => {
    renderLog({ search: '?day=2026-10-14' });
    await ready();
    expect(screen.getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('logs futsal, moderate, 60 min: ~470 added to this week, with undo', async () => {
    const user = userEvent.setup();
    const budget = renderHook(() => useWeekBudget());
    await waitFor(() => expect(budget.result.current?.budget.workoutsKcal).toBe(0), SLOW);
    const leftBefore = budget.result.current?.budget.leftTodayKcal ?? 0;

    renderLog();
    await ready();
    await user.click(screen.getByRole('radio', { name: 'Futsal' }));
    await user.click(screen.getByRole('radio', { name: 'Moderate' }));
    const minutes = screen.getByRole('textbox', { name: 'Time in minutes' });
    await user.clear(minutes);
    await user.type(minutes, '60');
    expect(estimateLine()).toHaveTextContent('~470 kcal added to this week');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Back on Activity with the toast.
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Futsal · ~470 kcal added to this week');
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+470/ }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Today · Futsal 60 min, moderate')).toBeInTheDocument();
    expect(await db.workouts.where('logicalDay').equals(TODAY).toArray()).toEqual([
      expect.objectContaining({ type: 'futsal', intensity: 'moderate', minutes: 60, netKcal: 470 }),
    ]);
    await waitFor(() => expect(budget.result.current?.budget.workoutsKcal).toBe(470), SLOW);
    expect(budget.result.current?.budget.leftTodayKcal).toBe(leftBefore + 470);

    toast?.undo?.();
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+0/ }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(budget.result.current?.budget.workoutsKcal).toBe(0), SLOW);
    expect(await db.workouts.count()).toBe(DEMO_EXPECTED.counts.workouts);
  });

  it('logs on an earlier day this week with the estimate for the new choices', async () => {
    const user = userEvent.setup();
    renderLog();
    await ready();

    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(screen.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('radio', { name: 'Badminton' }));
    await user.click(screen.getByRole('button', { name: '5 minutes less' }));
    await user.click(screen.getByRole('radio', { name: 'Easy' }));
    // (4.5 − 1) × 77.8 × 55/60 = 249.6 → ~250
    expect(estimateLine()).toHaveTextContent('~250 kcal added to this week');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Yesterday · Badminton 55 min, easy', {}, SLOW)).toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toBe('Badminton · ~250 kcal added to this week');
    expect(await db.workouts.where('logicalDay').equals('2026-10-15').count()).toBe(1);
  });

  it("explains a bad time and doesn't save", async () => {
    const user = userEvent.setup();
    renderLog();
    await ready();
    await user.clear(screen.getByRole('textbox', { name: 'Time in minutes' }));
    expect(estimateLine()).toHaveTextContent('Set the time to see the estimate.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter how many minutes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Log workout' })).toBeInTheDocument();
    expect(await db.workouts.count()).toBe(DEMO_EXPECTED.counts.workouts);
  });

  it('saves one workout on a double tap', async () => {
    renderLog();
    await ready();
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    expect(await db.workouts.count()).toBe(DEMO_EXPECTED.counts.workouts + 1);
  });

  it('adds a one-off bonus from "Big one-off day?", with undo', async () => {
    const user = userEvent.setup();
    renderLog();
    await ready();

    await user.click(screen.getByRole('button', { name: 'Big one-off day?' }));
    const toggle = screen.getByRole('button', { name: 'Big one-off day?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls ? document.getElementById(controls) : null).toContainElement(screen.getByRole('textbox', { name: 'Extra kcal today' }));
    const kcal = screen.getByRole('textbox', { name: 'Extra kcal today' });
    expect(kcal).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add bonus' }));
    expect(screen.getByText('Enter how many kcal to add.')).toBeInTheDocument();
    expect(await db.bonuses.count()).toBe(0);

    await user.type(kcal, '300');
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'A hike');
    await user.click(screen.getByRole('button', { name: 'Add bonus' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('A hike · +300 kcal added to this week');
    expect(await screen.findByText('Today · A hike', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^This week · \+300/ })).toBeInTheDocument();

    toast?.undo?.();
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+0/ }, SLOW)).toBeInTheDocument();
    expect(await db.bonuses.count()).toBe(0);
  });

  it('puts the bonus on the chosen day', async () => {
    const user = userEvent.setup();
    renderLog();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Tue' }));
    await user.click(screen.getByRole('button', { name: 'Big one-off day?' }));
    await user.type(screen.getByRole('textbox', { name: 'Extra kcal on Tue' }), '400{Enter}');
    expect(await screen.findByText('Tue · One-off bonus', {}, SLOW)).toBeInTheDocument();
    expect(await db.bonuses.toArray()).toEqual([expect.objectContaining({ logicalDay: '2026-10-13', kcal: 400, reason: '' })]);
  });

  it('goes back to Activity, or there when opened from a link', async () => {
    const user = userEvent.setup();
    renderLog();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
  });

  it('lands on Activity after saving when opened from a link', async () => {
    const user = userEvent.setup();
    const router = renderLog({ direct: true });
    await ready();
    expect(screen.getByRole('button', { name: 'Back to Activity' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/activity');
  });

  it("can't estimate or save without a weight", async () => {
    await db.weights.clear();
    await db.profile.clear();
    renderLog();
    await ready();
    expect(estimateLine()).toHaveTextContent('Add a weigh-in first, so there is a weight to estimate from.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('LogWorkoutScreen on a Monday', () => {
  const MONDAY_10AM = new Date('2026-10-19T02:00:00.000Z'); // Mon 19 Oct, 10am MYT
  const SUNDAY = '2026-10-18';

  beforeEach(async () => {
    await db.profile.update('me', { demoMode: false });
    setDemoClock(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_10AM);
  });

  it('offers only today once last week is confirmed, and says why', async () => {
    await putDayRecord(db, { logicalDay: SUNDAY, status: 'complete', confirmedAt: '2026-10-19T01:00:00.000Z' });
    renderLog();
    await ready();
    expect(dayChips()).toEqual(['Today']);
    expect(screen.getByText(LAST_WEEK_CLOSED_NOTE)).toBeInTheDocument();
  });

  it("offers yesterday while Sunday is unconfirmed, and its kcal go to last week", async () => {
    const user = userEvent.setup();
    await putDayRecord(db, { logicalDay: SUNDAY, status: 'complete', confirmedAt: '2026-10-19T01:00:00.000Z' });
    renderLog();
    await ready();
    await deleteDayRecord(db, SUNDAY);
    await waitFor(() => expect(dayChips()).toEqual(['Today', 'Yesterday']), SLOW);
    expect(screen.queryByText(LAST_WEEK_CLOSED_NOTE)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(estimateLine()).toHaveTextContent('~470 kcal added to last week');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toBe('Futsal · ~470 kcal added to last week');
    expect(await screen.findByRole('heading', { level: 2, name: /^Last week · \+470/ }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Yesterday · Futsal 60 min, moderate')).toBeInTheDocument();
    // The demo's futsal is two weeks back now.
    expect(screen.getByRole('heading', { level: 2, name: /^5–11 Oct · \+470/ })).toBeInTheDocument();
  });
});
