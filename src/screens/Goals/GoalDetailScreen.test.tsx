import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { createGoal } from '@/db/goals';
import { DEMO_IDS } from '@/db/seed/demo';
import { goalDraftFor } from '@/domain/goals';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderGoals } from './testRouter';

const G = DEMO_IDS.goals;

function header(): HTMLElement {
  return screen.getByRole('banner');
}

async function toast(message: string): Promise<void> {
  await expect.poll(() => useUiStore.getState().toast?.message, SLOW).toBe(message);
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('GoalDetailScreen (S42)', () => {
  it('switches to a saved goal from tomorrow through S44, with Undo', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/goal-festive');
    expect(await screen.findByRole('heading', { level: 1, name: 'Festive maintain' }, SLOW)).toBeInTheDocument();
    expect(await within(header()).findByText('Saved', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('2,100 kcal');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('Maintenance ~2,100 · in range 1,890–2,310');
    expect(screen.getByRole('button', { name: '± 10%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('110 g');
    expect(screen.getByText('Not used yet. Its target starts the day you switch to it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Archive this goal/ })).toHaveTextContent('Removes it from your goals.');

    await user.click(screen.getByRole('button', { name: 'Switch to this goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Festive maintain?' }, SLOW);
    expect(within(dialog).getByText(/This week: 5 days at 1,800 \+ 2 days at 2,100 =/)).toBeInTheDocument();
    expect(within(dialog).getByText('13,200 kcal')).toBeInTheDocument();
    expect(within(dialog).getByText('Main number becomes days in range (2,100 ± 10%).')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Switch from tomorrow' }));

    await toast('Festive maintain from tomorrow (Sat)');
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    expect(await within(header()).findByText('Starts Sat', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Starts tomorrow (Sat)' })).toBeInTheDocument();
    expect(screen.getByText('Today and earlier days keep Cut.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep Cut instead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to this goal' })).toBeNull();

    useUiStore.getState().toast?.undo?.();
    expect(await within(header()).findByText('Saved', {}, SLOW)).toBeInTheDocument();
    expect(await db.goalPeriods.count()).toBe(1);
  });

  it('shows the goal in force with its history and a link to the target', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/goal-cut');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cut' }, SLOW)).toBeInTheDocument();
    expect(within(header()).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your goal now · week 3' })).toBeInTheDocument();
    expect(screen.getByText('In use since Mon 28 Sep')).toBeInTheDocument();
    const history = within(screen.getByRole('list', { name: 'Target history' }));
    expect(history.getByText('1,800 a day')).toBeInTheDocument();
    expect(history.getByText('Since Mon 28 Sep · starting estimate · maintenance ~2,350 · 0.5 kg a week')).toBeInTheDocument();
    expect(history.getByText('Now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to this goal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Archive this goal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'See your target' }));
    expect(router.state.location.pathname).toBe('/insights/target');
  });

  it('edits the target from tomorrow; Discard puts the form back', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/goal-cut');
    const target = await screen.findByRole('group', { name: 'Daily target' }, SLOW);
    // The stored target's own split, then the one a new target would get.
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('Carbs 180g and fat 60g follow from the rest.');
    await user.click(within(target).getByRole('button', { name: 'Raise daily target' }));
    expect(target).toHaveTextContent('1,850 kcal');
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('Carbs 220g and fat 60g follow from the rest.');
    expect(target).toHaveTextContent('500 under your ~2,350 maintenance, about 0.45 kg a week');
    expect(screen.getByText('Target changes start tomorrow (Sat). Today keeps 1,800.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(target).toHaveTextContent('1,800 kcal');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    await user.click(within(target).getByRole('button', { name: 'Raise daily target' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await toast('Saved · 1,850 a day from tomorrow');
    const history = within(await screen.findByRole('list', { name: 'Target history' }));
    expect(await history.findByText('1,850 a day', {}, SLOW)).toBeInTheDocument();
    expect(history.getByText('Starts Sat')).toBeInTheDocument();
    expect(screen.getByText('1,850 starts tomorrow (Sat). Today keeps 1,800.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(await db.goalVersions.where('goalId').equals(G.cut).count()).toBe(2);
  });

  it('asks for a name before saving, and writes nothing', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/goal-festive');
    const name = await screen.findByLabelText('Name', {}, SLOW);
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Give it a name')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect((await db.goals.get(G.festive))?.name).toBe('Festive maintain');
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('archives a goal never used, with Undo', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/goal-lean-bulk');
    await user.click(await screen.findByRole('button', { name: /^Archive this goal/ }, SLOW));
    await toast('Archived · Lean bulk');
    expect(router.state.location.pathname).toBe('/more/goals');
    expect(await db.goals.get(G.leanBulk)).toBeUndefined();
    useUiStore.getState().toast?.undo?.();
    await expect.poll(async () => (await db.goals.get(G.leanBulk))?.status).toBe('draft');
  });

  it('restores an ended goal', async () => {
    const user = userEvent.setup();
    await db.goals.update(G.leanBulk, { status: 'ended' });
    renderGoals('/more/goals', '/more/goals/goal-lean-bulk');
    expect(await screen.findByRole('heading', { name: 'Ended' }, SLOW)).toBeInTheDocument();
    expect(within(header()).getByText('Ended')).toBeInTheDocument();
    expect(screen.getByText('Past days keep it. Restore it to use it again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await toast('Restored · Lean bulk');
    await expect.poll(async () => (await db.goals.get(G.leanBulk))?.status).toBe('saved');
  });

  it('says when a goal is gone', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/missing');
    expect(await screen.findByRole('heading', { name: "This goal isn't here any more" }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See your goals' }));
    expect(router.state.location.pathname).toBe('/more/goals');
  });

  it('opens S43 for a template row', async () => {
    const router = renderGoals('/more/goals', '/more/goals/goal-pause');
    await expect.poll(() => `${router.state.location.pathname}${router.state.location.search}`, SLOW).toBe('/more/goals/new?template=pause');
  });

  it('pauses until Monday, to a picked date or until the next switch', async () => {
    const user = userEvent.setup();
    await createGoal(goalDraftFor('pause', { name: 'Pause', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
    renderGoals('/more/goals', '/more/goals/goal-pause');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pause' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Daily target' })).toBeNull();
    expect(screen.getByText('Budget off. Logging is optional, and these days stay out of trends. You pick how long when you switch.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to this goal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Pause?' }, SLOW);
    const until = within(dialog).getByRole('group', { name: 'Until' });
    expect(within(until).getByRole('button', { name: 'Mon 19 Oct' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText('Cut starts again on Mon 19 Oct.')).toBeInTheDocument();
    expect(within(dialog).getByText('9,000 kcal')).toBeInTheDocument();

    await user.click(within(until).getByRole('button', { name: 'Pick a date' }));
    expect(within(dialog).getByLabelText('Until date')).toHaveValue('2026-10-24');
    expect(within(dialog).getByText('Cut starts again on Sat 24 Oct.')).toBeInTheDocument();
    await user.click(within(until).getByRole('button', { name: 'Until I switch back' }));
    expect(within(dialog).getByText('Runs until you switch to another goal.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Until date')).toBeNull();

    await user.click(within(until).getByRole('button', { name: 'Mon 19 Oct' }));
    await user.click(within(dialog).getByRole('button', { name: 'Switch from tomorrow' }));
    await toast('Paused from tomorrow (Sat) until Mon');
    const periods = await db.goalPeriods.toArray();
    expect(periods.find((p) => p.goalId === G.pause)).toMatchObject({ from: '2026-10-17', to: '2026-10-19' });
    expect(periods.find((p) => p.goalId === G.cut && p.from === '2026-10-19')).toBeDefined();
  });

  describe('a running dated Pause', () => {
    // The pause began today (Fri 16 Oct) and Cut starts again on Mon 19 Oct.
    async function pauseUntilMonday(): Promise<void> {
      await createGoal(goalDraftFor('pause', { name: 'Pause', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
      await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-16' });
      await db.goalPeriods.bulkPut([
        { id: 'p-pause', goalId: G.pause, from: '2026-10-16', to: '2026-10-19' },
        { id: 'p-cut-again', goalId: G.cut, from: '2026-10-19' },
      ]);
    }

    it('keeps pausing from the Pause itself', async () => {
      const user = userEvent.setup();
      await pauseUntilMonday();
      renderGoals('/more/goals', '/more/goals/goal-pause');
      expect(await screen.findByRole('heading', { name: 'Paused until Mon' }, SLOW)).toBeInTheDocument();
      expect(screen.getByText('Cut starts again on Mon 19 Oct.')).toBeInTheDocument();
      // A Pause has no target: its history section says so in other words.
      expect(screen.queryByRole('heading', { name: 'Target history' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Use' })).toBeInTheDocument();
      expect(screen.getByText('In use since Fri 16 Oct')).toBeInTheDocument();
      expect(screen.queryByText(/You pick how long when you switch/)).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Keep Pause instead' }));
      await toast('Pause stays your goal');
      expect(await screen.findByRole('heading', { name: 'Paused since Fri 16 Oct' }, SLOW)).toBeInTheDocument();
      const periods = await db.goalPeriods.toArray();
      expect(periods.find((p) => p.id === 'p-pause')).not.toHaveProperty('to');
      expect(periods.find((p) => p.id === 'p-cut-again')).toBeUndefined();
    });

    it('keeps pausing, or starts Cut from tomorrow, from the goal that resumes', async () => {
      const user = userEvent.setup();
      await pauseUntilMonday();
      renderGoals('/more/goals', '/more/goals/goal-cut');
      expect(await screen.findByRole('heading', { name: 'Starts again on Mon 19 Oct' }, SLOW)).toBeInTheDocument();
      expect(within(header()).getByText('Starts Mon')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep Pause instead' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Switch to this goal' }));
      const dialog = await screen.findByRole('dialog', { name: 'Switch to Cut?' }, SLOW);
      await user.click(within(dialog).getByRole('button', { name: 'Switch from tomorrow' }));
      await toast('Cut from tomorrow (Sat)');
      const periods = (await db.goalPeriods.toArray()).map(({ goalId, from, to }) => ({ goalId, from, to }));
      expect(periods).toEqual(
        expect.arrayContaining([
          { goalId: G.pause, from: '2026-10-16', to: '2026-10-17' },
          { goalId: G.cut, from: '2026-10-17', to: undefined },
        ]),
      );
      expect(periods.find((p) => p.from === '2026-10-19')).toBeUndefined();
    });

    it('offers no Switch button on a goal that already starts tomorrow', async () => {
      await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-17' });
      await db.goalPeriods.put({ id: 'p-festive', goalId: G.festive, from: '2026-10-17' });
      renderGoals('/more/goals', '/more/goals/goal-festive');
      expect(await screen.findByRole('heading', { name: 'Starts tomorrow (Sat)' }, SLOW)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Switch to this goal' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Keep Cut instead' })).toBeInTheDocument();
    });
  });

  describe('a goal whose end has been reached', () => {
    it('saves a raised protein and a rename with the end date reached (16 Oct)', async () => {
      const user = userEvent.setup();
      await db.goals.update(G.cut, { endCondition: { date: '2026-10-16' } });
      renderGoals('/more/goals', '/more/goals/goal-cut');
      expect(await screen.findByLabelText('End date', {}, SLOW)).toHaveValue('2026-10-16');
      await user.click(within(screen.getByRole('group', { name: 'Protein' })).getByRole('button', { name: 'Raise protein' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await toast('Saved · 1,800 a day from tomorrow');
      expect(screen.queryByRole('alert')).toBeNull();
      expect((await db.goals.get(G.cut))?.endCondition).toEqual({ date: '2026-10-16' });
      expect((await db.goalVersions.where('goalId').equals(G.cut).toArray()).map((v) => v.proteinG).sort()).toEqual([110, 115]);

      await user.type(screen.getByLabelText('Name'), ' 2');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await expect.poll(async () => (await db.goals.get(G.cut))?.name, SLOW).toBe('Cut 2');
    });

    it('saves with the end weight reached by the trend', async () => {
      const user = userEvent.setup();
      // The demo trend is ~78.0 kg and Cut is losing, so 78.5 is behind it.
      await db.goals.update(G.cut, { endCondition: { weightKg: 78.5 } });
      renderGoals('/more/goals', '/more/goals/goal-cut');
      const weight = await screen.findByLabelText('End weight', {}, SLOW);
      expect(weight).toHaveValue('78.5');
      await user.type(screen.getByLabelText('Name'), ' B');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await expect.poll(async () => (await db.goals.get(G.cut))?.name, SLOW).toBe('Cut B');
      expect((await db.goals.get(G.cut))?.endCondition).toEqual({ weightKg: 78.5 });
    });

    it('still checks an end the user changed', async () => {
      const user = userEvent.setup();
      await db.goals.update(G.cut, { endCondition: { date: '2026-10-16' } });
      renderGoals('/more/goals', '/more/goals/goal-cut');
      await user.click(await screen.findByRole('button', { name: 'At a weight' }, SLOW));
      await user.type(screen.getByLabelText('End weight'), '79');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText('Pick a weight under your 78.0 kg trend')).toBeInTheDocument();
      expect((await db.goals.get(G.cut))?.endCondition).toEqual({ date: '2026-10-16' });
    });
  });

  describe('Save with a field to fix', () => {
    let scroll = vi.fn();
    beforeEach(() => {
      scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('takes the user to a name left empty, and says it', async () => {
      const user = userEvent.setup();
      renderGoals('/more/goals', '/more/goals/goal-festive');
      const name = await screen.findByLabelText('Name', {}, SLOW);
      await user.clear(name);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Give it a name');
      expect(name).toHaveFocus();
      expect(name).toHaveAccessibleDescription('Give it a name');
      expect(scroll).toHaveBeenCalled();
    });

    it('takes the user to an empty "By a date" far down the form', async () => {
      const user = userEvent.setup();
      renderGoals('/more/goals', '/more/goals/goal-cut');
      await user.click(await screen.findByRole('button', { name: 'By a date' }, SLOW));
      expect(screen.getByLabelText('End date')).not.toHaveFocus();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pick a date after today');
      expect(screen.getByLabelText('End date')).toHaveFocus();
      expect(screen.getByLabelText('End date')).toHaveAccessibleDescription('Pick a date after today');
      expect(useUiStore.getState().toast).toBeNull();
    });

    it('takes the user to a weight end that is on the wrong side of the trend', async () => {
      const user = userEvent.setup();
      renderGoals('/more/goals', '/more/goals/goal-cut');
      await user.click(await screen.findByRole('button', { name: 'At a weight' }, SLOW));
      await user.type(screen.getByLabelText('End weight'), '79');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pick a weight under your 78.0 kg trend');
      expect(screen.getByLabelText('End weight')).toHaveFocus();
    });
  });

  it('drops a weight end when a Custom goal is held, and shows no end', async () => {
    const user = userEvent.setup();
    const { goal } = await createGoal({
      ...goalDraftFor('custom', { name: 'Steady', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }),
      endCondition: { weightKg: 75 },
    });
    renderGoals('/more/goals', `/more/goals/${goal.id}`);
    expect(await screen.findByLabelText('End weight', {}, SLOW)).toHaveValue('75');
    await user.click(screen.getByRole('button', { name: 'Hold' }));
    expect(screen.queryByLabelText('End weight')).toBeNull();
    expect(screen.queryByRole('button', { name: 'At a weight' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No end' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await expect.poll(async () => (await db.goalVersions.where('goalId').equals(goal.id).toArray()).at(-1)?.paceKgPerWeek, SLOW).toBe(0);
    expect((await db.goals.get(goal.id))?.endCondition).toBeUndefined();
  });
});
