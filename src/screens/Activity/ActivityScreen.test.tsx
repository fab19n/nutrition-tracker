import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { putBonus, putWorkout } from '@/db/repo';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import ActivityScreen from './ActivityScreen';

const SLOW = { timeout: 4000 };
const EMPTY_BODY = "Log a workout and its calories are added to this week's budget.";

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
    </div>
  );
}

function renderActivity(from?: string) {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/more/activity', element: <ActivityScreen /> },
      { path: '/more/activity/new', element: <Probe name="Log workout" /> },
    ],
    { initialEntries: from ? [from, '/more/activity'] : ['/more/activity'], initialIndex: from ? 1 : 0 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The list item holding a row title. */
function row(title: string): HTMLElement {
  const item = screen.getByText(title).closest('li');
  if (!item) throw new Error(`No row ${title}`);
  return item;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('ActivityScreen (S30)', () => {
  it("lists the demo's weeks: nothing yet this week, last week's futsal +470", async () => {
    renderActivity();

    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+0/ }, SLOW)).toHaveTextContent('This week · +0');
    expect(screen.getByText('Nothing logged this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Last week · \+470/ })).toBeInTheDocument();

    const futsal = row('Tue · Futsal 60 min, moderate');
    expect(within(futsal).getByText('~470')).toBeInTheDocument();
    expect(within(futsal).getByRole('button', { name: 'Delete Futsal, Tue, ~470 kcal' })).toBeInTheDocument();
    expect(screen.getByText(/Each week starts fresh on Monday\.$/)).toHaveTextContent(
      'Workout calories are added to the week they happen in, so a Tuesday session also adds room on Saturday.',
    );
  });

  it('puts + Log workout after the weeks, before the footnote (S30 order)', async () => {
    renderActivity();
    const lastWeek = await screen.findByRole('heading', { level: 2, name: /^Last week/ }, SLOW);
    const button = screen.getByRole('button', { name: 'Log workout' });
    const footnote = screen.getByText(/Each week starts fresh on Monday\.$/);
    expect(lastWeek.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row('Tue · Futsal 60 min, moderate').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens Log workout', async () => {
    const user = userEvent.setup();
    renderActivity();
    await user.click(await screen.findByRole('button', { name: 'Log workout' }, SLOW));
    expect(await screen.findByText('Log workout at /more/activity/new', {}, SLOW)).toBeInTheDocument();
  });

  it('confirms a delete from a closed week, then deletes with undo', async () => {
    const user = userEvent.setup();
    renderActivity();

    // Last week has closed (the demo is a Friday): the delete asks first.
    await user.click(await screen.findByRole('button', { name: 'Delete Futsal, Tue, ~470 kcal' }, SLOW));
    let dialog = screen.getByRole('alertdialog', { name: 'Delete from last week?' });
    expect(dialog).toHaveAccessibleDescription(
      "Futsal, Tue, ~470 kcal. Last week has closed, so this changes its budget and weekly review. This week's budget stays the same. You can undo straight after.",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.workouts.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Delete Futsal, Tue, ~470 kcal' }));
    dialog = screen.getByRole('alertdialog', { name: 'Delete from last week?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await expect.poll(() => db.workouts.count()).toBe(0);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Workout deleted');
    // Nothing left at all: the empty state.
    expect(await screen.findByText(EMPTY_BODY, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Last week/ })).not.toBeInTheDocument();

    toast?.undo?.();
    expect(await screen.findByText('Tue · Futsal 60 min, moderate', {}, SLOW)).toBeInTheDocument();
    expect(await db.workouts.get(DEMO_IDS.workouts.futsal)).toMatchObject({ netKcal: 470 });
  });

  it('lists bonuses with "+" amounts and deletes them with undo', async () => {
    const user = userEvent.setup();
    await putBonus(db, { id: 'bonus-hike', logicalDay: '2026-10-10', kcal: 300, reason: 'A hike', createdAt: '2026-10-10T10:00:00.000Z' });
    await putBonus(db, { id: 'bonus-today', logicalDay: '2026-10-16', kcal: 250, reason: '', createdAt: '2026-10-16T10:00:00.000Z' });
    renderActivity();

    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+250/ }, SLOW)).toBeInTheDocument();
    expect(within(row('Today · One-off bonus')).getByText('+250')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Last week · \+770/ })).toBeInTheDocument();

    const hike = row('Sat · A hike');
    expect(within(hike).getByText('+300')).toBeInTheDocument();
    expect(within(hike).getByText('One-off bonus')).toBeInTheDocument();
    // Newest first within the week: Sat before Tue.
    const titles = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles.findIndex((t) => t.startsWith('Sat · A hike'))).toBeLessThan(titles.findIndex((t) => t.startsWith('Tue · Futsal')));

    await user.click(within(hike).getByRole('button', { name: 'Delete bonus, Sat, A hike, +300 kcal' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete from last week?' });
    expect(dialog).toHaveAccessibleDescription(/^A hike, Sat, \+300 kcal\. Last week has closed/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await expect.poll(() => db.bonuses.count()).toBe(1);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Bonus deleted');
    expect(await screen.findByRole('heading', { level: 2, name: /^Last week · \+470/ }, SLOW)).toBeInTheDocument();

    toast?.undo?.();
    expect(await screen.findByRole('heading', { level: 2, name: /^Last week · \+770/ }, SLOW)).toBeInTheDocument();
    expect(await db.bonuses.get('bonus-hike')).toMatchObject({ kcal: 300, reason: 'A hike' });
  });

  it("deletes from this week straight away, with undo", async () => {
    const user = userEvent.setup();
    await putBonus(db, { id: 'bonus-today', logicalDay: '2026-10-16', kcal: 250, reason: '', createdAt: '2026-10-16T10:00:00.000Z' });
    renderActivity();

    await user.click(await screen.findByRole('button', { name: 'Delete bonus, Today, One-off bonus, +250 kcal' }, SLOW));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await expect.poll(() => db.bonuses.count()).toBe(0);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Bonus deleted');
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+0/ }, SLOW)).toBeInTheDocument();

    toast?.undo?.();
    expect(await screen.findByRole('heading', { level: 2, name: /^This week · \+250/ }, SLOW)).toBeInTheDocument();
  });

  it('names an older week by its dates in the confirmation', async () => {
    const user = userEvent.setup();
    await putWorkout(db, { id: 'w-old', logicalDay: '2026-09-29', type: 'badminton', minutes: 45, intensity: 'easy', netKcal: 200, createdAt: '2026-09-29T12:00:00.000Z' });
    renderActivity();

    await user.click(await screen.findByRole('button', { name: 'Delete Badminton, Tue, ~200 kcal' }, SLOW));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete from the week of 28 Sep–4 Oct?' });
    expect(dialog).toHaveAccessibleDescription(/^Badminton, Tue, ~200 kcal\. The week of 28 Sep–4 Oct has closed/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.workouts.get('w-old')).toBeDefined();
  });

  it('labels older weeks by their dates', async () => {
    await putWorkout(db, { id: 'w-old', logicalDay: '2026-09-29', type: 'badminton', minutes: 45, intensity: 'easy', netKcal: 200, createdAt: '2026-09-29T12:00:00.000Z' });
    renderActivity();
    expect(await screen.findByRole('heading', { level: 2, name: /^28 Sep–4 Oct · \+200/ }, SLOW)).toBeInTheDocument();
    expect(within(row('Tue · Badminton 45 min, easy')).getByText('~200')).toBeInTheDocument();
  });

  it('shows the empty state before any workout', async () => {
    const user = userEvent.setup();
    await db.workouts.clear();
    renderActivity();

    expect(await screen.findByText(EMPTY_BODY, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^This week · \+0/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Workouts add to your budget' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log workout' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Log workout' }));
    expect(await screen.findByText('Log workout at /more/activity/new', {}, SLOW)).toBeInTheDocument();
  });

  it('goes back to where it came from, or to More', async () => {
    const user = userEvent.setup();
    renderActivity('/more');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('More at /more', {}, SLOW)).toBeInTheDocument();
  });

  it('falls back to More without history', async () => {
    const user = userEvent.setup();
    const router = renderActivity();
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(await screen.findByText('More at /more', {}, SLOW)).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
