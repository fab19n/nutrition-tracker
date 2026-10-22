import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import { renderLogRoutes } from './testHarness';

/** The photo sheet's Estimate asks the Drive engine for a token inside the tap; recorded here with what had happened by then. */
const drive = vi.hoisted(() => ({ renewals: [] as { draftSet: boolean }[] }));
vi.mock('@/drive', async (importOriginal) => {
  const { useUiStore: store } = await import('@/state/ui');
  return {
    ...(await importOriginal<typeof import('@/drive')>()),
    renewDriveTokenOnTap: () => {
      drive.renewals.push({ draftSet: store.getState().reviewDraft !== null });
    },
  };
});

beforeEach(async () => {
  drive.renewals.length = 0;
  await resetAll();
  await loadDemoData();
  resetUiState();
});

const placeChip = (name: RegExp | string) => screen.findByRole('button', { name: new RegExp(`^Place:\\s*${typeof name === 'string' ? name : name.source}`) });

describe('S09 Log sheet', () => {
  it('opens on the last Place, now and the suggested slot, with what you usually have there', async () => {
    renderLogRoutes('/?sheet=log');
    expect(await placeChip('Kedai near home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Dinner$/ })).toBeInTheDocument();
    expect(screen.getByText('Type it like a message')).toBeInTheDocument();
    for (const label of ['Photo', 'Plate', 'Usuals', 'Pot']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();

    const section = await screen.findByRole('region', { name: 'At Kedai near home' });
    expect(await within(section).findByText('Economy rice')).toBeInTheDocument();
    expect(within(section).getByText('9 times · ~670 kcal')).toBeInTheDocument();
    expect(within(section).getByText('· 3 left')).toBeInTheDocument();
    expect(within(section).getByText('Home · ~500 a serving')).toBeInTheDocument();
  });

  it('asks for location with a primer the first time, then pre-selects the Place within 150 m', async () => {
    const user = userEvent.setup();
    await db.profile.update('me', { useLocation: false });
    // Next to the nasi kandar stall (~10 m); Kedai near home is ~160 m away.
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 3.1413, longitude: 101.6865 }, timestamp: Date.now() } as GeolocationPosition),
    );
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    try {
      globalThis.localStorage.removeItem('kira-makan:location-primer-seen');
      renderLogRoutes('/?sheet=log');
      expect(await placeChip('Kedai near home')).toBeInTheDocument();
      const primer = await screen.findByRole('region', { name: "Pick the Place you're at?" });
      expect(getCurrentPosition).not.toHaveBeenCalled();
      await user.click(within(primer).getByRole('button', { name: 'Allow location' }));

      expect(await placeChip('Nasi kandar near home')).toHaveTextContent(/Nearby/);
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect((await db.profile.get('me'))?.useLocation).toBe(true);
      expect(screen.queryByRole('region', { name: "Pick the Place you're at?" })).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, 'geolocation');
    }
  });

  it("shows the check-in's time as last night, with the slot to match", async () => {
    // 9pm MYT on Thu 15 Oct.
    renderLogRoutes('/?sheet=log&at=2026-10-15T13:00:00.000Z');
    expect(await screen.findByRole('button', { name: /^Time:\s*Last night 9:00pm$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Dinner$/ })).toBeInTheDocument();
  });

  it('hints that a time after midnight counts toward the day before', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: /^Time:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'When did you eat?' });
    await user.type(within(sheet).getByLabelText('Pick a time'), '00:40');
    expect(within(sheet).getByText('Counts toward Thu')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /^Time:\s*Last night 12:40am$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Supper$/ })).toBeInTheDocument();
  });

  it('matches your library while you type and starts a review from a match', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await placeChip('Kedai near home');
    await user.click(screen.getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste('teh o ais');
    expect(screen.getByText('Matches from your library · no AI yet')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Matches from your library' });
    await user.click(within(list).getByRole('button', { name: /^Teh o ais kurang\s*· your correction\s*~60$/ }));

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Teh o ais' })).toBeInTheDocument();
    expect(screen.getByText('60 kcal')).toBeInTheDocument();
  });

  it('offers your usual order here while typing', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await placeChip('Kedai near home'));
    const picker = await screen.findByRole('dialog', { name: 'Where did you eat?' });
    await user.click(within(picker).getByRole('button', { name: /Nasi kandar near home/ }));
    await placeChip('Nasi kandar near home');

    await user.click(screen.getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste('nasi kandar ayam');
    const list = await screen.findByRole('list', { name: 'Matches from your library' });
    await user.click(await within(list).findByRole('button', { name: /^Nasi kandar ayam goreng\s*· your usual here/ }));
    expect(await screen.findByRole('heading', { name: 'Your usual order' })).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.meta.method).toBe('placeOrder');
    expect(useUiStore.getState().reviewDraft?.meta.placeId).toBe(DEMO_IDS.places.nasiKandar);
  });

  it('creates a Place from a new name', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await placeChip('Kedai near home'));
    const picker = await screen.findByRole('dialog', { name: 'Where did you eat?' });
    await user.type(within(picker).getByRole('searchbox', { name: 'Search places' }), 'Warung Pak Ali');
    await user.click(within(picker).getByRole('button', { name: "Create 'Warung Pak Ali'" }));

    const chip = await placeChip('Warung Pak Ali');
    expect(chip).toHaveTextContent(/Warung Pak Ali.*New/);
    const created = (await db.places.toArray()).find((p) => p.name === 'Warung Pak Ali');
    expect(created?.type).toBe('other');
  });

  it('logs a pot serving in one tap, with Undo', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    const section = await screen.findByRole('region', { name: 'At Kedai near home' });
    await user.click(within(section).getByRole('button', { name: 'Log 1 serving of Kari ayam' }));

    expect(await screen.findByText('Saved · ~500 kcal · 2 left')).toBeInTheDocument();
    expect((await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(2);
    // The toast can render a commit before the sheet's close navigation lands (slow under load).
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a meal' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(3));
  });

  it('logs one serving on a double tap of Log 1', async () => {
    renderLogRoutes('/?sheet=log');
    const section = await screen.findByRole('region', { name: 'At Kedai near home' });
    const before = await db.meals.count();
    const button = within(section).getByRole('button', { name: 'Log 1 serving of Kari ayam' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText('Saved · ~500 kcal · 2 left')).toBeInTheDocument();
    expect(await db.meals.count()).toBe(before + 1);
    expect((await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(2);
  });

  it('reads a custom time afresh each time it changes (a wheel spinning past now)', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: /^Time:/ }));
    const sheet = await screen.findByRole('dialog', { name: 'When did you eat?' });
    const input = within(sheet).getByLabelText('Pick a time');
    // 8pm is still ahead of the demo's 7:10pm, so it means last night…
    fireEvent.change(input, { target: { value: '20:00' } });
    expect(await screen.findByRole('button', { name: /^Time:\s*Last night 8:00pm$/ })).toBeInTheDocument();
    // …and turning back to 6pm is today again, not 6pm last night.
    fireEvent.change(input, { target: { value: '18:00' } });
    expect(await screen.findByRole('button', { name: /^Time:\s*6:00pm$/ })).toBeInTheDocument();
  });

  // The demo's breakfasts and lunches centre on 9:30am and 1:30pm, the same as the defaults;
  // MealContextChips.test pins that a learned time is used.
  const pickSlot = async (user: ReturnType<typeof userEvent.setup>, slot: string) => {
    await user.click(await screen.findByRole('button', { name: /^Meal:/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Which meal?' })).getByRole('button', { name: slot }));
  };
  const pickNow = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /^Time:/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'When did you eat?' })).getByRole('button', { name: 'Now' }));
  };

  it('moves a "Now" meal to your usual time for an earlier slot, and back to now for the current one', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await pickSlot(user, 'Breakfast');
    expect(await screen.findByRole('button', { name: /^Time:\s*9:30am$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Breakfast$/ })).toBeInTheDocument();

    await pickSlot(user, 'Dinner');
    expect(await screen.findByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
  });

  /** Log sheet: Breakfast (time moves to 9:30am), then a library match into Review. */
  const breakfastToReview = async (user: ReturnType<typeof userEvent.setup>) => {
    renderLogRoutes('/?sheet=log');
    await pickSlot(user, 'Breakfast');
    await user.click(screen.getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste('teh o ais');
    const list = await screen.findByRole('list', { name: 'Matches from your library' });
    await user.click(within(list).getByRole('button', { name: /^Teh o ais kurang\s*· your correction\s*~60$/ }));
    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.meta).toMatchObject({ slot: 'breakfast', eatenAt: '2026-10-16T01:30:00.000Z', timeFromSlot: true });
    expect(screen.getByRole('button', { name: /^Time:\s*9:30am$/ })).toBeInTheDocument();
  };

  /** Log sheet: Breakfast (time moves to 9:30am), then the plate builder. */
  const breakfastToPlate = async (user: ReturnType<typeof userEvent.setup>) => {
    renderLogRoutes('/?sheet=log');
    await pickSlot(user, 'Breakfast');
    await user.click(await screen.findByRole('button', { name: 'Plate' }));
    expect(await screen.findByRole('heading', { name: 'Build your plate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Time:\s*9:30am$/ })).toBeInTheDocument();
  };

  it('carries a slot time into the review, where another slot still moves it', async () => {
    const user = userEvent.setup();
    await breakfastToReview(user);
    await pickSlot(user, 'Lunch');
    expect(await screen.findByRole('button', { name: /^Time:\s*1:30pm$/ })).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.meta).toMatchObject({ slot: 'lunch', eatenAt: '2026-10-16T05:30:00.000Z', timeFromSlot: true });
  });

  it('keeps the slot you picked when you change the time on the review', async () => {
    const user = userEvent.setup();
    await breakfastToReview(user);
    // It was breakfast, just later: the time changes, the slot you picked stays.
    await pickNow(user);
    expect(await screen.findByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Breakfast$/ })).toBeInTheDocument();
    expect(useUiStore.getState().reviewDraft?.meta).toMatchObject({ slot: 'breakfast' });
    expect(useUiStore.getState().reviewDraft?.meta.timeFromSlot).toBeUndefined();
  });

  it('carries a slot time to the plate builder, where another slot still moves it', async () => {
    const user = userEvent.setup();
    await breakfastToPlate(user);
    await pickSlot(user, 'Lunch');
    expect(await screen.findByRole('button', { name: /^Time:\s*1:30pm$/ })).toBeInTheDocument();
  });

  it('keeps the slot you picked when you change the time on the plate builder', async () => {
    const user = userEvent.setup();
    await breakfastToPlate(user);
    await pickNow(user);
    expect(await screen.findByRole('button', { name: /^Time:\s*Now · 7:10pm$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Meal:\s*Breakfast$/ })).toBeInTheDocument();
  });

  it('never moves a time you picked when the slot changes', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: /^Time:/ }));
    fireEvent.change(within(await screen.findByRole('dialog', { name: 'When did you eat?' })).getByLabelText('Pick a time'), { target: { value: '18:00' } });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /^Time:\s*6:00pm$/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Meal:/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Which meal?' })).getByRole('button', { name: 'Breakfast' }));
    expect(await screen.findByRole('button', { name: /^Meal:\s*Breakfast$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Time:\s*6:00pm$/ })).toBeInTheDocument();
  });

  it('lists pots in their own sheet', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Pot' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pots in the fridge' });
    expect(within(sheet).getByText('3 of 8 servings left · ~500 each')).toBeInTheDocument();
    expect(within(sheet).getByText('Clears Sun')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log 1 serving of Kari ayam' }));
    expect(await screen.findByText('Saved · ~500 kcal · 2 left')).toBeInTheDocument();
  });

  it('picks a Usual from the Usuals sheet into the review', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Usuals' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your usuals' });
    await user.click(within(sheet).getByRole('button', { name: 'Log Roti canai + teh tarik' }));

    expect(await screen.findByRole('heading', { name: 'Your usual order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Roti canai + dhal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Teh tarik' })).toBeInTheDocument();
    expect(screen.getByText('560 kcal')).toBeInTheDocument();
  });

  it('opens the Usuals screen from the Usuals sheet, in place of the Log sheet', async () => {
    const user = userEvent.setup();
    const { router } = renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Usuals' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your usuals' });
    await user.click(within(sheet).getByRole('button', { name: 'Manage usuals' }));

    expect(await screen.findByRole('heading', { name: 'Usuals screen /more/usuals' })).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers New pot and All pots under the pots in the fridge', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Pot' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pots in the fridge' });
    expect(within(sheet).getByRole('button', { name: 'All pots' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'New pot' }));

    expect(await screen.findByRole('heading', { name: 'New pot screen /more/pots/new' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('makes New pot the main action when nothing is in the fridge', async () => {
    const user = userEvent.setup();
    await db.pots.clear();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Pot' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pots in the fridge' });
    expect(await within(sheet).findByRole('heading', { name: 'No pots right now' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button', { name: 'New pot' })).toHaveLength(1);
    await user.click(within(sheet).getByRole('button', { name: 'All pots' }));

    expect(await screen.findByRole('heading', { name: 'Pots screen /more/pots' })).toBeInTheDocument();
  });

  it('goes to the plate builder with the chosen time', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await user.click(await screen.findByRole('button', { name: 'Plate' }));
    expect(await screen.findByRole('heading', { name: 'Build your plate' })).toBeInTheDocument();
  });

  it('keeps a photo and estimates it with its caption', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await placeChip('Kedai near home');
    const file = new File(['jpeg'], 'dinner.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Photo of your meal'), file);

    const sheet = await screen.findByRole('dialog', { name: 'Add a photo' });
    await user.type(within(sheet).getByLabelText('Add a few words, e.g. kuah banjir'), 'nasi lemak, teh tarik');
    await user.click(within(sheet).getByRole('button', { name: 'Estimate' }));

    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    const draft = useUiStore.getState().reviewDraft;
    expect(draft?.flow).toBe('photo');
    expect(draft?.meta.method).toBe('photo');
    expect(draft?.items.length).toBeGreaterThan(0);
    const photoId = draft?.meta.photoId;
    expect(photoId).toBeDefined();
    expect(await db.photos.get(photoId ?? '')).toBeDefined();
  });

  it("asks Drive for a token inside the Estimate tap, once, before going on", async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');
    await placeChip('Kedai near home');
    await user.upload(screen.getByLabelText('Photo of your meal'), new File(['jpeg'], 'dinner.jpg', { type: 'image/jpeg' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a photo' });
    expect(drive.renewals).toEqual([]);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Estimate' }));
    // Synchronously in the click, before the photo is kept or the draft made.
    expect(drive.renewals).toEqual([{ draftSet: false }]);
    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(drive.renewals).toHaveLength(1);
  });
});
