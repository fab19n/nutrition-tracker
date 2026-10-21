import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderGoals } from './testRouter';

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

async function templates(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: 'Template' }, SLOW);
}

describe('NewGoalScreen (S43)', () => {
  it('starts from the template in the link, with a name not taken yet', async () => {
    renderGoals('/more/goals', '/more/goals/new?template=festive');
    expect(screen.getByRole('heading', { level: 1, name: 'New goal' })).toBeInTheDocument();
    const chips = within(await templates());
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cut', 'Festive maintain', 'Lean bulk', 'Pause', 'Custom']);
    expect(chips.getByRole('button', { name: 'Festive maintain' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Hold your weight through open-house season. Main number: days in range.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Festive maintain 2');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('2,350 kcal');
    expect(screen.getByRole('button', { name: '± 10%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('110 g');
    expect(screen.getByRole('button', { name: 'Save goal' })).toBeInTheDocument();
    expect(screen.getByText("It won't change anything until you switch to it.")).toBeInTheDocument();
  });

  it('changes template, keeping a typed name', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/new?template=festive');
    const chips = within(await templates());
    await user.click(chips.getByRole('button', { name: 'Lean bulk' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Lean bulk 2');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('2,550 kcal');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('Maintenance ~2,350 + 200 surplus');
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('130 g');
    expect(router.state.location.search).toBe('?template=leanBulk');
    expect(router.state.historyAction).toBe('REPLACE');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Gym block');
    await user.click(chips.getByRole('button', { name: 'Cut' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Gym block');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('1,800 kcal');
    expect(screen.getByText('Carbs 205g and fat 60g follow from the rest.')).toBeInTheDocument();
  });

  it('saves a new goal and opens it in its place', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/new?template=festive');
    const goals = await db.goals.count();
    await templates();
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    await expect.poll(() => useUiStore.getState().toast?.message, SLOW).toBe('Saved · Festive maintain 2');
    const created = (await db.goals.toArray()).find((g) => g.name === 'Festive maintain 2');
    expect(created).toMatchObject({ status: 'saved', template: 'festive' });
    expect(await db.goals.count()).toBe(goals + 1);
    expect(await db.goalVersions.where('goalId').equals(created!.id).count()).toBe(1);
    await expect.poll(() => router.state.location.pathname).toBe(`/more/goals/${created!.id}`);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('heading', { level: 1, name: 'Festive maintain 2' }, SLOW)).toBeInTheDocument();
  });

  it('turns the Pause template into a goal', async () => {
    const user = userEvent.setup();
    const router = renderGoals('/more/goals', '/more/goals/new?template=pause');
    await templates();
    expect(screen.getByLabelText('Name')).toHaveValue('Pause');
    expect(screen.queryByRole('group', { name: 'Daily target' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    await expect.poll(async () => (await db.goals.get(DEMO_IDS.goals.pause))?.status, SLOW).toBe('saved');
    await expect.poll(() => router.state.location.pathname).toBe('/more/goals/goal-pause');
  });

  it('offers a Custom goal its main number and fixed hours', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/new?template=custom');
    await templates();
    expect(screen.getByLabelText('Name')).toHaveValue('Custom');
    expect(screen.getByRole('group', { name: 'Main number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hold' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Fixed hours' }));
    expect(screen.getByLabelText('Opens')).toBeInTheDocument();
  });

  it('asks for a name before saving', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/new');
    await templates();
    const goals = await db.goals.count();
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByText('Give it a name')).toBeInTheDocument();
    expect(await db.goals.count()).toBe(goals);
  });

  it('drops a weight end when Hold is picked, and the End chips say so', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/new?template=custom');
    await templates();
    await user.click(screen.getByRole('button', { name: 'At a weight' }));
    await user.type(screen.getByLabelText('End weight'), '72');
    expect(screen.getByText('Your trend is 78.0 kg now')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hold' }));
    expect(screen.queryByLabelText('End weight')).toBeNull();
    expect(screen.queryByText('Your trend is 78.0 kg now')).toBeNull();
    expect(screen.queryByRole('button', { name: 'At a weight' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No end' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    await expect.poll(() => useUiStore.getState().toast?.message, SLOW).toBe('Saved · Custom');
    const created = (await db.goals.toArray()).find((g) => g.name === 'Custom');
    expect(created?.endCondition).toBeUndefined();
  });

  it('takes the user to the first field to fix, a weight end among them', async () => {
    const user = userEvent.setup();
    renderGoals('/more/goals', '/more/goals/new');
    await templates();
    await user.click(screen.getByRole('button', { name: 'At a weight' }));
    await user.type(screen.getByLabelText('End weight'), '80');
    await user.click(screen.getByRole('button', { name: 'Save goal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a weight under your 78.0 kg trend');
    expect(screen.getByLabelText('End weight')).toHaveFocus();
  });

  it('starts from Cut without a template in the link', async () => {
    renderGoals('/more/goals', '/more/goals/new');
    const chips = within(await templates());
    expect(chips.getByRole('button', { name: 'Cut' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Name')).toHaveValue('Cut 2');
    expect(screen.getByRole('group', { name: 'Daily target' })).toHaveTextContent('Maintenance ~2,350 − 550 for 0.5 kg a week');
  });
});
