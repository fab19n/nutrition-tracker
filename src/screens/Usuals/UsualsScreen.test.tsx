import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { PATHS } from '@/app/paths';
import { Toast } from '@/components/Toast/Toast';
import { byId } from '@/data/catalogue';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { clearDismissedSuggestions, readDismissedSuggestions } from '@/db/usuals';
import { itemFromCatalogue } from '@/domain/meal';
import type { CatalogueItem, MealLog } from '@/domain/types';
import ReviewScreen from '@/screens/Log/ReviewScreen';
import { resetUiState, useUiStore } from '@/state/ui';
import UsualsScreen from './UsualsScreen';

const SLOW = { timeout: 4000 };
const DEMO_ORDER = ['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang'];

function Shell() {
  const toast = useUiStore((s) => s.toast);
  const hideToast = useUiStore((s) => s.hideToast);
  return (
    <>
      <Outlet />
      {toast ? <Toast key={toast.id} message={toast.message} onUndo={toast.undo} onDismiss={() => hideToast(toast.id)} durationMs={null} /> : null}
    </>
  );
}

function Stub({ name }: { name: string }) {
  const location = useLocation();
  return (
    <h1>
      {name} screen {location.pathname}
    </h1>
  );
}

function renderUsuals(initialEntries: string[] = [PATHS.more, PATHS.usuals]) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: PATHS.today, element: <Stub name="Today" /> },
          { path: PATHS.more, element: <Stub name="More" /> },
          { path: PATHS.usuals, element: <UsualsScreen /> },
          { path: PATHS.review, element: <ReviewScreen /> },
        ],
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

/** Names of the Usual cards, top to bottom. */
function cardNames(): string[] {
  const section = screen.getByRole('region', { name: 'Your Usuals' });
  return within(section)
    .queryAllByRole('article')
    .map((a) => within(a).getByRole('heading', { level: 3 }).textContent ?? '');
}

async function waitForCards(names: string[]) {
  await waitFor(() => expect(cardNames()).toEqual(names), SLOW);
}

function card(name: string): HTMLElement {
  return screen.getByRole('article', { name });
}

async function menuAction(name: string, action: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `More for ${name}` }));
  await user.click(within(screen.getByRole('menu', { name: `More for ${name}` })).getByRole('menuitem', { name: action }));
}

let mealSeq = 0;
function meal(name: string, day: string, food: CatalogueItem): MealLog {
  mealSeq += 1;
  const at = `${day}T05:00:00.000Z`;
  return {
    id: `usuals-test-meal-${mealSeq}`,
    eatenAt: at,
    logicalDay: day,
    slot: 'lunch',
    name,
    items: [itemFromCatalogue(food, { id: `usuals-test-item-${mealSeq}` })],
    method: 'text',
    finished: 'all',
    createdAt: at,
    updatedAt: at,
    syncState: 'local',
  };
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  clearDismissedSuggestions();
  await loadDemoData();
});

afterEach(async () => {
  clearDismissedSuggestions();
  await resetAll();
});

