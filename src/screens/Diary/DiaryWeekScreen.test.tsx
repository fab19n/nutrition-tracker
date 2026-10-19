import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState } from '@/state/ui';
import DiaryWeekScreen from './DiaryWeekScreen';

const SLOW = { timeout: 4000 };

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

function renderWeek(url = '/diary/week') {
  const router = createMemoryRouter(
    [
      { path: '/diary', element: <Probe name="Day" /> },
      { path: '/diary/week', element: <DiaryWeekScreen /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The row for a weekday ("Mon") in the day list. */
function dayRow(weekday: string): HTMLElement {
  const label = screen.getAllByText(weekday).find((el) => el.closest('[class*="_dayRow_"]'));
  const row = label?.closest('[class*="_dayRow_"]');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${weekday}`);
  return row;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('DiaryWeekScreen (S13)', () => {
  it('shows this week: bars, target, savings and one row per day', async () => {
    renderWeek();

    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('12–18 Oct · This week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous: Last week' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    expect(await screen.findByText('Target 1,800 a day', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Saved so far')).toBeInTheDocument();
    expect(screen.getByText('+650')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Fri 1,230 so far of 1,800\. Sat makan day, 2,450 planned\. Sun 1,800 planned\./ })).toBeInTheDocument();

    const expected: [string, string, string][] = [
      ['Mon', 'Complete', '1,620'],
      ['Tue', 'Complete', '1,710'],
      ['Wed', 'Complete', '1,540'],
      ['Thu', 'Complete', '1,680'],
      ['Fri', 'In progress', '1,230'],
      ['Sat', 'Makan day', '2,450'],
      ['Sun', 'Planned', '1,800'],
    ];
    for (const [day, status, kcal] of expected) {
      const row = dayRow(day);
      expect(within(row).getByText(status)).toBeInTheDocument();
      expect(row).toHaveTextContent(`${kcal} kcal`);
    }
    // Planned days can't be opened yet.
    expect(dayRow('Sat').tagName).toBe('DIV');
    expect(dayRow('Fri').tagName).toBe('BUTTON');
  });

  it('goes back to last week: over, a not-counted Sunday and the makan Saturday', async () => {
    const user = userEvent.setup();
    const router = renderWeek();
    await screen.findByText('Target 1,800 a day', {}, SLOW);

    await user.click(screen.getByRole('button', { name: 'Previous: Last week' }));
    expect(router.state.location.search).toBe('?week=2026-10-05');
    expect(await screen.findByText('5–11 Oct · Last week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: This week' })).toBeEnabled();

    expect(await screen.findByText('Over', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('+350')).toBeInTheDocument();
    expect(within(dayRow('Sun')).getByText('Not counted')).toBeInTheDocument();
    expect(dayRow('Sun')).toHaveTextContent('1,050 kcal');
    expect(within(dayRow('Sat')).getByText('Makan day')).toBeInTheDocument();
    expect(dayRow('Sat')).toHaveTextContent('2,420 kcal');
    expect(dayRow('Tue')).toHaveTextContent('2,150 kcal');

    await user.click(screen.getByRole('button', { name: 'Next: This week' }));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText('12–18 Oct · This week')).toBeInTheDocument();
  });

  it('stops at the first week of use', async () => {
    renderWeek('/diary/week?week=2026-09-28');
    expect(await screen.findByText('28 Sep–4 Oct')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Previous' }, SLOW)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next: Last week' })).toBeEnabled();
  });

  it('opens a day from its row', async () => {
    const user = userEvent.setup();
    const router = renderWeek();
    await screen.findByText('Target 1,800 a day', {}, SLOW);

    await user.click(dayRow('Thu'));
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.location.search).toBe('?day=2026-10-15');
  });

  it('opens today from the Day switch, or the last day of a past week', async () => {
    const user = userEvent.setup();
    const router = renderWeek('/diary/week?week=2026-10-05');
    await screen.findByText('5–11 Oct · Last week');
    await user.click(screen.getByRole('radio', { name: 'Day' }));
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.location.search).toBe('?day=2026-10-11');
  });

  it('views the week under the current goal and switches back', async () => {
    const user = userEvent.setup();
    // The target went up to 2,000 from today: Mon–Thu stay at 1,800 under the goal at the time.
    await db.goalVersions.put({
      id: 'goal-version-cut-2',
      goalId: DEMO_IDS.goals.cut,
      effectiveFrom: '2026-10-16',
      dailyKcal: 2000,
      proteinG: 110,
      carbsG: 200,
      fatG: 65,
      maintenanceKcal: 2550,
      reason: 'manualEdit',
      createdAt: '2026-10-16T01:00:00.000Z',
    });
    renderWeek();

    expect(await screen.findByText('Target 1,800–2,000 a day', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('+650')).toBeInTheDocument();
    expect(dayRow('Sun')).toHaveTextContent('2,000 kcal');

    await user.click(screen.getByRole('radio', { name: 'Current goal' }));
    expect(await screen.findByText(/Viewing this week under Cut\. Your meals haven.t changed\./)).toBeInTheDocument();
    expect(screen.getByText('Target 2,000 a day')).toBeInTheDocument();
    // 4 × 2,000 − (1,620 + 1,710 + 1,540 + 1,680) = 1,450 saved.
    expect(screen.getByText('+1,450')).toBeInTheDocument();
    expect(dayRow('Mon')).toHaveTextContent('1,620 kcal');

    await user.click(screen.getByRole('button', { name: /Switch back/ }));
    expect(screen.queryByText(/Viewing this week under Cut/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Goal at the time' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('+650')).toBeInTheDocument();
  });

  it('marks the day a goal switch took effect', async () => {
    await db.goalPeriods.put({ id: 'goal-period-cut-1', goalId: DEMO_IDS.goals.cut, from: '2026-09-28', to: '2026-10-14' });
    await db.goalPeriods.put({ id: 'goal-period-festive-1', goalId: DEMO_IDS.goals.festive, from: '2026-10-14' });
    renderWeek();

    expect(await screen.findByText('Festive maintain from here', {}, SLOW)).toBeInTheDocument();
    expect(within(dayRow('Wed')).getByText('Festive maintain from here')).toBeInTheDocument();
    expect(await screen.findByText('Target 1,800–2,100 a day', {}, SLOW)).toBeInTheDocument();
  });
});
