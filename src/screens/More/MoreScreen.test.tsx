import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { updatePot } from '@/db/repo';
import { resetUiState } from '@/state/ui';
import MoreScreen from './MoreScreen';

function SoonProbe() {
  const { what } = useParams();
  return <h1>Soon: {what}</h1>;
}

function renderMore() {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <MoreScreen /> },
      { path: '/more/weight', element: <h1>Weight screen</h1> },
      { path: '/more/settings', element: <h1>Settings screen</h1> },
      { path: '/more/places', element: <h1>Places screen</h1> },
      { path: '/more/usuals', element: <h1>Usuals screen</h1> },
      { path: '/more/pots', element: <h1>Pots screen</h1> },
      { path: '/more/activity', element: <h1>Activity screen</h1> },
      { path: '/more/soon/:what', element: <SoonProbe /> },
    ],
    { initialEntries: [PATHS.more] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('MoreScreen (S48)', () => {
  it('shows the active goal card with the demo targets and saved goals', async () => {
    renderMore();

    expect(screen.getByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    expect(await screen.findByText('Active goal · week 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Cut · 1,800 a day' })).toBeInTheDocument();
    expect(screen.getByText('−0.5 kg a week · protein 110g · min 1,400')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    const saved = await screen.findByRole('list', { name: 'Saved goals' });
    expect(within(saved).getByText('Festive maintain · Saved')).toBeInTheDocument();
    expect(within(saved).getByText('Lean bulk · Draft')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText("Estimates are approximate. This app isn't medical advice.")).toBeInTheDocument();
  });

  it('gives each row a live sub-line', async () => {
    renderMore();

    expect(await screen.findByText('Cut active · 2 saved')).toBeInTheDocument();
    expect(await screen.findByText(/^4 places · .+ most visited$/)).toBeInTheDocument();
    expect(screen.getByText('4 one-tap meals')).toBeInTheDocument();
    expect(screen.getByText('Kari ayam · 3 of 8 left')).toBeInTheDocument();
    expect(screen.getByText('Futsal last Tue · +470')).toBeInTheDocument();
    expect(await screen.findByText('78.0 kg trend · −0.4 kg this week')).toBeInTheDocument();
    expect(screen.getByText('Day rollover 5am · weeks start Monday')).toBeInTheDocument();
  });

  it('shows half servings left on the Pots row as ½, not rounded', async () => {
    const [pot] = await db.pots.toArray();
    if (!pot) throw new Error('demo pot missing');
    await updatePot(db, pot.id, { servingsLeft: 2.5 });
    renderMore();
    expect(await screen.findByText('Kari ayam · 2½ of 8 left')).toBeInTheDocument();

    await updatePot(db, pot.id, { servingsLeft: 0.5 });
    expect(await screen.findByText('Kari ayam · ½ of 8 left')).toBeInTheDocument();
  });

  it('navigates from its rows', async () => {
    const user = userEvent.setup();
    const router = renderMore();

    await user.click(await screen.findByRole('button', { name: /^Weight/ }));
    expect(await screen.findByRole('heading', { name: 'Weight screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.weight);

    await router.navigate(PATHS.more);
    await user.click(await screen.findByRole('button', { name: /^Settings/ }));
    expect(router.state.location.pathname).toBe(PATHS.settings);

    for (const [label, path] of [
      ['Places', PATHS.places],
      ['Usuals', PATHS.usuals],
      ['Pots', PATHS.pots],
      ['Activity', PATHS.activity],
    ] as const) {
      await router.navigate(PATHS.more);
      await user.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }));
      expect(await screen.findByRole('heading', { name: `${label} screen` })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(path);
    }

    // Goals (Phase 5) still goes to the placeholder.
    await router.navigate(PATHS.more);
    await user.click(await screen.findByRole('button', { name: /^Goals/ }));
    expect(await screen.findByRole('heading', { name: 'Soon: goals' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.soon('goals'));
  });
});
