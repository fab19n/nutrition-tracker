import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { resetUiState } from '@/state/ui';
import PlanScreen from './PlanScreen';

const SLOW = { timeout: 4000 };

function renderPlan() {
  const router = createMemoryRouter(
    [
      { path: PATHS.insights, element: <p>Insights route</p> },
      { path: PATHS.plan, element: <PlanScreen /> },
    ],
    { initialEntries: [PATHS.plan] },
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

/** The demo world: a Cut since Mon 28 Sep at 1,800 a day, on Fri 16 Oct (day 19), with last Tuesday's futsal. */
describe('Your plan on the demo world', () => {
  it('names the goal, when it began, and what it asks for', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { level: 1, name: 'Your plan' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Cut', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Since 28 Sep 2026 · 3 weeks in')).toBeInTheDocument();
    expect(screen.getByText('Target 1,800 kcal a day · Plan −0.5 kg a week')).toBeInTheDocument();
  });

  it('sets the weight trend against the plan, with a chart a screen reader can read', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: '0.7 kg behind plan' }, SLOW)).toBeInTheDocument();
    // The tile and the chart's legend both say "Your trend".
    expect(screen.getAllByText('Your trend')).toHaveLength(2);
    expect(screen.getByText('Plan expects')).toBeInTheDocument();
    expect(screen.getByText('Pace a week')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Weight trend 78.0 kg, 0.7 kg short of the plan.' })).toBeInTheDocument();
  });

  it('measures the finished days against their budgets, week by week', async () => {
    renderPlan();
    expect(await screen.findByText('17 of 18', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('14 of 17')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Week by week' })).toBeInTheDocument();
    // Newest week first: this week so far, then last week with its futsal, then the first.
    expect(screen.getByText('12–18 Oct')).toBeInTheDocument();
    expect(screen.getByText('5–11 Oct')).toBeInTheDocument();
    expect(screen.getByText('6 days · +470 from workouts')).toBeInTheDocument();
    expect(screen.getByText('28 Sep–4 Oct')).toBeInTheDocument();
  });

  it('shows what the workouts added, and the same days without them', async () => {
    renderPlan();
    expect(await screen.findByText('Added to your budgets', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('1 workout day · about 190 a week')).toBeInTheDocument();
    expect(screen.getByText('+470')).toBeInTheDocument();
    expect(screen.getByText('Result, workouts counted')).toBeInTheDocument();
    expect(screen.getByText('Same days, no workouts')).toBeInTheDocument();
    expect(screen.getByText(/estimated net burn/)).toBeInTheDocument();
  });

  it('checks the logs against the weight, as an early read at 17 complete days', async () => {
    renderPlan();
    expect(await screen.findByRole('heading', { name: 'Do your logs match your weight?' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Early read · 17 complete days')).toBeInTheDocument();
    expect(screen.getByText('Your logs imply')).toBeInTheDocument();
    expect(screen.getByText('Your weight trend implies')).toBeInTheDocument();
    expect(screen.getByText(/never changes your target/)).toBeInTheDocument();
  });

  it('goes back to Insights', async () => {
    const user = userEvent.setup();
    const router = renderPlan();
    await screen.findByRole('heading', { name: '0.7 kg behind plan' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Insights route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.insights);
  });
});
