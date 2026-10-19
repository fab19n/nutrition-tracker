import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import PlacesScreen from './PlacesScreen';

const SLOW = { timeout: 4000 };
const PRIMER_KEY = 'kira-makan:location-primer-seen';

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
    </div>
  );
}

function renderPlaces(withHistory = true) {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/more/places', element: <PlacesScreen /> },
      { path: '/more/places/:id', element: <Probe name="Place" /> },
    ],
    withHistory ? { initialEntries: ['/more', '/more/places'], initialIndex: 1 } : { initialEntries: ['/more/places'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The Place names in list order. */
async function cardNames(): Promise<string[]> {
  const list = await screen.findByRole('list', { name: 'Your Places' }, SLOW);
  return within(list)
    .getAllByRole('button')
    .map((b) => b.querySelector('span > span')?.textContent ?? '');
}

function card(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

function mockGeolocation(lat: number, lng: number) {
  const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: lat, longitude: lng }, timestamp: Date.now() } as GeolocationPosition));
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  await loadDemoData();
});

afterEach(async () => {
  Reflect.deleteProperty(navigator, 'geolocation');
  await resetAll();
});

describe('PlacesScreen (S21)', () => {
  it('lists the Places with visits, average here vs elsewhere and spend, most recent first', async () => {
    renderPlaces();
    expect(screen.getByRole('heading', { level: 1, name: 'Places' })).toBeInTheDocument();
    expect(await cardNames()).toEqual(['Kedai near home', 'Nasi kandar near home', 'Medan selera nearby', 'Home']);

    const nasiKandar = card('Nasi kandar near home');
    expect(nasiKandar).toHaveTextContent('Mamak');
    expect(nasiKandar).toHaveTextContent('11 visits');
    expect(nasiKandar).toHaveTextContent('RM 16.80 this week');
    expect(nasiKandar).toHaveTextContent('~790 kcal a meal');
    expect(nasiKandar).toHaveTextContent('vs ~480 elsewhere');
    expect(within(nasiKandar).queryByText('Learning')).not.toBeInTheDocument();

    const medan = card('Medan selera nearby');
    expect(medan).toHaveTextContent('Hawker');
    expect(medan).toHaveTextContent('2 visits');
    expect(within(medan).getByText('Learning')).toBeInTheDocument();

    // Home has no prices: no spend line.
    expect(card('Home')).not.toHaveTextContent('RM');
    expect(screen.getByRole('radio', { name: 'Recent' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('sorts by most visited and searches by name', async () => {
    const user = userEvent.setup();
    renderPlaces();
    await cardNames();

    await user.click(screen.getByRole('radio', { name: 'Most visited' }));
    expect(await cardNames()).toEqual(['Home', 'Nasi kandar near home', 'Kedai near home', 'Medan selera nearby']);

    await user.type(screen.getByRole('searchbox', { name: 'Search places' }), 'near');
    expect(await cardNames()).toEqual(['Nasi kandar near home', 'Kedai near home', 'Medan selera nearby']);

    await user.clear(screen.getByRole('searchbox', { name: 'Search places' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search places' }), 'kopitiam');
    expect(screen.queryByRole('list', { name: 'Your Places' })).not.toBeInTheDocument();
    expect(screen.getByText(/No Places match “kopitiam”/)).toBeInTheDocument();
  });

  it('opens a Place', async () => {
    const user = userEvent.setup();
    const router = renderPlaces();
    await cardNames();
    await user.click(card('Kedai near home'));
    expect(router.state.location.pathname).toBe(`/more/places/${DEMO_IDS.places.kedai}`);
  });

  it('adds a new place, guessing its type from the name', async () => {
    const user = userEvent.setup();
    const router = renderPlaces();
    await cardNames();
    await user.click(screen.getByRole('button', { name: 'New place' }));

    const sheet = await screen.findByRole('dialog', { name: 'New place' });
    await user.type(within(sheet).getByLabelText('Name'), 'Kopitiam Ah Seng');
    expect(within(sheet).getByRole('button', { name: 'Kopitiam' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Save place' }));

    await expect.poll(() => db.places.count()).toBe(5);
    const added = await db.places.filter((p) => p.name === 'Kopitiam Ah Seng').first();
    expect(added).toMatchObject({ type: 'kopitiam', defaultVariants: {} });
    expect(added?.coords).toBeUndefined();
    expect(router.state.location.pathname).toBe(`/more/places/${added?.id}`);
    expect(useUiStore.getState().toast?.message).toBe('Added Kopitiam Ah Seng');
  });

  it('asks for the name before saving, and goes to an existing Place with the same name', async () => {
    const user = userEvent.setup();
    const router = renderPlaces();
    await cardNames();
    await user.click(screen.getByRole('button', { name: 'New place' }));
    const sheet = await screen.findByRole('dialog', { name: 'New place' });

    await user.click(within(sheet).getByRole('button', { name: 'Save place' }));
    expect(within(sheet).getByText('Give it a name')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');

    await user.type(within(sheet).getByLabelText('Name'), 'home');
    expect(within(sheet).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Save place' }));
    await expect.poll(() => router.state.location.pathname).toBe(`/more/places/${DEMO_IDS.places.home}`);
    expect(useUiStore.getState().toast?.message).toBe('You already have Home');
    expect(await db.places.count()).toBe(4);
  });

  it('saves where you are with a new place, after the location primer the first time', async () => {
    const user = userEvent.setup();
    await db.profile.update('me', { useLocation: false });
    globalThis.localStorage.removeItem(PRIMER_KEY);
    const getCurrentPosition = mockGeolocation(3.15, 101.71);
    renderPlaces();
    await cardNames();
    await user.click(screen.getByRole('button', { name: 'New place' }));
    const sheet = await screen.findByRole('dialog', { name: 'New place' });
    await user.type(within(sheet).getByLabelText('Name'), 'Gerai Pak Mat');
    expect(within(sheet).getByRole('button', { name: 'Hawker' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(sheet).getByRole('switch', { name: 'Use where I am now' }));
    const primer = within(sheet).getByRole('region', { name: "Save this Place's spot?" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(within(sheet).getByRole('button', { name: 'Save place' })).toBeDisabled();
    await user.click(within(primer).getByRole('button', { name: 'Allow location' }));

    expect(await within(sheet).findByText('Got it. Only this spot is saved.')).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'Use where I am now' })).toHaveAttribute('aria-checked', 'true');
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect((await db.profile.get('me'))?.useLocation).toBe(true);
    expect(globalThis.localStorage.getItem(PRIMER_KEY)).toBe('1');

    await user.click(within(sheet).getByRole('button', { name: 'Save place' }));
    await expect.poll(async () => (await db.places.filter((p) => p.name === 'Gerai Pak Mat').first())?.coords).toEqual({ lat: 3.15, lng: 101.71 });
  });

  it('keeps the toggle off when location fails or is declined', async () => {
    const user = userEvent.setup();
    globalThis.localStorage.setItem(PRIMER_KEY, '1');
    const getCurrentPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
      fail?.({ code: 1, message: 'denied' } as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    renderPlaces();
    await cardNames();
    await user.click(screen.getByRole('button', { name: 'New place' }));
    const sheet = await screen.findByRole('dialog', { name: 'New place' });
    await user.click(within(sheet).getByRole('switch', { name: 'Use where I am now' }));
    expect(await within(sheet).findByText("Couldn't get your location. Try again in a moment.")).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'Use where I am now' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the empty state before any Place exists', async () => {
    const user = userEvent.setup();
    await db.places.clear();
    renderPlaces();
    expect(await screen.findByText("Places appear as you log. Type a name in 'Where?' next time you eat out.", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    // Headings in order: h1 Places, h2, then the empty state's h3.
    expect(screen.getAllByRole('heading').map((h) => h.tagName)).toEqual(['H1', 'H2', 'H3']);
    expect(screen.getByRole('heading', { level: 2, name: 'Your Places' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New place' }));
    expect(await screen.findByRole('dialog', { name: 'New place' })).toBeInTheDocument();
  });

  it('goes back to where it came from, or to More', async () => {
    const user = userEvent.setup();
    const router = renderPlaces(false);
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(router.state.location.pathname).toBe('/more');
  });
});
