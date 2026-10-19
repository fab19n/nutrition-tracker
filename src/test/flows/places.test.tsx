import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { nav, setupFlows, SLOW, startApp } from './harness';

const NASI_KANDAR = DEMO_IDS.places.nasiKandar;

setupFlows();

describe('Places · what a Place has learned', () => {
  it('More → Places → Nasi kandar near home → remove a learned default → Undo', async () => {
    const { user, router } = startApp('/more');

    await user.click(await screen.findByRole('button', { name: /^Places.*most visited/ }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Places' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/places');
    expect(nav()).toBeNull();

    const list = await screen.findByRole('list', { name: 'Your Places' }, SLOW);
    await user.click(within(list).getByRole('button', { name: /^Nasi kandar near home/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nasi kandar near home' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/more/places/${NASI_KANDAR}`);

    // What you've taught it: big rice and banjir kuah here.
    const taught = await screen.findByRole('list', { name: "What you've taught it" }, SLOW);
    expect(within(taught).getByText('Kuah campur')).toBeInTheDocument();
    await user.click(within(taught).getByRole('button', { name: 'Remove Kuah campur' }));

    const toast = await screen.findByText('Kuah campur default removed', {}, SLOW);
    await user.hover(toast);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Kuah campur' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Remove Rice (nasi kandar)' })).toBeInTheDocument();
    await waitFor(async () => expect((await db.places.get(NASI_KANDAR))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2 }));

    // Undo teaches it back.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Remove Kuah campur' }, SLOW)).toBeInTheDocument();
    await waitFor(async () =>
      expect((await db.places.get(NASI_KANDAR))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2, 'kuah-campur': 2 }),
    );

    // Back to Places, then to More.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Places' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'More' }, SLOW)).toBeInTheDocument();
    expect(nav()).not.toBeNull();
  });
});
