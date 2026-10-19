import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { getInsightFeedback } from '@/db/repo';
import { resetUiState } from '@/state/ui';
import InsightsScreen from './InsightsScreen';

function renderInsights() {
  const router = createMemoryRouter(
    [
      { path: PATHS.insights, element: <InsightsScreen /> },
      { path: PATHS.weekly, element: <p>Weekly review route</p> },
    ],
    { initialEntries: [PATHS.insights] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterAll(async () => {
  await resetAll();
});

describe('S31 InsightsScreen on the demo world', () => {
  it('shows the header, last week’s tiles and the review card', async () => {
    renderInsights();
    expect(await screen.findByText('Week 3 · day 19')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Insights' })).toBeInTheDocument();
    expect(await screen.findByText('+350')).toBeInTheDocument();
    expect(screen.getByText('over plan')).toBeInTheDocument();
    expect(screen.getByText('6 of 7')).toBeInTheDocument();
    expect(screen.getByText('78.0 kg now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Your weekly review is ready/ })).toBeInTheDocument();
  });

  it('lists the top 3 with evidence, where it came from, recurring calories and timing', async () => {
    renderInsights();
    expect(await screen.findByRole('heading', { name: 'Drinks were 17% of your calories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nasi kandar nights cost the most' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Useful' })).toHaveLength(3);
    const categories = screen.getByRole('list', { name: 'Where it came from' });
    expect(within(categories).getByText('Drinks')).toBeInTheDocument();
    expect(within(categories).getByText('17%')).toBeInTheDocument();
    expect(screen.getByText('Nasi kandar near home')).toBeInTheDocument();
    const recurring = screen.getByRole('list', { name: 'Recurring calories' });
    expect(within(recurring).getByText(/Teh tarik/)).toBeInTheDocument();
    expect(within(recurring).getByText('· ~8 a week')).toBeInTheDocument();
    expect(screen.getByText(/^Average window \d+\.\d h$/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Your real maintenance' })).toBeInTheDocument();
  });

  it('opens the evidence sheet from "See 11 drinks"', async () => {
    const router = renderInsights();
    await userEvent.click(await screen.findByRole('button', { name: 'See 11 drinks' }));
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('sheet')).toBe('evidence');
    expect(params.get('rule')).toBe('categoryShare');
  });

  it('collapses an insight on "Not for me" and brings it back with Undo', async () => {
    renderInsights();
    const heading = await screen.findByRole('heading', { name: 'Drinks were 17% of your calories' });
    const card = heading.closest('article');
    expect(card).not.toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Not for me' }));
    expect(await screen.findByText('Paused for 4 weeks')).toBeInTheDocument();
    expect((await getInsightFeedback(db, 'categoryShare'))?.feedback).toBe('notForMe');
    await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(await screen.findByRole('heading', { name: 'Drinks were 17% of your calories' })).toBeInTheDocument();
    await waitFor(async () => expect(await getInsightFeedback(db, 'categoryShare')).toBeUndefined());
  });

  it('marks an insight useful', async () => {
    renderInsights();
    const heading = await screen.findByRole('heading', { name: 'Nasi kandar nights cost the most' });
    const useful = within(heading.closest('article') as HTMLElement).getByRole('button', { name: 'Useful' });
    await userEvent.click(useful);
    await waitFor(() => expect(useful).toHaveAttribute('aria-pressed', 'true'));
  });

  it('goes to the weekly review', async () => {
    const router = renderInsights();
    await userEvent.click(await screen.findByRole('button', { name: /Your weekly review is ready/ }));
    expect(await screen.findByText('Weekly review route')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?week=2026-10-05');
  });

  it('shows the early state on days 1–6', async () => {
    await db.profile.update('me', { startedOn: '2026-10-14' });
    renderInsights();
    expect(await screen.findByText('Week 1 · day 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More insights unlock as you log' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Useful' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Where it came from' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Weekly review and patterns' })).toBeInTheDocument();
    expect(screen.getByText('saved so far')).toBeInTheDocument();
  });
});
