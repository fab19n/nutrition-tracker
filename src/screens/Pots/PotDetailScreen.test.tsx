import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderPots } from './testRouter';

const KARI_AYAM = DEMO_IDS.pots.kariAyam;
const PATH = `/more/pots/${KARI_AYAM}`;
const TODAY = '2026-10-16';

/** The large "3 of 8 left". */
function hero(): HTMLElement {
  const found = document.querySelector<HTMLElement>('p.t-hero-sheet');
  if (!found) throw new Error('No hero number');
  return found;
}

async function potMeals() {
  return (await db.meals.where('logicalDay').equals(TODAY).toArray()).filter((m) => m.method === 'pot');
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('PotDetailScreen (S28)', () => {
  it('shows 3 of 8 left, ~500 a serving, the ingredients and when it clears', async () => {
    renderPots('/more/pots', PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'Kari ayam' }, SLOW)).toBeInTheDocument();
    expect(hero()).toHaveTextContent('3 of 8 left');
    expect(screen.getByText('~500 kcal')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Log 1 serving' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Log ½ serving' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Log 2 servings' })).toBeEnabled();

    expect(screen.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeInTheDocument();
    for (const [name, kcal] of [
      ['Ayam', '~2,150'],
      ['Santan', '~800'],
      ['Kentang', '~350'],
      ['Rempah and bawang', '~250'],
      ['Cooking oil', '~480'],
    ] as const) {
      expect(screen.getByText(name).closest('li')).toHaveTextContent(kcal);
    }
    // Read-only: no edit or remove, no oil chips.
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /amount$/ })).not.toBeInTheDocument();
    expect(screen.getByText('Whole pot ~4,030 kcal · 8 servings')).toBeInTheDocument();
    expect(screen.getByText('Clears Sunday')).toBeInTheDocument();
    expect(screen.getByText('· cooked Wed 14 Oct')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cook again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete pot' })).toBeInTheDocument();
  });

  it('logs 1 serving and Undo restores it', async () => {
    const user = userEvent.setup();
    renderPots(PATH);
    await user.click(await screen.findByRole('button', { name: 'Log 1 serving' }, SLOW));
    await expect.poll(async () => (await potMeals()).length).toBe(1);
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(2);
    await expect.poll(() => hero().textContent).toBe('2 of 8 left');

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Saved · ~500 kcal · 2 left');
    toast?.undo?.();
    await expect.poll(async () => (await potMeals()).length).toBe(0);
    await expect.poll(() => hero().textContent).toBe('3 of 8 left');
  });

  it('logs half a serving', async () => {
    const user = userEvent.setup();
    renderPots(PATH);
    await user.click(await screen.findByRole('button', { name: 'Log ½ serving' }, SLOW));
    await expect.poll(async () => (await potMeals()).length).toBe(1);
    const [meal] = await potMeals();
    expect(meal?.items[0]?.quantity).toBe(0.5);
    expect(Math.round(mealMacros(meal!).kcal / 10) * 10).toBe(250);
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(2.5);
    await expect.poll(() => hero().textContent).toBe('2½ of 8 left');
    expect(useUiStore.getState().toast?.message).toBe('Saved · ~250 kcal · 2½ left');
  });

  it('logs 2 servings, then only offers what is left', async () => {
    const user = userEvent.setup();
    renderPots(PATH);
    await user.click(await screen.findByRole('button', { name: 'Log 2 servings' }, SLOW));
    await expect.poll(() => hero().textContent).toBe('1 of 8 left');
    expect(screen.getByRole('button', { name: 'Log 2 servings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Log 1 serving' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Log 1 serving' }));

    // The last serving clears the pot.
    await expect.poll(() => document.querySelector('p.t-hero-sheet')?.textContent).toBe('Cleared');
    expect(screen.getByText(/^All 8 servings logged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Log/ })).not.toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toBe('Saved · ~500 kcal · none left');
  });

  it('shows a pot past its 4 days as cleared, with Cook again', async () => {
    const user = userEvent.setup();
    await db.pots.update(KARI_AYAM, { expiresOn: '2026-10-15' });
    const router = renderPots(PATH);
    await expect.poll(() => document.querySelector('p.t-hero-sheet')?.textContent).toBe('Cleared');
    expect(screen.getByText('Cleared on Thu 15 Oct with 3 of 8 servings left. Pots keep for 4 days.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Log/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cook again' }));
    expect(router.state.location.pathname).toBe('/more/pots/new');
    expect(router.state.location.search).toBe(`?recipe=${KARI_AYAM}`);
  });

  it('says when it clears today', async () => {
    await db.pots.update(KARI_AYAM, { expiresOn: TODAY });
    renderPots(PATH);
    expect(await screen.findByText('Clears today', {}, SLOW)).toBeInTheDocument();
  });

  it('deletes after a confirm, with Undo', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots', PATH);
    await user.click(await screen.findByRole('button', { name: 'Delete pot' }, SLOW));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this pot?' });
    expect(dialog).toHaveTextContent("Kari ayam, 3 of 8 servings left. Servings you've logged stay in your diary.");
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await db.pots.get(KARI_AYAM)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete pot' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await expect.poll(() => db.pots.get(KARI_AYAM)).toBeUndefined();
    expect(router.state.location.pathname).toBe('/more/pots');

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Pot deleted');
    toast?.undo?.();
    await expect.poll(async () => (await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(3);
  });

  it('says so when the pot is not there', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots/pot-gone');
    expect(await screen.findByRole('heading', { name: "This pot isn't here" }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pot' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open pots' }));
    expect(router.state.location.pathname).toBe('/more/pots');
  });

  it('goes back to Pots without history, and the way it came with it', async () => {
    const user = userEvent.setup();
    const router = renderPots(PATH);
    await user.click(await screen.findByRole('button', { name: 'Back to Pots' }, SLOW));
    expect(router.state.location.pathname).toBe('/more/pots');
    expect(router.state.historyAction).toBe('REPLACE');

    await screen.findByRole('heading', { level: 1, name: 'Pots' }, SLOW);
    await router.navigate('/more');
    await screen.findByText(/^More at/, {}, SLOW);
    await router.navigate(PATH);
    await screen.findByRole('heading', { level: 1, name: 'Kari ayam' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await expect.poll(() => router.state.location.pathname).toBe('/more');
  });
});
