import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import PlaceDetailScreen from './PlaceDetailScreen';

const SLOW = { timeout: 4000 };
const { nasiKandar, kedai, medanSelera, home } = DEMO_IDS.places;

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
    </div>
  );
}

function renderPlace(id: string, withHistory = true) {
  const router = createMemoryRouter(
    [
      { path: '/more/places', element: <Probe name="Places" /> },
      { path: '/more/places/:id', element: <PlaceDetailScreen /> },
      { path: '/more/pots', element: <Probe name="Pots" /> },
      { path: '/log/review', element: <Probe name="Review" /> },
    ],
    withHistory ? { initialEntries: ['/more/places', `/more/places/${id}`], initialIndex: 1 } : { initialEntries: [`/more/places/${id}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** A MetricTile by its label. */
function tile(label: string): HTMLElement {
  const found = screen
    .getAllByText(label)
    .map((el) => el.parentElement)
    .find((el): el is HTMLElement => el instanceof HTMLElement && el.className.includes('_tile_'));
  if (!found) throw new Error(`No tile ${label}`);
  return found;
}

function rowsOf(listName: string): HTMLElement[] {
  return within(screen.getByRole('list', { name: listName })).getAllByRole('listitem');
}

function toastMessage(): string | undefined {
  return useUiStore.getState().toast?.message;
}

beforeEach(async () => {
  // A phone with location; tests that read a position replace this.
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true });
  await resetAll();
  resetUiState();
  await loadDemoData();
});

afterEach(async () => {
  Reflect.deleteProperty(navigator, 'geolocation');
  await resetAll();
});

describe('PlaceDetailScreen (S22)', () => {
  it('shows the nasi kandar stall: visits, here vs elsewhere, usual orders and what it learned', async () => {
    renderPlace(nasiKandar);

    expect(await screen.findByRole('heading', { level: 1, name: 'Nasi kandar near home' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Mamak')).toBeInTheDocument();
    expect(screen.getByText('11 visits in 30 days · last today')).toBeInTheDocument();
    expect(screen.queryByText('Learning your orders')).not.toBeInTheDocument();

    expect(tile('Avg here')).toHaveTextContent('Avg here~790kcal a meal');
    expect(tile('Elsewhere')).toHaveTextContent('Elsewhere~480kcal a meal');
    expect(tile('Spend this week')).toHaveTextContent('Spend this weekRM 16.80RM 122.00 in 30 days');

    const orders = rowsOf('Your usual orders');
    expect(orders).toHaveLength(2);
    expect(orders[0]).toHaveTextContent('Roti canai + teh tarik');
    // The name already says what's in it, so the detail is how often and how much.
    expect(within(orders[0] as HTMLElement).getByText('6 times · ~560 kcal')).toBeInTheDocument();
    // Had this morning, and a second one today is still one tap away.
    expect(within(orders[0] as HTMLElement).getByText('Logged today')).toBeInTheDocument();
    expect(within(orders[0] as HTMLElement).getByRole('button', { name: 'Log Roti canai + teh tarik again' })).toHaveTextContent('Log again');
    expect(orders[1]).toHaveTextContent('Nasi kandar ayam goreng');
    expect(orders[1]).toHaveTextContent('Kuah campur · 8 times · ~750 kcal');
    expect(within(orders[1] as HTMLElement).getByRole('button', { name: 'Log Nasi kandar ayam goreng' })).toBeInTheDocument();

    const learned = rowsOf("What you've taught it");
    expect(learned[0]).toHaveTextContent('Rice (nasi kandar)Mamak big, +30%');
    expect(learned[1]).toHaveTextContent('Kuah campurBanjir, +80%');
    expect(screen.getByRole('group', { name: 'Oil level here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');

    expect(screen.getByText('Saved here. Log picks this Place within about 150 m.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Typical price/ })).toHaveTextContent('RM 12.00');
    expect(screen.queryByRole('heading', { name: 'Trays here' })).not.toBeInTheDocument();
  });

  it('removes a learned default with undo', async () => {
    const user = userEvent.setup();
    renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Remove Kuah campur' }, SLOW));

    await expect.poll(async () => (await db.places.get(nasiKandar))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2 });
    expect(await screen.findByRole('button', { name: 'Remove Rice (nasi kandar)' })).toBeInTheDocument();
    await expect.poll(() => screen.queryByRole('button', { name: 'Remove Kuah campur' })).toBeNull();
    expect(await db.personalItems.get('personal-nasi-kandar-kuah')).toBeUndefined();
    expect(toastMessage()).toBe('Kuah campur default removed');

    useUiStore.getState().toast?.undo?.();
    expect(await screen.findByRole('button', { name: 'Remove Kuah campur' }, SLOW)).toBeInTheDocument();
    expect((await db.places.get(nasiKandar))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2, 'kuah-campur': 2 });
    expect(await db.personalItems.get('personal-nasi-kandar-kuah')).toBeDefined();
  });

  it('puts an undone default back where it was in the list', async () => {
    const user = userEvent.setup();
    renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Remove Rice (nasi kandar)' }, SLOW));
    await expect.poll(() => screen.queryByRole('button', { name: 'Remove Rice (nasi kandar)' })).toBeNull();

    useUiStore.getState().toast?.undo?.();
    expect(await screen.findByRole('button', { name: 'Remove Rice (nasi kandar)' }, SLOW)).toBeInTheDocument();
    const learned = rowsOf("What you've taught it");
    expect(learned[0]).toHaveTextContent('Rice (nasi kandar)Mamak big, +30%');
    expect(learned[1]).toHaveTextContent('Kuah campurBanjir, +80%');
    expect(Object.keys((await db.places.get(nasiKandar))?.defaultVariants ?? {})).toEqual(['rice-nasi-kandar', 'kuah-campur']);
  });

  it('keeps keyboard focus in the list when a learned default goes', async () => {
    const user = userEvent.setup();
    renderPlace(nasiKandar);
    const kuah = await screen.findByRole('button', { name: 'Remove Kuah campur' }, SLOW);
    kuah.focus();
    await user.keyboard('{Enter}');
    // The last row went: focus moves to the row above.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Rice (nasi kandar)' })).toHaveFocus(), SLOW);
    expect(screen.queryByRole('button', { name: 'Remove Kuah campur' })).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    // Nothing left: focus lands on the "Nothing yet" line, not on the page.
    const empty = await screen.findByText(/^Nothing yet\. Fix a portion here twice/, {}, SLOW);
    await waitFor(() => expect(empty).toHaveFocus(), SLOW);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('changes a learned default from its chips, with undo', async () => {
    const user = userEvent.setup();
    renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Change Rice (nasi kandar)' }, SLOW));
    const sheet = await screen.findByRole('dialog', { name: 'Rice (nasi kandar) here' });
    expect(within(sheet).getByRole('button', { name: 'Mamak big' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Normal' }));

    expect(await screen.findByText('Normal', { selector: 'div' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Rice (nasi kandar) here' })).not.toBeInTheDocument();
    expect((await db.places.get(nasiKandar))?.defaultVariants['rice-nasi-kandar']).toBe(1);
    expect(toastMessage()).toBe('Rice (nasi kandar) here: Normal');

    useUiStore.getState().toast?.undo?.();
    expect(await screen.findByText('Mamak big, +30%', {}, SLOW)).toBeInTheDocument();
  });

  it('logs a usual order through Review with its items and this Place', async () => {
    const user = userEvent.setup();
    const router = renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Log Nasi kandar ayam goreng' }, SLOW));

    expect(router.state.location.pathname).toBe('/log/review');
    const draft = useUiStore.getState().reviewDraft;
    expect(draft).toMatchObject({ flow: 'placeOrder', title: 'Your usual order', backTo: `/more/places/${nasiKandar}` });
    expect(draft?.meta).toMatchObject({ method: 'placeOrder', name: 'Nasi kandar ayam goreng', placeId: nasiKandar, slot: 'dinner' });
    expect(draft?.items.map((i) => i.catalogueId)).toEqual(['rice-nasi-kandar', 'ayam-goreng-mamak', 'kuah-campur']);
    // Fresh copies, not the stored meal's rows.
    expect(draft?.items.every((i) => i.original === undefined && i.edited === undefined)).toBe(true);
  });

  it('sets the oil level, the typical price and the name and type', async () => {
    const user = userEvent.setup();
    renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Medium' }, SLOW));
    await expect.poll(async () => (await db.places.get(nasiKandar))?.oilLevel).toBe('medium');

    await user.click(screen.getByRole('button', { name: /^Typical price/ }));
    let sheet = await screen.findByRole('dialog', { name: 'Typical price' });
    const price = within(sheet).getByLabelText('What a meal here usually costs');
    await user.clear(price);
    await user.type(price, 'abc');
    expect(price).toHaveValue('');
    await user.type(price, '13.5');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await expect.poll(async () => (await db.places.get(nasiKandar))?.typicalPriceRm).toBe(13.5);
    await expect.poll(() => screen.getByRole('button', { name: /^Typical price/ }).textContent).toContain('RM 13.50');

    await user.click(screen.getByRole('button', { name: 'Edit name and type' }));
    sheet = await screen.findByRole('dialog', { name: 'Edit place' });
    const name = within(sheet).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Kedai near home');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('You already have Kedai near home')).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, 'Nasi kandar Bistari');
    await user.click(within(sheet).getByRole('button', { name: 'Hawker' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nasi kandar Bistari' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Hawker')).toBeInTheDocument();
    expect(await db.places.get(nasiKandar)).toMatchObject({ name: 'Nasi kandar Bistari', type: 'hawker' });
    expect(toastMessage()).toBe('Place updated');
  });

  it("replaces the saved spot with I'm here now, and undo puts the old one back", async () => {
    const user = userEvent.setup();
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 3.142, longitude: 101.687 }, timestamp: Date.now() } as GeolocationPosition));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: "I'm here now" }, SLOW));

    await expect.poll(async () => (await db.places.get(nasiKandar))?.coords).toEqual({ lat: 3.142, lng: 101.687 });
    expect(toastMessage()).toBe('Spot updated');
    useUiStore.getState().toast?.undo?.();
    await expect.poll(async () => (await db.places.get(nasiKandar))?.coords).toEqual({ lat: 3.1412, lng: 101.6865 });
  });

  it('shows the trays at an economy-rice Place, switches one off and adds another', async () => {
    const user = userEvent.setup();
    renderPlace(kedai);
    expect(await screen.findByRole('heading', { level: 1, name: 'Kedai near home' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Economy rice', { selector: 'span' })).toBeInTheDocument();
    const traysHeading = screen.getByRole('heading', { level: 2, name: 'Trays here' });
    // Section 7.3 order: what you've taught it, location, Trays here, then edit / delete.
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const taught = screen.getByRole('heading', { level: 2, name: /^What you.ve taught it$/ });
    const details = screen.getByRole('heading', { level: 2, name: 'Details' });
    const edit = screen.getByRole('button', { name: 'Edit name and type' });
    expect(follows(taught, details)).toBe(true);
    expect(follows(details, traysHeading)).toBe(true);
    expect(follows(traysHeading, edit)).toBe(true);
    expect(follows(edit, screen.getByRole('button', { name: 'Delete place' }))).toBe(true);

    const trays = rowsOf('Trays here');
    expect(trays).toHaveLength(10);
    expect(trays[1]).toHaveTextContent('Ayam masak merah');
    const taugeh = screen.getByRole('switch', { name: 'Taugeh on the trays here' });
    expect(taugeh).toHaveAttribute('aria-checked', 'true');

    await user.click(taugeh);
    await expect.poll(async () => (await db.places.get(kedai))?.trays).not.toContain('taugeh');
    // Still listed, so it can go back on.
    await expect.poll(() => screen.getByRole('switch', { name: 'Taugeh on the trays here' }).getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Add a tray dish' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a tray dish' });
    const search = within(sheet).getByRole('searchbox', { name: 'Search tray dishes' });
    await user.type(search, 'sambal');
    // Dishes already on the trays aren't offered again.
    expect(within(sheet).queryByText('Terung sambal')).not.toBeInTheDocument();
    expect(within(sheet).getByText('Sotong sambal')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'sotong');
    await user.click(within(sheet).getByText('Sotong sambal'));

    await expect.poll(async () => (await db.places.get(kedai))?.trays).toContain('sotong-sambal');
    expect(toastMessage()).toBe('Sotong sambal added to the trays here');
    expect(screen.queryByRole('dialog', { name: 'Add a tray dish' })).not.toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Sotong sambal on the trays here' }, SLOW)).toHaveAttribute('aria-checked', 'true');
    expect(rowsOf('Trays here')).toHaveLength(11);
  });

  it('says a new Place is still learning', async () => {
    renderPlace(medanSelera);
    expect(await screen.findByRole('heading', { level: 1, name: 'Medan selera nearby' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Learning your orders')).toBeInTheDocument();
    expect(screen.getByText('2 visits in 30 days · last yesterday')).toBeInTheDocument();
    // Said once, by the pill; the note says how.
    expect(screen.getAllByText(/Learning your orders/)).toHaveLength(1);
    expect(screen.getByText(/^Have something here twice and it shows up for one-tap logging\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your usual orders' })).not.toBeInTheDocument();
    expect(screen.getByText(/^Nothing yet\. Fix a portion here twice/)).toBeInTheDocument();
    expect(screen.getByText("Not saved yet. Tap when you're there.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Typical price/ })).toHaveTextContent('Not set');
  });

  it('shows pots and home-style dishes at Home, and logs a serving', async () => {
    const user = userEvent.setup();
    renderPlace(home);
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, SLOW)).toBeInTheDocument();
    // While pots load, it never says there are none.
    expect(screen.queryByText(/^No pots in the fridge/)).not.toBeInTheDocument();
    const pots = await screen.findByRole('list', { name: 'Pots at home' }, SLOW);
    expect(screen.queryByText(/^No pots in the fridge/)).not.toBeInTheDocument();
    expect(within(pots).getByText('Kari ayam pot')).toBeInTheDocument();
    // The same clear day as the Pots screens.
    expect(within(pots).getByText('3 of 8 left · ~500 a serving · clears Sunday')).toBeInTheDocument();

    const dishes = rowsOf('Home-style dishes');
    expect(dishes[0]).toHaveTextContent('Ikan goreng');
    expect(dishes[0]).toHaveTextContent('6 times · ~190 each');
    expect(rowsOf('Your usual orders')[0]).toHaveTextContent('Bread, kaya, kopi');
    expect(screen.queryByRole('group', { name: 'Oil level here' })).not.toBeInTheDocument();

    await user.click(within(pots).getByRole('button', { name: 'Log 1 serving of Kari ayam' }));
    await expect.poll(async () => (await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(2);
    expect(toastMessage()).toBe('Saved · ~500 kcal · 2 left');
    const logged = await db.meals.where('logicalDay').equals('2026-10-16').toArray();
    expect(logged.find((m) => m.method === 'pot')?.placeId).toBe(home);
    expect(await within(pots).findByText('2 of 8 left · ~500 a serving · clears Sunday', {}, SLOW)).toBeInTheDocument();
  });

  it('logs only the half serving left, as on the Pots screens, and focus moves to All pots', async () => {
    const user = userEvent.setup();
    await db.pots.update(DEMO_IDS.pots.kariAyam, { servingsLeft: 0.5 });
    renderPlace(home);
    const pots = await screen.findByRole('list', { name: 'Pots at home' }, SLOW);
    expect(within(pots).getByText('½ of 8 left · ~500 a serving · clears Sunday')).toBeInTheDocument();
    const log = within(pots).getByRole('button', { name: 'Log 1 serving of Kari ayam' });
    log.focus();
    await user.keyboard('{Enter}');

    await expect.poll(async () => (await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(0);
    const meal = (await db.meals.where('logicalDay').equals('2026-10-16').toArray()).find((m) => m.method === 'pot');
    // Half a serving's kcal for the half taken, not a whole one.
    expect(meal?.items[0]?.quantity).toBe(0.5);
    expect(meal?.placeId).toBe(home);
    expect(toastMessage()).toBe('Saved · ~250 kcal · none left');
    // The pot is finished and leaves the list; focus doesn't fall back to the page.
    expect(await screen.findByText(/^No pots in the fridge/, {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'All pots' })).toHaveFocus(), SLOW);

    useUiStore.getState().toast?.undo?.();
    await expect.poll(async () => (await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(0.5);
  });

  it('opens all pots from Home', async () => {
    const user = userEvent.setup();
    const router = renderPlace(home);
    await user.click(await screen.findByRole('button', { name: 'All pots' }, SLOW));
    expect(router.state.location.pathname).toBe('/more/pots');
  });

  it('deletes the Place after a confirm, keeping its meals, and undo restores everything', async () => {
    const user = userEvent.setup();
    const router = renderPlace(nasiKandar);
    await user.click(await screen.findByRole('button', { name: 'Delete place' }, SLOW));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Nasi kandar near home?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await expect.poll(() => router.state.location.pathname).toBe('/more/places');
    expect(await db.places.get(nasiKandar)).toBeUndefined();
    expect(await db.meals.where('placeId').equals(nasiKandar).count()).toBe(0);
    expect(await db.meals.get(DEMO_IDS.meals.todayBreakfast)).toBeDefined();
    expect(toastMessage()).toMatch(/^Place deleted · \d+ meals kept$/);

    useUiStore.getState().toast?.undo?.();
    await expect.poll(async () => (await db.places.get(nasiKandar))?.name).toBe('Nasi kandar near home');
    await expect.poll(() => db.meals.where('placeId').equals(nasiKandar).count()).toBeGreaterThan(10);
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.placeId).toBe(nasiKandar);
    expect(await db.personalItems.where('placeId').equals(nasiKandar).count()).toBe(2);
  });

  it('cancelling the confirm keeps the Place', async () => {
    const user = userEvent.setup();
    renderPlace(kedai);
    await user.click(await screen.findByRole('button', { name: 'Delete place' }, SLOW));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.places.get(kedai)).toBeDefined();
  });

  it('shows a way back for a missing Place', async () => {
    const user = userEvent.setup();
    const router = renderPlace('place-gone');
    expect(await screen.findByText("This Place isn't here", {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByRole('heading').map((h) => h.tagName)).toEqual(['H1', 'H2', 'H3']);
    await user.click(screen.getByRole('button', { name: 'All places' }));
    expect(router.state.location.pathname).toBe('/more/places');
  });

  it('goes back to Places without history', async () => {
    const user = userEvent.setup();
    const router = renderPlace(kedai, false);
    await user.click(await screen.findByRole('button', { name: 'Back to Places' }));
    expect(router.state.location.pathname).toBe('/more/places');
  });
});
