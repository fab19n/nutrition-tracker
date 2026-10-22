import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DISH_CHECK_FEEDBACK_ID, answerDish, finishDishCheck } from '@/db/dishCheck';
import { getInsightFeedback } from '@/db/repo';
import { clearTargetNoticeSeen, TARGET_FEEDBACK_ID } from '@/db/targetSuggestion';
import { resetUiState, useUiStore } from '@/state/ui';
import { loadMaintenanceWorld, pinClock } from '@/test/maintenanceWorld';
import InsightsScreen from './InsightsScreen';

const SLOW = { timeout: 4000 };

function renderInsights() {
  const router = createMemoryRouter(
    [
      { path: PATHS.insights, element: <InsightsScreen /> },
      { path: PATHS.weekly, element: <p>Weekly review route</p> },
      { path: PATHS.target, element: <p>Target suggestion route</p> },
      { path: PATHS.dishes, element: <p>Top dishes route</p> },
      { path: PATHS.timing, element: <p>Timing detail route</p> },
    ],
    { initialEntries: [PATHS.insights] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  resetUiState();
  clearTargetNoticeSeen();
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

  it('has no target suggestion on day 19', async () => {
    renderInsights();
    expect(await screen.findByRole('heading', { name: 'Drinks were 17% of your calories' })).toBeInTheDocument();
    expect(screen.queryByText('Target suggestion')).toBeNull();
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

describe('S31 InsightsScreen top dishes check (S34 entry)', () => {
  const heading = () => screen.findByRole('heading', { name: 'Check your top dishes' }, SLOW);
  const toastMessage = () => useUiStore.getState().toast?.message;

  it('offers the check under the weekly review, and Start opens it', async () => {
    const user = userEvent.setup();
    const router = renderInsights();
    const title = await heading();
    expect(screen.getByText('Your 27 most-logged dishes, once. About 2 minutes.')).toBeInTheDocument();
    const review = screen.getByRole('button', { name: /Your weekly review is ready/ });
    expect(review.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Top dishes route', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.dishes);
    // Opening it writes nothing.
    expect(await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID)).toBeUndefined();
  });

  it('lists the check in Unlocks as you log, as Ready, and it opens the check', async () => {
    const user = userEvent.setup();
    const router = renderInsights();
    await heading();
    const row = await screen.findByRole('button', { name: /^Top dishes check/ }, SLOW);
    expect(row).toHaveTextContent('Ready');
    // After Timing patterns, before Your real maintenance.
    const bars = screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'));
    expect(bars.indexOf('Top dishes check')).toBe(bars.indexOf('Timing patterns') + 1);
    expect(bars.indexOf('Your real maintenance')).toBe(bars.indexOf('Top dishes check') + 1);
    await user.click(row);
    expect(await screen.findByText('Top dishes route', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.dishes);
  });

  it('hides the card for 4 weeks on Not now, with Undo, and the row stays', async () => {
    const user = userEvent.setup();
    const router = renderInsights();
    await heading();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(toastMessage()).toBe('Top dishes check hidden for 4 weeks'), SLOW);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull(), SLOW);
    expect((await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID))?.pausedUntil).toBe('2026-11-13');
    const row = screen.getByRole('button', { name: /^Top dishes check/ });
    expect(row).toHaveTextContent('Ready');

    // Still the way back.
    await user.click(row);
    expect(await screen.findByText('Top dishes route', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.dishes);
  });

  it('brings the card back with Undo', async () => {
    const user = userEvent.setup();
    renderInsights();
    await heading();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull(), SLOW);
    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    expect(await heading()).toBeInTheDocument();
    await waitFor(async () => expect(await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID)).toBeUndefined(), SLOW);
  });

  it('says how far you got after one answer, and offers Continue', async () => {
    await answerDish('rice-economy', 'right');
    const user = userEvent.setup();
    const router = renderInsights();
    expect(await screen.findByRole('heading', { name: 'Top dishes check' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('1 of 27 checked. Pick up where you left off.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Top dishes check/ })).toHaveTextContent('1 of 27 checked');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Top dishes route', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.dishes);
  });

  it('keeps the card hidden after Not now on a check under way, until you answer again', async () => {
    await answerDish('rice-economy', 'right');
    const user = userEvent.setup();
    renderInsights();
    await screen.findByText('1 of 27 checked. Pick up where you left off.', {}, SLOW);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('1 of 27 checked. Pick up where you left off.')).toBeNull(), SLOW);
    expect((await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID))?.dishCheck?.dishes).toHaveLength(27);
    expect(screen.getByRole('button', { name: /^Top dishes check/ })).toHaveTextContent('1 of 27 checked');
    await answerDish('teh-tarik', 'right');
    expect(await screen.findByText('2 of 27 checked. Pick up where you left off.', {}, SLOW)).toBeInTheDocument();
  });

  it('drops the card once finished, and the row says Checked while something else is locked', async () => {
    await answerDish('rice-economy', 'right');
    await finishDishCheck();
    renderInsights();
    expect(await screen.findByRole('progressbar', { name: 'Your real maintenance' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Top dishes check/ })).toHaveTextContent('Checked');
  });

  it('shows the locked row with the days so far, and no card, on days 1-6', async () => {
    await db.profile.update('me', { startedOn: '2026-10-14' });
    await db.meals.where('logicalDay').below('2026-10-14').delete();
    renderInsights();
    expect(await screen.findByText('Week 1 · day 3', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Top dishes check' })).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('3 of 14 days')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Top dishes check/ })).toBeNull();
  });

  it('keeps the card off the early state even when the dishes are ready', async () => {
    await db.profile.update('me', { startedOn: '2026-10-14' });
    renderInsights();
    expect(await screen.findByText('Week 1 · day 3', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull();
  });
});

describe('S31 InsightsScreen timing details link', () => {
  it('opens Timing detail from the When you ate heading', async () => {
    const user = userEvent.setup();
    const router = renderInsights();
    expect(await screen.findByRole('heading', { name: 'When you ate' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Timing details' }));
    expect(await screen.findByText('Timing detail route', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.timing);
    expect(router.state.location.search).toBe('');
  });

  it('has no When you ate section, so no link, on days 1-6', async () => {
    await db.profile.update('me', { startedOn: '2026-10-14' });
    renderInsights();
    expect(await screen.findByText('Week 1 · day 3', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Timing details' })).toBeNull();
  });
});

describe('S31 InsightsScreen with a target suggestion waiting (Fri 30 Oct)', () => {
  const card = () => screen.findByRole('article', { name: 'Your real maintenance looks like ~2,100, not 2,350' });

  beforeEach(async () => {
    await loadMaintenanceWorld(db);
    pinClock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts the compact card first, and keeps the same finding out of the top 3', async () => {
    renderInsights();
    const article = await card();
    expect(within(article).getByText('Target suggestion')).toBeInTheDocument();
    expect(within(article).getByText('Based on 4 weeks')).toBeInTheDocument();
    expect(within(article).getByText('Starts tomorrow (Sat) if you approve.')).toBeInTheDocument();
    const trend = await screen.findByText('Trend');
    expect(article.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Maintenance is about 2,100, not 2,350' })).toBeNull();
    expect(within(article).queryByRole('button', { name: /Change pace instead/ })).toBeNull();
  });

  it('approves in place, and Undo brings the card back', async () => {
    const user = userEvent.setup();
    renderInsights();
    await user.click(within(await card()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Target 1,550 from tomorrow'));
    await waitFor(() => expect(screen.queryByText('Target suggestion')).toBeNull());
    expect((await db.goalVersions.toArray()).map((v) => v.dailyKcal).sort()).toEqual([1550, 1800]);

    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    expect(await card()).toBeInTheDocument();
    await waitFor(async () => expect(await db.goalVersions.count()).toBe(1));
  });

  it('keeps the current target in place, and Undo brings the card back', async () => {
    const user = userEvent.setup();
    renderInsights();
    await user.click(within(await card()).getByRole('button', { name: 'Keep current' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Target stays at 1,800'));
    await waitFor(() => expect(screen.queryByText('Target suggestion')).toBeNull());
    expect((await getInsightFeedback(db, TARGET_FEEDBACK_ID))?.feedback).toBe('keepCurrent');

    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    expect(await card()).toBeInTheDocument();
  });

  it('opens S37 from "See the working"', async () => {
    const user = userEvent.setup();
    const router = renderInsights();
    await user.click(within(await card()).getByRole('button', { name: 'See the working' }));
    expect(await screen.findByText('Target suggestion route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.target);
  });

  it('lists the weigh-ins the maintenance read still needs', async () => {
    await loadMaintenanceWorld(db, { weighInEvery: 7 });
    renderInsights();
    expect(await screen.findByRole('progressbar', { name: 'Weigh-ins for your maintenance' })).toBeInTheDocument();
    expect(screen.getByText('4 of 8 weigh-ins')).toBeInTheDocument();
    expect(screen.queryByText('Target suggestion')).toBeNull();
  });
});

