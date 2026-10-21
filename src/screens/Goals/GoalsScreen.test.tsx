import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { clearGoalEndNoticeSeen, createGoal, readGoalEndNoticeSeen, switchGoal } from '@/db/goals';
import { goalDraftFor } from '@/domain/goals';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderGoals } from './testRouter';

const G = DEMO_IDS.goals;

/** The card around a goal's open button. */
function card(name: string): HTMLElement {
  const found = screen.getByRole('button', { name }).closest('li');
  if (!found) throw new Error(`No card for ${name}`);
  return found;
}

beforeEach(async () => {
  resetUiState();
  clearGoalEndNoticeSeen();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  clearGoalEndNoticeSeen();
  await resetAll();
});

describe('GoalsScreen (S41)', () => {
  it('shows the demo library: Cut in week 3, two saved goals and the Pause template', async () => {
    renderGoals('/more', '/more/goals');
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument();
    expect(await screen.findByText('Active goal · week 3', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Your goal now' })).toBeInTheDocument();
    const active = within(card('Cut · 1,800 a day'));
    expect(active.getByText('−0.5 kg a week · protein 110g · min 1,400')).toBeInTheDocument();
    expect(active.getByText('Active')).toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 2, name: 'Saved goals' })).toBeInTheDocument();
    const festive = within(card('Festive maintain'));
    expect(festive.getByText('2,100 a day · in range 1,890–2,310')).toBeInTheDocument();
    expect(festive.getByText('Saved')).toBeInTheDocument();
    const leanBulk = within(card('Lean bulk'));
    expect(leanBulk.getByText('2,300 a day · protein 130g')).toBeInTheDocument();
    expect(leanBulk.getByText('Draft')).toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 2, name: 'Templates' })).toBeInTheDocument();
    const pause = within(card('New goal from Pause'));
    expect(pause.getByText('Budget off for travel or sick days. Logging is optional.')).toBeInTheDocument();
    expect(pause.getByText('Template')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New goal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ended' })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('opens a goal, a template and a new goal', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more', '/more/goals');
    await user.click(await screen.findByRole('button', { name: 'Festive maintain' }, SLOW));
    expect(router.state.location.pathname).toBe('/more/goals/goal-festive');

    await router.navigate('/more/goals');
    await user.click(await screen.findByRole('button', { name: 'New goal from Pause' }, SLOW));
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/more/goals/new?template=pause');

    await router.navigate('/more/goals');
    await user.click(await screen.findByRole('button', { name: 'New goal' }, SLOW));
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/more/goals/new');
  });

  it('shows a booked switch as next, and Keep Cut instead cancels it (with Undo)', async () => {
    const user = userEvent.setup();
    await switchGoal(G.festive);
    renderGoals('/more', '/more/goals');
    const next = within(await screen.findByText('Next · from tomorrow (Sat)', {}, SLOW).then((el) => el.closest('li') as HTMLElement));
    expect(next.getByRole('button', { name: 'Festive maintain' })).toBeInTheDocument();
    expect(next.getByText('Starts Sat')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Saved goals' })).toBeInTheDocument();

    await user.click(next.getByRole('button', { name: 'Keep Cut instead' }));
    await expect.poll(() => useUiStore.getState().toast?.message).toBe('Cut stays your goal');
    await expect.poll(() => screen.queryByText('Starts Sat')).toBeNull();
    expect(await db.goalPeriods.count()).toBe(1);

    useUiStore.getState().toast?.undo?.();
    expect(await screen.findByText('Starts Sat', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep Cut instead' })).toBeInTheDocument();
  });

  it('lets a running dated Pause go on: Keep Pause instead on the card of the goal that resumes', async () => {
    const user = userEvent.setup();
    await createGoal(goalDraftFor('pause', { name: 'Pause', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
    // The pause began today and Cut starts again on Monday, so the resume is days away.
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-16' });
    await db.goalPeriods.bulkPut([
      { id: 'p-pause', goalId: G.pause, from: '2026-10-16', to: '2026-10-19' },
      { id: 'p-cut-again', goalId: G.cut, from: '2026-10-19' },
    ]);
    renderGoals('/more', '/more/goals');
    const next = within(await screen.findByText('Next · from Mon 19 Oct', {}, SLOW).then((el) => el.closest('li') as HTMLElement));
    expect(next.getByText('Starts Mon')).toBeInTheDocument();

    await user.click(next.getByRole('button', { name: 'Keep Pause instead' }));
    await expect.poll(() => useUiStore.getState().toast?.message).toBe('Pause stays your goal');
    await expect.poll(() => screen.queryByText('Starts Mon')).toBeNull();
    const periods = await db.goalPeriods.toArray();
    expect(periods).toHaveLength(2);
    expect(periods.find((p) => p.id === 'p-pause')).not.toHaveProperty('to');
  });

  it('notes a reached end with the maintain goal, and counts it as seen', async () => {
    const user = userEvent.setup();
    await db.goals.update(G.cut, { endCondition: { date: '2026-10-16' } });
    const router = renderGoals('/more', '/more/goals');
    const note = await screen.findByRole('note', {}, SLOW);
    expect(note).toHaveTextContent('You reached your end date, Fri 16 Oct. Switch to Festive maintain to hold your weight.');
    await expect.poll(() => readGoalEndNoticeSeen()).toBe('goal-cut:date:2026-10-16');
    await user.click(within(note).getByRole('button', { name: 'See Festive maintain' }));
    expect(router.state.location.pathname).toBe('/more/goals/goal-festive');
  });

  it('lists ended goals with when they were last used', async () => {
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-01' });
    await db.goalPeriods.bulkPut([
      { id: 'p-festive', goalId: G.festive, from: '2026-10-01', to: '2026-10-05' },
      { id: 'p-cut-2', goalId: G.cut, from: '2026-10-05' },
    ]);
    await db.goals.update(G.festive, { status: 'ended' });
    renderGoals('/more', '/more/goals');
    expect(await screen.findByRole('heading', { level: 2, name: 'Ended' }, SLOW)).toBeInTheDocument();
    const ended = within(card('Festive maintain'));
    expect(ended.getByText('Used Thu 1 Oct to Sun 4 Oct')).toBeInTheDocument();
    expect(ended.getByText('Ended')).toBeInTheDocument();
  });

  it('goes back to More when opened directly', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals');
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(router.state.location.pathname).toBe('/more');
  });
});
