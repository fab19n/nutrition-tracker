import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { fmtTime } from '@/domain/format';
import type { MealLog } from '@/domain/types';
import { resetUiState } from '@/state/ui';
import SearchScreen from './SearchScreen';
import { dayHeading } from './searchModel';

const SLOW = { timeout: 4000 };
const TODAY = '2026-10-16';
const TZ = 'Asia/Kuala_Lumpur';
const { home } = DEMO_IDS.places;

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

function renderSearch(initialEntries: string[] = ['/diary/search'], initialIndex?: number) {
  const router = createMemoryRouter(
    [
      { path: '/diary', element: <Probe name="Diary" /> },
      { path: '/diary/entry/:id', element: <Probe name="Entry" /> },
      { path: '/diary/search', element: <SearchScreen /> },
    ],
    { initialEntries, initialIndex },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const findField = () => screen.findByRole('searchbox', { name: 'Search your diary' }, SLOW) as Promise<HTMLInputElement>;
const rows = () => screen.getAllByRole('listitem');
const slotChip = (name: string) => within(screen.getByRole('group', { name: 'Meal slot' })).getByRole('button', { name });

/** What an independent scan of the meals finds, newest first (the same order the screen uses). */
async function mealsWith(needle: string, keep: (meal: MealLog) => boolean = () => true): Promise<MealLog[]> {
  const meals = await db.meals.toArray();
  return meals
    .filter((m) => keep(m) && [m.name, m.text ?? '', ...m.items.map((i) => i.name)].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => b.logicalDay.localeCompare(a.logicalDay) || b.eatenAt.localeCompare(a.eatenAt));
}

function teaMeal(id: string, day: string, over: Partial<MealLog> = {}): MealLog {
  const at = `${day}T04:00:00.000Z`;
  return {
    id,
    eatenAt: at,
    logicalDay: day,
    slot: 'snack',
    name: 'Teh tarik',
    items: [{ id: `${id}-1`, name: 'Teh tarik', unitMacros: { kcal: 200, proteinG: 4, carbsG: 30, fatG: 6 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
    method: 'text',
    finished: 'all',
    createdAt: at,
    updatedAt: at,
    syncState: 'local',
    ...over,
  };
}

/** 70 more Teh tarik meals, one a day back from 1 Apr 2026. */
function extraTea(): MealLog[] {
  return Array.from({ length: 70 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 3, 1 - i));
    return teaMeal(`extra-tea-${String(i).padStart(2, '0')}`, date.toISOString().slice(0, 10));
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let scrollTo: ReturnType<typeof vi.spyOn>;
const realScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (realScrollY) Object.defineProperty(window, 'scrollY', realScrollY);
  await resetAll();
});

describe('SearchScreen (S49)', () => {
  it('shows a skeleton while loading, then the focused field, the hint and what you log often', async () => {
    renderSearch();
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Loading your meals')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    const field = await findField();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'Dish, drink or Place');
    expect(screen.getByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
    expect(screen.queryByText('Loading your meals')).not.toBeInTheDocument();

    const oftenHeading = screen.getByRole('heading', { level: 2, name: 'Often logged' });
    const items = within(oftenHeading.nextElementSibling as HTMLElement).getAllByRole('button');
    expect(items[0]).toHaveTextContent('Teh tarik');
    expect(items.length).toBeGreaterThan(1);
    expect(items.length).toBeLessThanOrEqual(6);

    const placesHeading = screen.getByRole('heading', { level: 2, name: 'Places' });
    const places = within(placesHeading.nextElementSibling as HTMLElement).getAllByRole('button');
    expect(places.map((p) => p.textContent)).toEqual(['Home', 'Nasi kandar near home', 'Kedai near home']);

    expect(screen.queryByText(/\d+ meals?$/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Meal slot' })).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('commits typed text to the address after a pause, replacing the entry, and lists newest first', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    await user.type(await findField(), 'teh tarik');
    // Nothing yet: the address follows the text after a short pause.
    expect(router.state.location.search).toBe('');

    await waitFor(() => expect(router.state.location.search).toBe('?q=teh+tarik'), SLOW);
    // Typing never adds a history entry.
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('12 meals')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Fri 16 Oct · Today');
    const expected = await mealsWith('teh tarik');
    expect(expected).toHaveLength(12);
    const days = [...new Set(expected.map((m) => m.logicalDay))];
    expect(headings).toEqual(days.map((d) => dayHeading(d, TODAY)));

    // Newest first inside a day: the 5pm snack above the 10am breakfast.
    const sunday = screen.getByRole('link', { name: 'Open Sun 11 Oct in the Diary' }).closest('section') as HTMLElement;
    const sundayRows = within(sunday).getAllByRole('listitem');
    expect(sundayRows).toHaveLength(2);
    expect(sundayRows[0]).toHaveTextContent('Snack · 5:00pm');
    expect(within(sundayRows[0] as HTMLElement).getByText('Teh tarik')).toBeInTheDocument();
    expect(sundayRows[1]).toHaveTextContent('Breakfast · 10:00am');
    expect(within(sundayRows[1] as HTMLElement).getByText('Teh tarik + kuih lapis')).toBeInTheDocument();

    // The whole list is the matching meals, newest day first and the latest meal first inside a day.
    expect(rows()).toHaveLength(12);
    rows().forEach((row, i) => {
      const meal = expected[i] as MealLog;
      expect(row).toHaveTextContent(`${SLOT_LABEL[meal.slot]} · ${fmtTime(meal.eatenAt, TZ)}`);
      expect(within(row).getByText(meal.name)).toBeInTheDocument();
    });
  });

  it('commits at once on Enter and closes the keyboard', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    const field = await findField();
    await user.type(field, 'teh tarik{Enter}');
    expect(router.state.location.search).toBe('?q=teh+tarik');
    expect(field).not.toHaveFocus();
    expect(await screen.findByText('12 meals')).toBeInTheDocument();
  });

  it('cancels a pending pause when the field is cleared', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    const field = await findField();
    await user.type(field, 'teh');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field).toHaveValue('');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(router.state.location.search).toBe('');
    expect(screen.getByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
  });

  it('clears a committed search at once', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search?q=teh+tarik']);
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
    expect(screen.queryByText('12 meals')).not.toBeInTheDocument();
  });

  it('keeps what you type while an earlier pause commits', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    const field = await findField();
    await user.type(field, 'teh');
    await waitFor(() => expect(router.state.location.search).toBe('?q=teh'), SLOW);
    await user.type(field, ' tarik');
    expect(field).toHaveValue('teh tarik');
    await waitFor(() => expect(router.state.location.search).toBe('?q=teh+tarik'), SLOW);
    expect(field).toHaveValue('teh tarik');
    expect(await screen.findByText('12 meals')).toBeInTheDocument();
  });

  it('shows the meta line, kcal and no swipe actions or timing tags on a result', async () => {
    renderSearch(['/diary/search?q=teh+tarik']);
    const meta = await screen.findByText('Breakfast · 10:40am · Nasi kandar near home · RM 4.80', {}, SLOW);
    const row = meta.closest('li') as HTMLElement;
    expect(within(row).getByText('Roti canai + teh tarik')).toBeInTheDocument();
    expect(within(row).getByText('~560')).toBeInTheDocument();
    // Read-only: no timing tags, no Duplicate or Delete, no overflow button.
    expect(screen.queryByText('Late for you')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting to sync')).not.toBeInTheDocument();
  });

  it('says why a row matched when its name does not', async () => {
    const router = renderSearch(['/diary/search?q=kangkung']);
    expect(await screen.findByText('4 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByText('Economy rice')).toHaveLength(4);
    expect(screen.getAllByText('Includes Kangkung belacan')).toHaveLength(4);

    await act(() => router.navigate('/diary/search?q=banjir'));
    expect(await screen.findByText('5 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByText('Includes Kuah campur banjir')).toHaveLength(5);

    await act(() => router.navigate('/diary/search?q=medan'));
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(/^Includes /)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Medan selera nearby/)).toHaveLength(2);

    await act(() => router.navigate('/diary/search?q=tehtarik'));
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();
    await act(() => router.navigate('/diary/search?q=TEH%20TAR%C3%8DK'));
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();
    expect(await findField()).toHaveValue('TEH TARÍK');
  });

  it('filters by meal slot, with or without text', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search?q=teh+tarik']);
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();

    await user.click(slotChip('Supper'));
    expect(await screen.findByText('1 meal', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=teh+tarik&slot=supper');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(slotChip('Supper')).toHaveAttribute('aria-pressed', 'true');
    expect(slotChip('All')).toHaveAttribute('aria-pressed', 'false');

    await user.click(slotChip('All'));
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=teh+tarik');

    // With no text, a slot lists that slot's meals.
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.click(slotChip('Supper'));
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?slot=supper');
  });

  it('flushes text that is still waiting when a slot is tapped', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    await user.type(await findField(), 'teh tarik');
    await user.click(slotChip('Dinner'));
    expect(router.state.location.search).toBe('?q=teh+tarik&slot=dinner');
  });

  it('selects All when the address has a slot that is not one', async () => {
    renderSearch(['/diary/search?slot=brunch']);
    await findField();
    expect(slotChip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
  });

  it('filters by Place with an exact match, and the chip takes it off', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    await findField();
    const placesHeading = screen.getByRole('heading', { level: 2, name: 'Places' });
    await user.click(within(placesHeading.nextElementSibling as HTMLElement).getByRole('button', { name: 'Home' }));

    const atHome = (await db.meals.toArray()).filter((m) => m.placeId === home);
    expect(atHome.length).toBeGreaterThan(0);
    expect(router.state.location.search).toBe(`?place=${home}`);
    const chip = await screen.findByRole('button', { name: 'Home, remove Place filter' }, SLOW);
    expect(chip).toBeInTheDocument();
    expect(await screen.findByText(`${atHome.length} meals`, {}, SLOW)).toBeInTheDocument();
    // "Nasi kandar near home" also has "home" in it; the filter is by Place, not by word.
    expect(screen.queryByText(/near home/)).not.toBeInTheDocument();

    await user.click(chip);
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove Place filter/ })).not.toBeInTheDocument();
  });

  it('combines a Place with text', async () => {
    const user = userEvent.setup();
    const router = renderSearch([`/diary/search?place=${home}`]);
    const field = await findField();
    await user.type(field, 'ayam{Enter}');
    expect(router.state.location.search).toBe(`?place=${home}&q=ayam`);
    // The meals at Home that say "ayam", plus Maggi kari, which the catalogue knows by that word too.
    const said = await mealsWith('ayam', (m) => m.placeId === home);
    expect(said).toHaveLength(7);
    expect(await screen.findByText('8 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Includes Maggi kari')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home, remove Place filter' })).toBeInTheDocument();
  });

  it('invites you to loosen the search when nothing matches', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search?q=zzzz']);
    expect(await screen.findByRole('heading', { name: 'No meals match “zzzz”' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Try fewer words, or a dish, drink or Place name.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ meals?$/)).not.toBeInTheDocument();

    await user.click(slotChip('Supper'));
    expect(await screen.findByText('Try fewer words, or take off the filters.')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=zzzz&slot=supper');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search).toBe('?q=zzzz');
    expect(await screen.findByText('Try fewer words, or a dish, drink or Place name.')).toBeInTheDocument();
    expect(slotChip('All')).toHaveAttribute('aria-pressed', 'true');
    expect(await findField()).toHaveValue('zzzz');
  });

  it('says so when only the filters match nothing, and a Place with no meals is "This Place"', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search?slot=snack&place=nope']);
    expect(await screen.findByRole('heading', { name: 'No meals with these filters' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Take a filter off to see more.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This Place, remove Place filter' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
  });

  it('treats punctuation only as no search at all', async () => {
    const user = userEvent.setup();
    const router = renderSearch();
    const field = await findField();
    await user.type(field, '  !! ');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(field).toHaveValue('  !! ');
    expect(router.state.location.search).toBe('');
    expect(screen.getByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
    expect(screen.queryByText(/No meals match/)).not.toBeInTheDocument();
  });

  describe('with a long history', () => {
    beforeEach(async () => {
      await db.meals.bulkPut(extraTea());
    });

    it('draws 30 at a time, with the total and a button for the rest', async () => {
      const user = userEvent.setup();
      const router = renderSearch(['/diary/search?q=teh+tarik']);
      expect(await screen.findByText('82 meals', {}, SLOW)).toBeInTheDocument();
      expect(rows()).toHaveLength(30);
      expect(screen.getByText('Showing 30 of 82')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
      expect(rows()).toHaveLength(60);
      expect(screen.getByText('Showing 60 of 82')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show 22 more' }));
      expect(rows()).toHaveLength(82);
      expect(screen.queryByRole('button', { name: /Show .* more/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
      expect(screen.getByText('82 meals')).toBeInTheDocument();

      // A new query starts again from the first page.
      await user.clear(await findField());
      await user.type(await findField(), 'tarik{Enter}');
      expect(router.state.location.search).toBe('?q=tarik');
      expect(await screen.findByText('82 meals', {}, SLOW)).toBeInTheDocument();
      expect(rows()).toHaveLength(30);
      expect(screen.getByRole('button', { name: 'Show 30 more' })).toBeInTheDocument();
    });

    it('never splits a day under two headings', async () => {
      const user = userEvent.setup();
      renderSearch(['/diary/search?q=teh+tarik']);
      await screen.findByText('82 meals', {}, SLOW);
      await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(new Set(headings).size).toBe(headings.length);
    });

    it('puts the list back as it was after opening a result and coming back', async () => {
      const user = userEvent.setup();
      const router = renderSearch(['/diary/search?q=teh+tarik']);
      await screen.findByText('82 meals', {}, SLOW);
      await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
      expect(rows()).toHaveLength(60);

      Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
      await user.click(within(rows()[0] as HTMLElement).getByRole('button'));
      expect(router.state.location.pathname).toBe(`/diary/entry/${DEMO_IDS.meals.todayBreakfast}`);
      expect(await screen.findByText(`Entry at /diary/entry/${DEMO_IDS.meals.todayBreakfast}`)).toBeInTheDocument();

      scrollTo.mockClear();
      await act(() => router.navigate(-1));
      expect(await findField()).toHaveValue('teh tarik');
      await waitFor(() => expect(rows()).toHaveLength(60), SLOW);
      await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640), SLOW);
    });

    it('does not restore when the same address is reached by a push', async () => {
      const user = userEvent.setup();
      const router = renderSearch(['/diary/search?q=teh+tarik']);
      await screen.findByText('82 meals', {}, SLOW);
      await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
      Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
      await user.click(within(rows()[0] as HTMLElement).getByRole('button'));
      expect(await screen.findByText(`Entry at /diary/entry/${DEMO_IDS.meals.todayBreakfast}`)).toBeInTheDocument();

      scrollTo.mockClear();
      await act(() => router.navigate('/diary/search?q=teh+tarik'));
      await screen.findByText('82 meals', {}, SLOW);
      expect(rows()).toHaveLength(30);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('restores after the day link too', async () => {
      const user = userEvent.setup();
      const router = renderSearch(['/diary/search?q=teh+tarik']);
      await screen.findByText('82 meals', {}, SLOW);
      await user.click(screen.getByRole('button', { name: 'Show 30 more' }));
      Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
      await user.click(screen.getByRole('link', { name: 'Open Fri 16 Oct · Today in the Diary' }));
      expect(await screen.findByText('Diary at /diary')).toBeInTheDocument();

      scrollTo.mockClear();
      await act(() => router.navigate(-1));
      await waitFor(() => expect(rows()).toHaveLength(60), SLOW);
      await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 300), SLOW);
    });
  });

  it('links each day heading to that day in the Diary', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search?q=ayam']);
    const yesterday = await screen.findByRole('link', { name: 'Open Thu 15 Oct · Yesterday in the Diary' }, SLOW);
    expect(yesterday).toHaveAttribute('href', '/diary?day=2026-10-15');
    expect(screen.getByRole('link', { name: 'Open Fri 16 Oct · Today in the Diary' })).toHaveAttribute('href', '/diary');

    await user.click(yesterday);
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.location.search).toBe('?day=2026-10-15');
  });

  it('goes back to where it was opened from, and to the Diary when opened directly', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary', '/diary/search'], 1);
    await findField();
    await user.type(screen.getByRole('searchbox'), 'teh{Enter}');
    expect(router.state.location.search).toBe('?q=teh');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    // One step, whatever was typed.
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(await screen.findByText('Diary at /diary')).toBeInTheDocument();
  });

  it('replaces itself with the Diary when there is nothing to go back to', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search']);
    await findField();
    await user.click(screen.getByRole('button', { name: 'Back to Diary' }));
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('is still "Back to Diary" after a search is typed on a Search that was opened directly', async () => {
    const user = userEvent.setup();
    const router = renderSearch(['/diary/search']);
    await findField();
    await user.type(screen.getByRole('searchbox'), 'teh{Enter}');
    expect(router.state.location.search).toBe('?q=teh');
    expect(router.state.historyAction).toBe('REPLACE');
    // The commit gave the location a new key, but there is still nothing before Search to go back to.
    expect(router.state.location.key).not.toBe('default');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to Diary' }));
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('Diary at /diary')).toBeInTheDocument();
  });

  it('follows the address when it changes from outside', async () => {
    const router = renderSearch();
    const field = await findField();
    await act(() => router.navigate('/diary/search?q=medan'));
    expect(field).toHaveValue('medan');
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    expect(router.state.historyAction).toBe('PUSH');

    await act(() => router.navigate(-1));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(screen.getByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
  });

  it('follows the meals as they change', async () => {
    renderSearch(['/diary/search?q=teh+tarik']);
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();

    await act(() => db.meals.put(teaMeal('new-tea', '2026-10-16', { eatenAt: '2026-10-16T11:00:00.000Z' })));
    expect(await screen.findByText('13 meals', {}, SLOW)).toBeInTheDocument();

    await act(() => db.meals.delete('new-tea'));
    expect(await screen.findByText('12 meals', {}, SLOW)).toBeInTheDocument();

    const matching = await mealsWith('teh tarik');
    await act(() => db.meals.bulkDelete(matching.map((m) => m.id)));
    expect(await screen.findByRole('heading', { name: 'No meals match “teh tarik”' }, SLOW)).toBeInTheDocument();
  });

  it('finds a Guess entry, shows its pill, and leaves it out of "Often logged"', async () => {
    const guess = (id: string, day: string): MealLog =>
      teaMeal(id, day, {
        name: 'Typical dinner',
        slot: 'dinner',
        method: 'guess',
        isGuess: true,
        items: [{ id: `${id}-1`, name: 'Phantom dish', unitMacros: { kcal: 600, proteinG: 20, carbsG: 70, fatG: 20 }, quantity: 1, uncertainty: 0.3, source: 'aiGuess' }],
      });
    await db.meals.bulkPut([guess('guess-1', '2026-10-01'), guess('guess-2', '2026-10-02')]);

    const router = renderSearch(['/diary/search?q=typical']);
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByText('Guess')).toHaveLength(2);

    await act(() => router.navigate('/diary/search?q=phantom'));
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByText('Includes Phantom dish')).toHaveLength(2);

    await act(() => router.navigate('/diary/search'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Often logged' })).toBeInTheDocument(), SLOW);
    expect(screen.queryByRole('button', { name: 'Phantom dish' })).not.toBeInTheDocument();
  });

  it('has nothing to search before the first meal, and offers to log one', async () => {
    const user = userEvent.setup();
    await db.meals.clear();
    const router = renderSearch();
    expect(await screen.findByRole('heading', { name: 'Nothing to search yet' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Meals you log can be found here by name, item or Place.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Meal slot' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log a meal' }));
    expect(router.state.location.search).toBe('?sheet=log');
  });

  it('opens the keyboard on a fresh search, not over results', async () => {
    renderSearch(['/diary/search']);
    expect(await findField()).toHaveFocus();
  });

  it('does not take the focus when it opens on a search', async () => {
    renderSearch(['/diary/search?q=teh']);
    const field = await findField();
    expect(field).toHaveValue('teh');
    expect(field).not.toHaveFocus();
  });

  it('clips a very long query in the address to 80 characters', async () => {
    renderSearch([`/diary/search?q=${'a'.repeat(200)}`]);
    const field = await findField();
    expect(field.value).toHaveLength(80);
    expect(await screen.findByRole('heading', { name: /^No meals match/ }, SLOW)).toBeInTheDocument();
  });

  it('only reads: nothing is written, saved or sent', async () => {
    const user = userEvent.setup();
    const [mealsBefore, placesBefore, outboxBefore] = await Promise.all([db.meals.toArray(), db.places.toArray(), db.syncOutbox.count()]);
    const stored = localStorage.length;

    const router = renderSearch();
    await user.type(await findField(), 'teh tarik{Enter}');
    await screen.findByText('12 meals', {}, SLOW);
    await user.click(slotChip('Snack'));
    await user.click(slotChip('All'));
    await user.click(within(rows()[0] as HTMLElement).getByRole('button'));
    await screen.findByText(/^Entry at /);
    await act(() => router.navigate(-1));
    await screen.findByText('12 meals', {}, SLOW);

    expect(await db.meals.toArray()).toEqual(mealsBefore);
    expect(await db.places.toArray()).toEqual(placesBefore);
    expect(await db.syncOutbox.count()).toBe(outboxBefore);
    expect(localStorage.length).toBe(stored);
    expect(sessionStorage.length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
