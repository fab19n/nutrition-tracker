import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { getWeekPlan } from '@/db/repo';
import { DEMO_EXPECTED } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import WeeklyReviewScreen from './WeeklyReviewScreen';

function renderReview(search = '') {
  const router = createMemoryRouter(
    [
      { path: PATHS.weekly, element: <WeeklyReviewScreen /> },
      { path: PATHS.today, element: <p>Today route</p> },
      { path: PATHS.insights, element: <p>Insights route</p> },
    ],
    { initialEntries: [`${PATHS.weekly}${search}`] },
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

describe('S33 WeeklyReviewScreen', () => {
  it('step 1 shows last week: budget, trend, bars and the last focus', async () => {
    renderReview();
    expect(await screen.findByText('5–11 Oct')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('+350')).toBeInTheDocument();
    expect(screen.getByText('13,420 of 13,070')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /5–11 Oct: 1 day over target, Sunday not counted/ })).toBeInTheDocument();
    expect(screen.getByText(/6 of 7 days complete\. Sunday wasn't counted\./)).toBeInTheDocument();
    expect(screen.getByText(/Last focus, kurang manis for drinks/)).toBeInTheDocument();
    expect(screen.getByText('3 of 11')).toBeInTheDocument();
  });

  it('walks the 3 steps and puts the focus on Today', async () => {
    const router = renderReview(`?week=${DEMO_EXPECTED.lastWeekStart}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Next · top 3' }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drinks were 17% of your calories' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Useful' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next · pick one thing' }));
    expect(screen.getByRole('heading', { name: 'Pick one thing to try next week' })).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Got it, put it on Today' });
    expect(done).toBeDisabled();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    await userEvent.click(screen.getByRole('radio', { name: /Kurang manis for drinks/ }));
    expect(done).toBeEnabled();
    await userEvent.click(done);

    expect(await screen.findByText('Today route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.today);
    await waitFor(async () =>
      expect((await getWeekPlan(db, DEMO_EXPECTED.weekStart))?.focus).toMatchObject({ label: 'Kurang manis for drinks', ruleId: 'drinksKurang' }),
    );
    expect(useUiStore.getState().toast?.message).toBe("Got it. It's on your Today screen");
  });

  it('says the pick shows from Monday when it is for next week (Sunday night)', async () => {
    // The review of this week (as on Sunday night) puts its focus on the week ahead.
    renderReview(`?week=${DEMO_EXPECTED.weekStart}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Next · top 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next · pick one thing' }));
    await userEvent.click(screen.getAllByRole('radio')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Got it, put it on Today' }));

    expect(await screen.findByText('Today route')).toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toBe("Got it. It's on your Today screen from Monday");
    await waitFor(async () => expect((await getWeekPlan(db, '2026-10-19'))?.focus).toBeDefined());
  });

  it('steps back before leaving for Insights', async () => {
    const router = renderReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Next · top 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to the previous step' }));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Insights' }));
    expect(router.state.location.pathname).toBe(PATHS.insights);
  });

  it('is "What we learned about you" for the first week', async () => {
    renderReview(`?week=${DEMO_EXPECTED.weekBeforeStart}`);
    expect(await screen.findByRole('heading', { name: 'What we learned about you' })).toBeInTheDocument();
    expect(screen.getByText('28 Sep–4 Oct')).toBeInTheDocument();
    expect(screen.getByText(/Breakfast around 9:30am/)).toBeInTheDocument();
    expect(screen.getByText(/Home \(8\)/)).toBeInTheDocument();
  });
});
