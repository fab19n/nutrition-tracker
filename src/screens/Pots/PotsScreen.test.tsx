import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderPots } from './testRouter';

const KARI_AYAM = DEMO_IDS.pots.kariAyam;
const TODAY = '2026-10-16';

/** The PotCard of a pot (Saved recipes has a row with the same name). */
function card(name: string): HTMLElement {
  const found = screen.getByRole('button', { name: `Log 1 serving of ${name}` }).closest('li');
  if (!found) throw new Error(`No card for ${name}`);
  return found;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('PotsScreen (S26)', () => {
  it('shows the kari ayam pot: 3 of 8 left, ~500 a serving, clears Sunday', async () => {
    renderPots('/more/pots');
    expect(screen.getByRole('heading', { level: 1, name: 'Pots' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Active pots' }, SLOW)).toBeInTheDocument();

    await screen.findByRole('button', { name: 'Log 1 serving of Kari ayam' }, SLOW);
    const pot = within(card('Kari ayam'));
    expect(pot.getByRole('heading', { level: 3, name: 'Kari ayam' })).toBeInTheDocument();
    expect(pot.getByText('3 of 8 servings left')).toBeInTheDocument();
    expect(pot.getByText('~500 kcal')).toBeInTheDocument();
    expect(pot.getByText('Clears Sunday')).toBeInTheDocument();
    expect(pot.getByRole('button', { name: 'Log 1 serving of Kari ayam' })).toBeEnabled();

    expect(screen.getByRole('heading', { level: 2, name: 'Saved recipes' })).toBeInTheDocument();
    expect(screen.getByText('8 servings · ~500 kcal a serving · cooked Wed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cook Kari ayam again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New pot' })).toBeInTheDocument();
  });

  it('logs 1 serving as a meal, and Undo puts it back', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots');
    const mealsBefore = await db.meals.count();
    await user.click(await screen.findByRole('button', { name: 'Log 1 serving of Kari ayam' }, SLOW));

    await expect.poll(() => db.meals.count()).toBe(mealsBefore + 1);
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(2);
    const meal = (await db.meals.where('logicalDay').equals(TODAY).toArray()).find((m) => m.method === 'pot');
    expect(meal).toMatchObject({ name: 'Kari ayam', placeId: DEMO_IDS.places.home });
    expect(Math.round(mealMacros(meal!).kcal / 10) * 10).toBe(500);

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Saved · ~500 kcal · 2 left');
    expect(await screen.findByText('2 of 8 servings left', {}, SLOW)).toBeInTheDocument();

    toast?.undo?.();
    await expect.poll(async () => (await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(3);
    expect(await db.meals.count()).toBe(mealsBefore);
    expect(await screen.findByText('3 of 8 servings left', {}, SLOW)).toBeInTheDocument();
  });

  it('logs one serving on a double tap', async () => {
    renderPots('/more/pots');
    const log = await screen.findByRole('button', { name: 'Log 1 serving of Kari ayam' }, SLOW);
    fireEvent.click(log);
    fireEvent.click(log);
    await expect.poll(async () => (await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(2);
    expect(await screen.findByText('2 of 8 servings left', {}, SLOW)).toBeInTheDocument();
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(2);
  });

  it('opens a pot from its card', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots');
    await user.click(await screen.findByRole('button', { name: 'Kari ayam' }, SLOW));
    expect(router.state.location.pathname).toBe(`/more/pots/${KARI_AYAM}`);
  });

  it('cooks a saved recipe again and starts a new pot', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots');
    await user.click(await screen.findByRole('button', { name: 'Cook Kari ayam again' }, SLOW));
    expect(router.state.location.pathname).toBe('/more/pots/new');
    expect(router.state.location.search).toBe(`?recipe=${KARI_AYAM}`);

    await router.navigate('/more/pots');
    await user.click(await screen.findByRole('button', { name: 'New pot' }, SLOW));
    expect(router.state.location.pathname).toBe('/more/pots/new');
    expect(router.state.location.search).toBe('');
  });

  it('shows a pot on its last day as clearing today', async () => {
    await db.pots.update(KARI_AYAM, { expiresOn: TODAY });
    renderPots('/more/pots');
    expect(await screen.findByText('Clears today', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText('Clears Sunday')).not.toBeInTheDocument();
  });

  it('keeps saved recipes when nothing is in the fridge', async () => {
    await db.pots.update(KARI_AYAM, { servingsLeft: 0 });
    renderPots('/more/pots');
    expect(await screen.findByText(/^Nothing in the fridge right now/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Log/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cook Kari ayam again' })).toBeInTheDocument();
  });

  it('invites a first pot when there are none', async () => {
    const user = userEvent.setup();
    await db.pots.clear();
    const router = renderPots('/more/pots');
    expect(await screen.findByRole('heading', { name: 'Cooked a big pot?' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Type the recipe once and log servings in one tap.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active pots' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New pot' }));
    expect(router.state.location.pathname).toBe('/more/pots/new');
  });

  it('goes back to More', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots');
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(router.state.location.pathname).toBe('/more');
  });

  it('goes back the way it came', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more', '/more/pots');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await expect.poll(() => router.state.location.pathname).toBe('/more');
  });
});
