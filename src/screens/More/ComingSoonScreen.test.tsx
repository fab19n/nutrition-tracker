import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { updateGoal } from '@/db/repo';
import ComingSoonScreen from './ComingSoonScreen';

function renderSoon(what: string) {
  const router = createMemoryRouter(
    [
      { path: '/more/soon/:what', element: <ComingSoonScreen /> },
      { path: '/more', element: <h1>More screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
    ],
    { initialEntries: [PATHS.soon(what)] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('ComingSoonScreen', () => {
  it.each([
    ['goals', 'Goals', /goal library/],
    ['reminders', 'Reminders', /nudges/],
    ['backups', 'Backups', /Google Drive/],
  ])('titles /more/soon/%s as %s with an honest line', (what, title, line) => {
    renderSoon(what);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coming in the next build' })).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('names the goal that is actually running on the Goals placeholder', async () => {
    renderSoon('goals');
    expect(await screen.findByText(/Your Cut goal keeps running until then\./)).toBeInTheDocument();
    const goals = await db.goals.toArray();
    for (const goal of goals) await updateGoal(db, goal.id, { name: 'Lean bulk' });
    expect(await screen.findByText(/Your Lean bulk goal keeps running until then\./)).toBeInTheDocument();
    expect(screen.queryByText(/Cut goal/)).toBeNull();
  });

  it('goes back to More when opened directly', async () => {
    const user = userEvent.setup();
    const router = renderSoon('reminders');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe(PATHS.more);
  });

  it('links Backups to Export', async () => {
    const user = userEvent.setup();
    const router = renderSoon('backups');
    await user.click(screen.getByRole('button', { name: 'Export now' }));
    expect(router.state.location.pathname).toBe(PATHS.export);
  });

  it('falls back to a readable title for an unknown area', () => {
    renderSoon('meal-plans');
    expect(screen.getByRole('heading', { level: 1, name: 'Meal plans' })).toBeInTheDocument();
  });

  it.each(['places', 'usuals', 'pots', 'activity'])('no longer has its own placeholder for %s, which has a screen now', (what) => {
    renderSoon(what);
    expect(screen.getByText("This part of the app comes in a later build. Everything you've logged is safe.")).toBeInTheDocument();
  });
});
