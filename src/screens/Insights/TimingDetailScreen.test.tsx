import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll, setSleepTap } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState } from '@/state/ui';
import TimingDetailScreen from './TimingDetailScreen';

const SLOW = { timeout: 4000 };
const THURSDAY = '2026-10-15';
const TIMING = PATHS.timing;

function Stub({ name }: { name: string }) {
  const location = useLocation();
  return (
    <h1>
      {name} screen {location.pathname}
    </h1>
  );
}

function renderTiming(url: string = TIMING, { history = false }: { history?: boolean } = {}) {
  const router = createMemoryRouter(
    [
      { path: PATHS.timing, element: <TimingDetailScreen /> },
      { path: PATHS.insights, element: <Stub name="Insights" /> },
    ],
    history ? { initialEntries: [PATHS.insights, url], initialIndex: 1 } : { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

const numbers = () => screen.findByRole('list', { name: 'Timing numbers' }, SLOW);
const timeline = () => screen.getByRole('img', { name: /Eating window|Going to sleep tap|No meals logged/ });

/** Cut until the 14th, a Pause goal for the 14th, back on Cut from the 15th. */
async function pauseThe14th() {
  await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-14' });
  await db.goalPeriods.put({ id: 'pause-period', goalId: DEMO_IDS.goals.pause, from: '2026-10-14', to: '2026-10-15' });
  await db.goalPeriods.put({ id: 'cut-again', goalId: DEMO_IDS.goals.cut, from: '2026-10-15' });
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterAll(async () => {
  await resetAll();
});

describe('S35 TimingDetailScreen on the demo Friday (day 19, today so far)', () => {
  it('shows a skeleton while it loads', () => {
    renderTiming();
    expect(screen.getByRole('heading', { level: 1, name: 'Timing' })).toBeInTheDocument();
    expect(screen.getByText('Fri 16 Oct · Today')).toBeInTheDocument();
    expect(screen.getByText('Loading timing')).toBeInTheDocument();
  });

  it('has no early-read banner on day 19, and no sleep button (it only reads the tap)', async () => {
    renderTiming();
    await numbers();
    expect(screen.queryByText('Early read.')).toBeNull();
    expect(screen.queryByText('Paused.')).toBeNull();
    expect(screen.queryByRole('button', { name: /going to sleep/i })).toBeNull();
  });

  it('draws the strip with the window, the meals, the 4-hour captions and now', async () => {
    renderTiming();
    await numbers();
    expect(screen.getByText('Window opened 10:40am')).toBeInTheDocument();
    expect(screen.getByText('closes 10:40pm')).toBeInTheDocument();
    expect(timeline()).toHaveAccessibleName(
      'Eating window 10:40am to 10:40pm. Breakfast 10:40am, late for you. Lunch 2:15pm. Now 7:10pm.',
    );
    // Both ends of the strip, and the first label of the week grid's axis.
    expect(screen.getAllByText('5am')).toHaveLength(3);
    for (const caption of ['9am', '1pm', '5pm', '9pm', '1am']) expect(screen.getByText(caption)).toBeInTheDocument();
  });

  it('explains the strip with words, only for what it shows', async () => {
    renderTiming();
    await numbers();
    const key = screen.getByRole('list', { name: 'Timeline key' });
    expect(within(key).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['On time', 'Late for you', 'Eating window']);
  });

  it('reads the day against your own times and the Cut rules', async () => {
    renderTiming();
    const list = await numbers();
    expect(screen.getByRole('heading', { name: 'Today so far' })).toBeInTheDocument();
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);

    expect(rows[0]).toHaveTextContent('First meal');
    expect(rows[0]).toHaveTextContent('10:40am');
    expect(rows[0]).toHaveTextContent('Breakfast · 1 h 10 min later than your usual 9:30am');
    expect(rows[1]).toHaveTextContent('Last meal');
    expect(rows[1]).toHaveTextContent('2:15pm');
    expect(rows[1]).toHaveTextContent('Lunch');
    expect(rows[2]).toHaveTextContent('Eating window');
    expect(rows[2]).toHaveTextContent('3.6 h');
    expect(rows[2]).toHaveTextContent('First bite to last bite so far');
    expect(rows[2]).toHaveTextContent('Within your 12 h limit');
    expect(rows[3]).toHaveTextContent('Eating occasions');
    expect(rows[3]).toHaveTextContent('Meals within 30 min count as one so far');
    expect(rows[3]).toHaveTextContent('Within your limit of 5');
    expect(within(rows[3] as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(rows[4]).toHaveTextContent('Last meal before sleep');
    expect(rows[4]).toHaveTextContent('Waiting for a Going to sleep tap');
  });

  it('lists the real meals with their timing tags', async () => {
    renderTiming();
    await numbers();
    const meals = screen.getByRole('list', { name: 'Meals' });
    const items = within(meals).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('10:40am');
    expect(items[0]).toHaveTextContent('Breakfast');
    expect(within(items[0] as HTMLElement).getByText('Late for you')).toBeInTheDocument();
  });

  it("shows this week's grid, and the Going to sleep explainer", async () => {
    renderTiming();
    await numbers();
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument();
    const grid = screen.getByRole('img', { name: /^Average window \d+\.\d h\. This week\. Late meals on \d+ days?\.$/ });
    expect(within(grid).getAllByText(/^[MTWFS]$/)).toHaveLength(7);
    expect(screen.getByText(/^Average window \d+\.\d h$/)).toBeInTheDocument();
    for (const axis of ['noon', '6pm', 'midnight']) expect(within(grid.parentElement as HTMLElement).getByText(axis)).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Going to sleep' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "On Today, a Going to sleep button shows up in the evening. It shows up from 10pm until the app learns your usual sleep time. Tap it when you head to bed. It's optional, and the app works without it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("With a tap, the app checks your last meal against your goal's rule: 2 h or more before sleep."),
    ).toBeInTheDocument();
    expect(screen.getByText('Without a tap, that check is skipped for the day. A missing tap is never read as a late meal.')).toBeInTheDocument();
    expect(screen.getByText('Tapped it by mistake? Use Undo on Today.')).toBeInTheDocument();
  });

  it('names the usual Going to sleep time once the app has learned it', async () => {
    await setSleepTap('2026-10-14', '2026-10-14T17:00:00.000Z'); // 1:00am
    await setSleepTap('2026-10-13', '2026-10-13T16:30:00.000Z'); // 12:30am
    renderTiming();
    await numbers();
    expect(
      await screen.findByText(/It shows up from about an hour before your usual sleep time, around 11:45pm\./, {}, SLOW),
    ).toBeInTheDocument();
  });

  it('never writes', async () => {
    const before = await Promise.all([db.meals.count(), db.days.count(), db.insightFeedback.count(), db.personalItems.count()]);
    renderTiming();
    await numbers();
    expect(await Promise.all([db.meals.count(), db.days.count(), db.insightFeedback.count(), db.personalItems.count()])).toEqual(before);
  });
});

describe('S35 TimingDetailScreen on a finished day (?day=2026-10-15)', () => {
  const url = `${TIMING}?day=${THURSDAY}`;

  it('measures the last meal before a 1:30am Going to sleep tap against the 2 h rule', async () => {
    await setSleepTap(THURSDAY, '2026-10-15T17:30:00.000Z');
    renderTiming(url);
    const list = await numbers();
    expect(screen.getByText('Thu 15 Oct · Yesterday')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The day in numbers' })).toBeInTheDocument();
    const rows = within(list).getAllByRole('listitem');
    expect(rows[2]).toHaveTextContent('11.3 h');
    expect(rows[2]).toHaveTextContent('First bite to last bite');
    expect(rows[2]).not.toHaveTextContent('so far');
    expect(rows[2]).toHaveTextContent('Within your 12 h limit');
    expect(rows[4]).toHaveTextContent('4.8 h');
    expect(rows[4]).toHaveTextContent('You tapped Going to sleep at 1:30am');
    expect(rows[4]).toHaveTextContent('Meets your rule of 2 h or more');

    const key = screen.getByRole('list', { name: 'Timeline key' });
    expect(within(key).getByText('Going to sleep')).toBeInTheDocument();
    expect(timeline()).toHaveAccessibleName(expect.stringContaining('Going to sleep tap at 1:30am.'));
    // A finished day has no now marker.
    expect(timeline().getAttribute('aria-label')).not.toMatch(/Now /);
  });

  it('skips the sleep row, in words, when there was no tap', async () => {
    renderTiming(url);
    const rows = within(await numbers()).getAllByRole('listitem');
    expect(rows[4]).toHaveTextContent('Last meal before sleep');
    expect(rows[4]).toHaveTextContent('Skipped: no Going to sleep tap this day');
    expect(rows[4]).not.toHaveTextContent('Waiting');
    expect(rows[4]).not.toHaveTextContent('rule');
    expect(within(screen.getByRole('list', { name: 'Timeline key' })).queryByText('Going to sleep')).toBeNull();
  });

  it('is fine with a tap 2.25 h after dinner, with a check icon and a word', async () => {
    await setSleepTap(THURSDAY, '2026-10-15T15:00:00.000Z'); // 11:00pm, dinner at 8:45pm
    renderTiming(url);
    const rows = within(await numbers()).getAllByRole('listitem');
    expect(rows[4]).toHaveTextContent('2.3 h');
    const status = within(rows[4] as HTMLElement).getByText('Meets your rule of 2 h or more');
    expect(status.parentElement?.querySelector('svg.lucide-circle-check')).not.toBeNull();
  });

  it('flags a tap an hour after the last meal with a word and an icon, not colour alone', async () => {
    await setSleepTap(THURSDAY, '2026-10-15T13:45:00.000Z'); // 9:45pm
    renderTiming(url);
    const rows = within(await numbers()).getAllByRole('listitem');
    expect(rows[4]).toHaveTextContent('1.0 h');
    const status = within(rows[4] as HTMLElement).getByText('Less than your 2 h rule');
    expect(status.parentElement?.querySelector('svg.lucide-circle-alert')).not.toBeNull();
  });

  it('leaves meals logged after the tap out, and says so', async () => {
    await setSleepTap(THURSDAY, '2026-10-15T11:00:00.000Z'); // 7:00pm, before the 8:45pm dinner
    renderTiming(url);
    const rows = within(await numbers()).getAllByRole('listitem');
    expect(rows[4]).toHaveTextContent('You tapped Going to sleep at 7:00pm · 1 meal after the tap left out');
  });
});

describe('S35 TimingDetailScreen day switcher', () => {
  it('steps back to yesterday and forward again, with replace, never past today', async () => {
    const { user, router } = renderTiming();
    await numbers();
    expect(screen.getByRole('button', { name: 'Next: Sat' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous: Thu' }));
    expect(router.state.location.search).toBe('?day=2026-10-15');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('Thu 15 Oct · Yesterday', {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'The day in numbers' })).toBeInTheDocument(), SLOW);
    // The week stays the same week.
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous: Wed' }));
    expect(router.state.location.search).toBe('?day=2026-10-14');

    await user.click(screen.getByRole('button', { name: 'Next: Thu' }));
    await user.click(screen.getByRole('button', { name: 'Next: Fri' }));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText('Fri 16 Oct · Today', {}, SLOW)).toBeInTheDocument();
  });

  it('shows the earlier week with its dates when you step across a Monday', async () => {
    const { user } = renderTiming(`${TIMING}?day=2026-10-12`);
    await numbers();
    await user.click(screen.getByRole('button', { name: 'Previous: Sun' }));
    expect(await screen.findByText('Sun 11 Oct', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '5–11 Oct' }, SLOW)).toBeInTheDocument();
  });

  it('puts an invalid or future ?day= on today', async () => {
    renderTiming(`${TIMING}?day=garbage`);
    expect(await screen.findByText('Fri 16 Oct · Today', {}, SLOW)).toBeInTheDocument();
  });

  it('clamps a future ?day= to today', async () => {
    renderTiming(`${TIMING}?day=2026-10-30`);
    expect(await screen.findByText('Fri 16 Oct · Today', {}, SLOW)).toBeInTheDocument();
  });

  it('stops at the first day of use', async () => {
    renderTiming(`${TIMING}?day=2026-09-01`);
    expect(await screen.findByText('Mon 28 Sep', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next: Tue' })).toBeEnabled();
  });
});

describe('S35 TimingDetailScreen special days', () => {
  it('says early read when the first day of use is recent, on the banner and the grid', async () => {
    await db.profile.update('me', { startedOn: '2026-10-07' });
    renderTiming();
    await numbers();
    expect(screen.getByText('Early read.')).toBeInTheDocument();
    expect(screen.getByText(/Based on 8 complete days\. Your usual times firm up by day 14\./)).toBeInTheDocument();
    expect(screen.getByText('Early read · 8 days')).toBeInTheDocument();
  });

  it('shows a paused day with a note, no window, no tags and no numbers, and blanks it in the week', async () => {
    await pauseThe14th();
    renderTiming(`${TIMING}?day=2026-10-14`);
    expect(await screen.findByText('Paused.', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/Timing is off while your goal is paused\. This day stays out of timing insights\./)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Timing numbers' })).toBeNull();
    expect(screen.queryByText(/Window opened/)).toBeNull();
    expect(screen.queryByText('Late for you')).toBeNull();
    expect(screen.queryByText('On time')).toBeNull();
    const key = screen.getByRole('list', { name: 'Timeline key' });
    expect(within(key).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Meal']);
    // The meals themselves are still listed, without tags.
    expect(within(screen.getByRole('list', { name: 'Meals' })).getAllByRole('listitem').length).toBeGreaterThan(0);
    // The week blanks that day (Wed) and keeps the others.
    const grid = screen.getByRole('img', { name: /^Average window/ });
    const rows = Array.from(grid.children);
    expect(rows).toHaveLength(7);
    const dotsIn = (row: Element | undefined) => row?.querySelectorAll('[class*="_dot_"]').length ?? -1;
    expect(dotsIn(rows[2])).toBe(0);
    expect(dotsIn(rows[1])).toBeGreaterThan(0);
    expect(dotsIn(rows[3])).toBeGreaterThan(0);
  });

  it('says so on a day with no meals, with no numbers', async () => {
    await db.meals.bulkDelete([DEMO_IDS.meals.todayBreakfast, DEMO_IDS.meals.todayLunch]);
    renderTiming();
    expect(await screen.findByText('No meals logged this day.', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Timing numbers' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Meals' })).toBeNull();
    expect(timeline()).toHaveAccessibleName('No meals logged. Now 7:10pm.');
    expect(screen.queryByRole('list', { name: 'Timeline key' })).toBeNull();
    // The week and the explainer are still there.
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Going to sleep' })).toBeInTheDocument();
  });

  it('needs two meals for a window', async () => {
    await db.meals.delete(DEMO_IDS.meals.todayLunch);
    renderTiming();
    const rows = within(await numbers()).getAllByRole('listitem');
    expect(rows[2]).toHaveTextContent('Eating window');
    expect(rows[2]).toHaveTextContent('—');
    expect(rows[2]).toHaveTextContent('Needs two meals');
    expect(rows[3]).toHaveTextContent('Eating occasions');
  });
});

describe('S35 TimingDetailScreen Back', () => {
  it('goes back to where you came from', async () => {
    const { user, router } = renderTiming(TIMING, { history: true });
    await numbers();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.insights);
  });

  it('replaces a deep link with Insights', async () => {
    const { user, router } = renderTiming(`${TIMING}?day=2026-10-15`);
    await numbers();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
