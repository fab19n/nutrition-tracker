import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import ComingSoonScreen from './ComingSoonScreen';

function renderSoon(what: string) {
  const router = createMemoryRouter(
    [
      { path: '/more/soon/:what', element: <ComingSoonScreen /> },
      { path: '/more', element: <h1>More screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
      { path: '/more/backups', element: <h1>Backups screen</h1> },
      { path: '/more/goals', element: <h1>Goals screen</h1> },
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
  it.each([['reminders', 'Reminders', /nudges/]])('titles /more/soon/%s as %s with an honest line', (what, title, line) => {
    renderSoon(what);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coming in the next build' })).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('sends an old Goals link to the goal library (S41)', async () => {
    const router = renderSoon('goals');
    expect(await screen.findByRole('heading', { name: 'Goals screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.goals);
    expect(screen.queryByRole('heading', { name: 'Coming in the next build' })).toBeNull();
  });

  it('sends an old Backups link to the Backups screen (S39)', async () => {
    const router = renderSoon('backups');
    expect(await screen.findByRole('heading', { name: 'Backups screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.backups);
    expect(screen.queryByRole('heading', { name: 'Coming in the next build' })).toBeNull();
    expect(screen.queryByText(/Google Drive/)).toBeNull();
  });

  it('goes back to More when opened directly', async () => {
    const user = userEvent.setup();
    const router = renderSoon('reminders');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe(PATHS.more);
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