describe('UsualsScreen (S23)', () => {
  it('lists the 4 demo Usuals most used first, with items, kcal, Place and use count', async () => {
    renderUsuals();
    expect(screen.getByRole('heading', { level: 1, name: 'Usuals' })).toBeInTheDocument();
    await waitForCards(DEMO_ORDER);

    const roti = card('Roti canai + teh tarik');
    expect(within(roti).getByText('Roti canai + dhal · Teh tarik')).toBeInTheDocument();
    expect(within(roti).getByText('~560 kcal')).toBeInTheDocument();
    expect(within(roti).getByText(/Nasi kandar near home · Used 6 times/)).toBeInTheDocument();
    expect(within(card('Bread, kaya, kopi')).getByText(/Home · Used 5 times/)).toBeInTheDocument();
    // A one-item Usual named after its item doesn't repeat its name as an items line.
    for (const name of ['Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang']) {
      expect(within(card(name)).getAllByText(name)).toHaveLength(1);
    }

    // The demo has logged its nasi kandar dinner often without making it a Usual.
    const suggested = await screen.findByRole('region', { name: 'Suggested' }, SLOW);
    expect(within(suggested).getByRole('article', { name: /^You've logged Nasi kandar ayam goreng \d+ times\. Save as a Usual\?$/ })).toBeInTheDocument();
    const newUsual = screen.getByRole('button', { name: 'New Usual' });
    // §7.3 order: your Usuals, + New Usual, then the suggestions.
    const yours = screen.getByRole('region', { name: 'Your Usuals' });
    expect(yours.compareDocumentPosition(suggested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newUsual.compareDocumentPosition(suggested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Your Usuals')).toBeLessThan(headings.indexOf('Suggested'));
  });

  it('moves a Usual down then up from its menu, keeps the order, and keeps focus on it', async () => {
    renderUsuals();
    await waitForCards(DEMO_ORDER);

    // The first card has no Move up; the last has no Move down.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Roti canai + teh tarik' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move down' }));

    await waitForCards(['Bread, kaya, kopi', 'Roti canai + teh tarik', 'Nasi lemak bungkus', 'Teh o ais kurang']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'More for Roti canai + teh tarik' })).toHaveFocus());
    expect(screen.getByText('Moved down. Roti canai + teh tarik is 2 of 4.')).toBeInTheDocument();
    const stored = (await db.usuals.toArray()).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    expect(stored.map((u) => u.name)).toEqual(['Bread, kaya, kopi', 'Roti canai + teh tarik', 'Nasi lemak bungkus', 'Teh o ais kurang']);

    await menuAction('Roti canai + teh tarik', 'Move up');
    await waitForCards(DEMO_ORDER);
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.sortIndex).toBe(0);

    await user.click(screen.getByRole('button', { name: 'More for Teh o ais kurang' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Move down' })).not.toBeInTheDocument();
  });

  it('keeps a manual order after a reload', async () => {
    const first = renderUsuals();
    await waitForCards(DEMO_ORDER);
    await menuAction('Teh o ais kurang', 'Move up');
    await waitForCards(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Teh o ais kurang', 'Nasi lemak bungkus']);
    first.unmount();

    renderUsuals();
    await waitForCards(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Teh o ais kurang', 'Nasi lemak bungkus']);
  });

  it('logs a Usual through the review screen, pre-filled, and comes back on Back', async () => {
    const user = userEvent.setup();
    const { router } = renderUsuals();
    await waitForCards(DEMO_ORDER);

    await user.click(screen.getByRole('button', { name: 'Log Roti canai + teh tarik' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your usual order' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.review);
    const draft = useUiStore.getState().reviewDraft;
    expect(draft).toMatchObject({ flow: 'usual', backTo: PATHS.usuals, meta: { method: 'usual', name: 'Roti canai + teh tarik', placeId: DEMO_IDS.places.nasiKandar } });
    expect(draft?.items.map((i) => i.name)).toEqual(['Roti canai + dhal', 'Teh tarik']);
    // Fresh copies: logging never edits the Usual's own items.
    expect(draft?.items.map((i) => i.id)).not.toContain('usual-roti-canai-1');
    expect(await screen.findByText('Roti canai + dhal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Usuals' })).toBeInTheDocument();
    await waitForCards(DEMO_ORDER);
  });

  it('counts a use once the logged Usual is saved', async () => {
    const user = userEvent.setup();
    renderUsuals();
    await waitForCards(DEMO_ORDER);
    await user.click(screen.getByRole('button', { name: 'Log Nasi lemak bungkus' }));
    await screen.findByRole('heading', { level: 1, name: 'Your usual order' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: /Today screen/ }, SLOW)).toBeInTheDocument();
    await waitFor(async () => expect((await db.usuals.get(DEMO_IDS.usuals.nasiLemak))?.useCount).toBe(5));
  });

  it('edits a Usual: renames it and removes an item', async () => {
    const user = userEvent.setup();
    renderUsuals();
    await waitForCards(DEMO_ORDER);

    await menuAction('Roti canai + teh tarik', 'Edit');
    const sheet = await screen.findByRole('dialog', { name: 'Edit Usual' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Roti canai + teh tarik');
    expect(within(sheet).getByText('~560 kcal · likely 480–640')).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, 'Roti canai pagi');

    await user.click(within(sheet).getByRole('button', { name: 'More for Teh tarik' }));
    await user.click(within(sheet).getByRole('menuitem', { name: 'Remove' }));
    expect(within(sheet).queryByText('Teh tarik')).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Usual' })).not.toBeInTheDocument());
    expect(await screen.findByText('Usual saved')).toBeInTheDocument();
    await waitForCards(['Roti canai pagi', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang']);
    expect(within(card('Roti canai pagi')).getByText('Roti canai + dhal')).toBeInTheDocument();
    const stored = await db.usuals.get(DEMO_IDS.usuals.rotiCanai);
    expect(stored?.name).toBe('Roti canai pagi');
    expect(stored?.items.map((i) => i.name)).toEqual(['Roti canai + dhal']);

    // The toast's Undo puts the previous version back.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitForCards(DEMO_ORDER);
  });

  it('creates a new Usual from an empty editor, with items from the library', async () => {
    const user = userEvent.setup();
    renderUsuals();
    await waitForCards(DEMO_ORDER);

    await user.click(screen.getByRole('button', { name: 'New Usual' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Usual' });
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(sheet).getByText('Add at least one item to save.')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Add item' }));
    const search = await screen.findByRole('dialog', { name: 'Add an item' });
    await user.type(within(search).getByRole('searchbox', { name: 'Search food' }), 'mee goreng mamak');
    await user.click(await within(search).findByRole('button', { name: /^Mee goreng mamak\s*· Catalogue/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add an item' })).not.toBeInTheDocument());

    // Change the portion chip, then save with the name left empty (it takes the items' name).
    await user.click(within(sheet).getByRole('button', { name: 'Small' }));
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Mee goreng mamak');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitForCards([...DEMO_ORDER, 'Mee goreng mamak']);
    expect(within(card('Mee goreng mamak')).getByText(/Not used yet/)).toBeInTheDocument();
    const created = (await db.usuals.toArray()).find((u) => u.name === 'Mee goreng mamak');
    expect(created?.items[0]?.variants?.[created.items[0].selectedVariant ?? -1]?.label).toBe('Small');
    expect(created?.items[0]).not.toHaveProperty('edited');
  });

  it('deletes a Usual with an Undo toast', async () => {
    const user = userEvent.setup();
    renderUsuals();
    await waitForCards(DEMO_ORDER);

    await menuAction('Bread, kaya, kopi', 'Delete');
    await waitForCards(['Roti canai + teh tarik', 'Nasi lemak bungkus', 'Teh o ais kurang']);
    expect(await db.usuals.get(DEMO_IDS.usuals.breadKayaKopi)).toBeUndefined();
    expect(screen.getByText('Usual deleted')).toBeInTheDocument();
    // Focus moves to the card that took its place.
    await waitFor(() => expect(screen.getByRole('button', { name: 'More for Nasi lemak bungkus' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitForCards(DEMO_ORDER);
    expect((await db.usuals.get(DEMO_IDS.usuals.breadKayaKopi))?.useCount).toBe(5);
  });

  it('suggests a meal logged 3 times, and Save makes it a Usual', async () => {
    const food = byId('mee-goreng-mamak');
    if (!food) throw new Error('missing catalogue item');
    await db.meals.bulkPut([meal('Mee goreng mamak', '2026-10-13', food), meal('Mee goreng mamak', '2026-10-14', food)]);
    const first = renderUsuals();
    await waitForCards(DEMO_ORDER);
    // Twice isn't a habit yet.
    await screen.findByRole('region', { name: 'Suggested' }, SLOW);
    expect(screen.queryByRole('article', { name: /Mee goreng mamak/ })).not.toBeInTheDocument();
    first.unmount();

    await db.meals.put(meal('Mee goreng mamak', '2026-10-15', food));
    const user = userEvent.setup();
    renderUsuals();
    const suggestion = await screen.findByRole('article', { name: "You've logged Mee goreng mamak 3 times. Save as a Usual?" }, SLOW);
    expect(within(suggestion).getByText('~830 kcal')).toBeInTheDocument();

    await user.click(within(suggestion).getByRole('button', { name: 'Save Mee goreng mamak as a Usual' }));
    // Used 3 times, like Teh o ais kurang; the name breaks the tie.
    await waitForCards(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Mee goreng mamak', 'Teh o ais kurang']);
    expect(within(card('Mee goreng mamak')).getByText(/Used 3 times/)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /^You've logged Mee goreng mamak/ })).not.toBeInTheDocument();
    expect(screen.getByText('Saved as a Usual')).toBeInTheDocument();
    expect((await db.usuals.toArray()).find((u) => u.name === 'Mee goreng mamak')?.useCount).toBe(3);
  });

  it('hides a suggestion on Not now, can undo, and remembers it', async () => {
    const user = userEvent.setup();
    const notNow = async () => {
      const suggestion = await screen.findByRole('article', { name: /^You've logged Nasi kandar ayam goreng/ }, SLOW);
      await user.click(within(suggestion).getByRole('button', { name: 'Not now: Nasi kandar ayam goreng' }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggested' })).not.toBeInTheDocument());
    };
    const first = renderUsuals();
    await notNow();
    expect(screen.getByText('Suggestion hidden')).toBeInTheDocument();
    expect(readDismissedSuggestions().has('nasi kandar ayam goreng')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('region', { name: 'Suggested' })).toBeInTheDocument();
    expect(readDismissedSuggestions().size).toBe(0);

    await notNow();
    first.unmount();

    // Still hidden next time.
    renderUsuals();
    await waitForCards(DEMO_ORDER);
    expect(screen.queryByRole('region', { name: 'Suggested' })).not.toBeInTheDocument();
  });

  it('shows the empty state and opens the editor from it', async () => {
    await db.usuals.clear();
    const user = userEvent.setup();
    renderUsuals();
    expect(await screen.findByRole('heading', { name: 'No Usuals yet' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Save a meal you have often and log it in one tap.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New Usual' }));
    expect(await screen.findByRole('dialog', { name: 'New Usual' })).toBeInTheDocument();
  });

  it('goes back to where it came from, or to More on a fresh load', async () => {
    const user = userEvent.setup();
    const first = renderUsuals();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'More screen /more' })).toBeInTheDocument();
    expect(first.router.state.location.pathname).toBe(PATHS.more);
    first.unmount();

    const fresh = renderUsuals([PATHS.usuals]);
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(await screen.findByRole('heading', { name: 'More screen /more' })).toBeInTheDocument();
    expect(fresh.router.state.location.pathname).toBe(PATHS.more);
  });
});
