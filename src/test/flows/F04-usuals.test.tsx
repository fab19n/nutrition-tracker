import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

const TODAY = '2026-10-16';
const ROTI = 'Roti canai + teh tarik';

setupFlows();

describe('F04 · repeat meal from the Usuals screen', () => {
  it('More → Usuals → Log → Review (pre-filled) → Save, and Today counts it', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    const usesBefore = (await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.useCount ?? 0;

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: /^Usuals/ }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Usuals' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/usuals');
    expect(nav()).toBeNull();

    // Your Usuals in your order; Log opens the review with its items.
    const card = await screen.findByRole('article', { name: ROTI }, SLOW);
    await user.click(within(card).getByRole('button', { name: `Log ${ROTI}` }));
    expect(await screen.findByRole('heading', { name: 'Your usual order' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/log/review');
    expect(screen.getByRole('button', { name: 'More for Roti canai + dhal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Teh tarik' })).toBeInTheDocument();
    expect(screen.getByText('560 kcal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const toast = await screen.findByText('Saved · ~560 kcal', {}, SLOW);
    await user.hover(toast);

    // Back on Today: the main number takes the meal; the Usual counts one more use.
    expect(await findHero(/^10 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
    // This morning's breakfast was the same Usual; tonight's is a dinner.
    const saved = (await db.meals.where('logicalDay').equals(TODAY).toArray()).filter((m) => m.name === ROTI);
    expect(saved.map((m) => m.slot).sort()).toEqual(['breakfast', 'dinner']);
    await waitFor(async () => expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.useCount).toBe(usesBefore + 1));

    // Undo takes it back off.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
  });

  it('Log sheet → Usuals → Manage usuals opens the screen, and Back from its review returns there', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('button', { name: 'Usuals' }, SLOW));
    const usuals = await findDialog('Your usuals');
    await user.click(within(usuals).getByRole('button', { name: 'Manage usuals' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Usuals' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/usuals');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(await screen.findByRole('button', { name: `Log ${ROTI}` }, SLOW));
    expect(await screen.findByRole('heading', { name: 'Your usual order' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Usuals' }, SLOW)).toBeInTheDocument();

    // Usuals replaced the Log sheet: Back goes to Today, not to a stale sheet.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
