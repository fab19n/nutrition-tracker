import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import EntryScreen from './EntryScreen';

const SLOW = { timeout: 4000 };
const BREAKFAST = DEMO_IDS.meals.todayBreakfast;
const LUNCH = DEMO_IDS.meals.todayLunch;
/** Tue 13 Oct: the nasi kandar order switched back from Mamak big and banjir. */
const EDITED_DINNER = 'meal-2026-10-13-dinner';

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

function renderEntry(id: string, from?: string) {
  const router = createMemoryRouter(
    [
      { path: '/diary', element: <Probe name="Diary" /> },
      { path: '/diary/entry/:id', element: <EntryScreen /> },
      { path: '/log/review', element: <Probe name="Review" /> },
    ],
    { initialEntries: from ? [from, `/diary/entry/${id}`] : [`/diary/entry/${id}`], initialIndex: from ? 1 : 0 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('EntryScreen (S14)', () => {
  it('shows the meal: meta, Place, price, read-only items, total and range', async () => {
    renderEntry(BREAKFAST);

    expect(screen.getByRole('heading', { level: 1, name: 'Entry' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Roti canai + teh tarik' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Breakfast · Fri 16 Oct · 10:40am')).toBeInTheDocument();
    expect(screen.getByText('“roti canai, teh tarik”')).toBeInTheDocument();
    expect(await screen.findByText('Nasi kandar near home', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('RM 4.80')).toBeInTheDocument();
    expect(screen.getByText('Typed')).toBeInTheDocument();
    expect(await screen.findByText('Late for you', {}, SLOW)).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Roti canai + dhal')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Teh tarik')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Normal')).toBeInTheDocument();

    expect(screen.getByText('~560 kcal')).toBeInTheDocument();
    expect(screen.getByText(/^likely \d[\d,]*–[\d,]+ kcal$/)).toBeInTheDocument();
    expect(screen.queryByText(/edited by you/)).not.toBeInTheDocument();
    // Already one of the demo's Usuals at this Place.
    expect(await screen.findByRole('button', { name: 'In your Usuals' }, SLOW)).toBeDisabled();
  });

  it('shows the history line when items were changed from their estimate', async () => {
    renderEntry(EDITED_DINNER);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nasi kandar ayam goreng' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Dinner · Tue 13 Oct · 8:50pm')).toBeInTheDocument();
    expect(screen.getByText('~750 kcal')).toBeInTheDocument();
    expect(screen.getByText('Original estimate ~950 · edited by you')).toBeInTheDocument();
    // Rice and kuah show what you changed them to.
    expect(screen.getAllByText('Normal')).toHaveLength(2);
  });

  it('opens Review in edit mode with the meal as the draft', async () => {
    const user = userEvent.setup();
    const router = renderEntry(LUNCH);
    await user.click(await screen.findByRole('button', { name: 'Edit entry' }, SLOW));

    expect(router.state.location.pathname).toBe('/log/review');
    const draft = useUiStore.getState().reviewDraft;
    expect(draft?.flow).toBe('edit');
    expect(draft?.title).toBe('Edit entry');
    expect(draft?.backTo).toBe(`/diary/entry/${LUNCH}`);
    expect(draft?.meta).toMatchObject({ editingMealId: LUNCH, method: 'plate', placeId: DEMO_IDS.places.kedai, priceRm: 9.5, slot: 'lunch' });
    expect(draft?.items).toHaveLength(5);
  });

  it('duplicates the meal to today, with undo', async () => {
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }, SLOW));

    await expect.poll(() => db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(3);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Logged again today · ~560 kcal');
    toast?.undo?.();
    await expect.poll(() => db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(2);
  });

  it('logs one copy on a double tap of Duplicate', async () => {
    renderEntry(BREAKFAST);
    const duplicate = await screen.findByRole('button', { name: 'Duplicate' }, SLOW);
    fireEvent.click(duplicate);
    fireEvent.click(duplicate);
    await expect.poll(() => useUiStore.getState().toast?.message).toBe('Logged again today · ~560 kcal');
    expect(await db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(3);
  });

  it('saves the meal as a Usual, with undo', async () => {
    const user = userEvent.setup();
    renderEntry(LUNCH);
    const before = await db.usuals.count();
    await user.click(await screen.findByRole('button', { name: 'Save as Usual' }, SLOW));

    expect(await screen.findByRole('button', { name: 'In your Usuals' }, SLOW)).toBeDisabled();
    expect(await db.usuals.count()).toBe(before + 1);
    const usual = (await db.usuals.toArray()).find((u) => u.name === 'Economy rice');
    expect(usual).toMatchObject({ placeId: DEMO_IDS.places.kedai, slot: 'lunch', useCount: 1 });
    expect(usual?.items.every((i) => i.original === undefined)).toBe(true);

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Saved as a Usual');
    toast?.undo?.();
    expect(await screen.findByRole('button', { name: 'Save as Usual' }, SLOW)).toBeEnabled();
    expect(await db.usuals.count()).toBe(before);
  });

  it('deletes after confirming, goes back to the diary day and can undo', async () => {
    const user = userEvent.setup();
    const router = renderEntry(EDITED_DINNER);
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this entry?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    // The delete is async; the screen leaves once it has gone through.
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(router.state.location.search).toBe('?day=2026-10-13');
    expect(await db.meals.get(EDITED_DINNER)).toBeUndefined();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Entry deleted');
    toast?.undo?.();
    await expect.poll(async () => (await db.meals.get(EDITED_DINNER))?.id).toBe(EDITED_DINNER);
  });

  it('keeps the entry when the delete is cancelled', async () => {
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.meals.get(BREAKFAST)).toBeDefined();
  });

  it('goes back to where it came from', async () => {
    const user = userEvent.setup();
    const router = renderEntry(BREAKFAST, '/diary?day=2026-10-16');
    await screen.findByRole('heading', { level: 2, name: 'Roti canai + teh tarik' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('shows a friendly empty state for a missing entry', async () => {
    const user = userEvent.setup();
    const router = renderEntry('no-such-meal');
    expect(await screen.findByRole('heading', { name: "This entry isn't here" }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open diary' }));
    expect(router.state.location.pathname).toBe('/diary');
  });
});
