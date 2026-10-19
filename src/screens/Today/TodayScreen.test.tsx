import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { deleteMeal, loadDemoData, resetAll, setWeeklyFocus } from '@/db/actions';
import { putDayRecord } from '@/db/repo';
import { instantAt } from '@/domain/day';
import { FOCUS_RULES } from '@/domain/focus';
import { resetUiState, useUiStore } from '@/state/ui';
import TodayScreen from './TodayScreen';

const WEEK = '2026-10-12';
const YESTERDAY = '2026-10-15';

function renderToday() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <TodayScreen /> },
      { path: '/diary/entry/:id', element: <p>Entry screen</p> },
      { path: '/ideas', element: <p>Ideas screen</p> },
      { path: '/more/soon/:what', element: <p>Soon screen</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('TodayScreen (S08)', () => {
  beforeEach(async () => {
    resetUiState();
    await resetAll();
    await loadDemoData();
  });

  afterEach(() => {
    resetUiState();
  });

  it('shows the demo Friday: 570 left, +650 saved, 4,820 left this week, two meals and an empty dinner', async () => {
    renderToday();

    expect(await screen.findByText('570')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Fri 16 Oct')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Goal: Cut · 1,800' })).toBeInTheDocument();

    expect(screen.getByText('Left today')).toBeInTheDocument();
    expect(screen.getByText('+650')).toBeInTheDocument();
    expect(screen.getByText('4,820')).toBeInTheDocument();
    expect(screen.getByText('1,230 eaten · window closes 10:40pm')).toBeInTheDocument();
    expect(screen.getByText('Sat: 2,450 room')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /This week: Mon 1,620, Tue 1,710, Wed 1,540, Thu 1,680, today 1,230 of 1,800, Sat makan day, 2,450 room, Sun 1,800 planned/ })).toBeInTheDocument();

    expect(screen.getByText('Protein · behind')).toBeInTheDocument();

    expect(await screen.findByText('Roti canai + teh tarik')).toBeInTheDocument();
    expect(screen.getByText('Economy rice')).toBeInTheDocument();
    expect(await screen.findByText('Breakfast · 10:40am · Nasi kandar near home')).toBeInTheDocument();
    expect(screen.getByText('Lunch · 2:15pm · Kedai near home')).toBeInTheDocument();
    expect(screen.getByText('~560')).toBeInTheDocument();
    expect(screen.getByText('~670')).toBeInTheDocument();
    expect(screen.getByText('Late for you')).toBeInTheDocument();

    expect(screen.getByText('Dinner')).toBeInTheDocument();
    expect(screen.getByText('Not logged yet')).toBeInTheDocument();
    expect(screen.getByText('Protein is behind: ~68g left. A protein-heavy dinner helps.')).toBeInTheDocument();

    // No check-in waiting and no focus this week in the demo; 7:10pm is too early for the sleep tap.
    expect(screen.queryByText(/looks incomplete/)).not.toBeInTheDocument();
    expect(screen.queryByText("This week's focus:")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Going to sleep/ })).not.toBeInTheDocument();
  });

  it('opens the budget breakdown from the hero card and meal ideas from the empty dinner', async () => {
    const user = userEvent.setup();
    const router = renderToday();

    await user.click(await screen.findByRole('button', { name: /570 kcal left today/ }));
    expect(router.state.location.search).toBe('?sheet=budget');

    await user.click(screen.getByRole('button', { name: 'Meal ideas for dinner' }));
    expect(await screen.findByText('Ideas screen')).toBeInTheDocument();
  });

  it('opens an entry when a meal is tapped', async () => {
    const user = userEvent.setup();
    renderToday();
    await user.click(await screen.findByText('Economy rice'));
    expect(await screen.findByText('Entry screen')).toBeInTheDocument();
  });

  it('deletes a meal with an Undo toast', async () => {
    const user = userEvent.setup();
    renderToday();

    await user.click(await screen.findByRole('button', { name: 'More actions for Roti canai + teh tarik' }));
    // Only the open row's actions are reachable.
    const del = screen.getAllByRole('button', { name: 'Delete' }).find((b) => b.getAttribute('tabindex') === '0');
    expect(del).toBeDefined();
    await user.click(del as HTMLElement);

    expect(await screen.findByText('1,130')).toBeInTheDocument();
    expect(screen.queryByText('Roti canai + teh tarik')).not.toBeInTheDocument();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Deleted · Roti canai + teh tarik');

    await act(async () => {
      toast?.undo?.();
    });
    expect(await screen.findByText('Roti canai + teh tarik')).toBeInTheDocument();
    expect(await screen.findByText('570')).toBeInTheDocument();
  });

  it('shows this week’s focus with its progress', async () => {
    const { label, sub } = FOCUS_RULES.drinksKurang;
    await setWeeklyFocus(WEEK, { label, sub, ruleId: 'drinksKurang' });
    renderToday();

    expect(await screen.findByText("This week's focus:")).toBeInTheDocument();
    expect(screen.getByText(/kurang manis for drinks/)).toBeInTheDocument();
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 drinks kurang or kosong so far')).toBeInTheDocument();
  });

  it('asks about yesterday when it looks incomplete, with savings held back', async () => {
    await deleteMeal(`meal-${YESTERDAY}-dinner`);
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
    const user = userEvent.setup();
    const router = renderToday();

    const banner = await screen.findByRole('button', { name: /Yesterday looks incomplete\./ });
    expect(within(banner).getByText(/2 meals, [\d,]+ kcal\./)).toBeInTheDocument();
    // Mon–Wed saved 530; Thursday's savings wait for the check-in.
    expect(await screen.findByText('+530')).toBeInTheDocument();
    expect(screen.getByText(/waiting for check-in/)).toBeInTheDocument();

    await user.click(banner);
    expect(router.state.location.search).toBe('?sheet=checkin');
  });

  it('shows a lighter note when yesterday looks complete but isn’t confirmed', async () => {
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
    renderToday();
    expect(await screen.findByRole('button', { name: /Yesterday isn't confirmed yet\./ })).toBeInTheDocument();
  });

  it('shows the sleep tap near your usual sleep time, with Undo', async () => {
    // Usually asleep around 7:30pm on these days: the button shows from 6:30pm.
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14', YESTERDAY]) {
      await putDayRecord(db, { logicalDay: day, status: 'complete', sleepAt: instantAt(day, 19, 30) });
    }
    const user = userEvent.setup();
    renderToday();

    await user.click(await screen.findByRole('button', { name: 'Going to sleep' }));
    expect(await screen.findByText('Good night · 7:10pm')).toBeInTheDocument();
    expect((await db.days.get('2026-10-16'))?.sleepAt).toBe('2026-10-16T11:10:00.000Z');

    await user.click(screen.getByRole('button', { name: 'Undo going to sleep' }));
    expect(await screen.findByRole('button', { name: 'Going to sleep' })).toBeInTheDocument();
    expect((await db.days.get('2026-10-16'))?.sleepAt).toBeUndefined();
  });

  it('greets a first day with a nudge to log the first meal', async () => {
    await db.meals.clear();
    const user = userEvent.setup();
    const router = renderToday();

    expect(await screen.findByText('Log your first meal')).toBeInTheDocument();
    expect(screen.getByText('A rough guess is fine.')).toBeInTheDocument();
    expect(screen.getByText('Nothing logged yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log a meal' }));
    expect(router.state.location.search).toBe('?sheet=log');
  });
});
