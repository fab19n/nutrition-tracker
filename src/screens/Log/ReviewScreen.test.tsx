import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PATHS } from '@/app/paths';
import { byId } from '@/data/catalogue';
import { loadDemoData, resetAll, saveMeal } from '@/db/actions';
import { db } from '@/db/db';
import { usualOption } from '@/db/logging';
import { DEMO_IDS } from '@/db/seed/demo';
import { itemFromCatalogue, mealMacros, selectVariant } from '@/domain/meal';
import { resetUiState, useUiStore } from '@/state/ui';
import { editDraft, orderDraft, textDraft } from './drafts';
import { initialContext, timeSettings } from './mealTime';
import { SAVED_OFFLINE_TOAST } from './ReviewScreen';
import { renderLogRoutes } from './testHarness';
import { now } from '@/domain/clock';

const SENTENCE = 'nasi kandar ayam goreng, kubis, kuah campur, teh o ais';
const TODAY = '2026-10-16';

beforeEach(async () => {
  await resetAll();
  await loadDemoData();
  resetUiState();
});

function context(placeId?: string) {
  const ctx = initialContext(now(), timeSettings(undefined));
  return placeId ? { ...ctx, placeId } : ctx;
}

async function itemNames(): Promise<string[]> {
  const groups = await screen.findAllByRole('button', { name: /^More for / });
  return groups.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^More for /, ''));
}

describe('F02 · mamak meal by text', () => {
  it('types the meal, estimates it locally, fixes the kuah and saves', async () => {
    const user = userEvent.setup();
    renderLogRoutes('/?sheet=log');

    // The Log sheet opens on the Place you ate at last; this meal is at Medan selera.
    await user.click(await screen.findByRole('button', { name: /^Place:\s*Kedai near home/ }));
    const picker = await screen.findByRole('dialog', { name: 'Where did you eat?' });
    await user.click(within(picker).getByRole('button', { name: /Medan selera nearby/ }));
    expect(await screen.findByRole('button', { name: /^Place:\s*Medan selera nearby/ })).toBeInTheDocument();

    await user.click(screen.getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste(SENTENCE);
    expect(screen.getByText('Matches from your library · no AI yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Estimate' }));

    // S10 → S11 with the local estimator (no VITE_ESTIMATE_URL).
    expect(await screen.findByRole('heading', { name: 'Check your meal' })).toBeInTheDocument();
    expect(await itemNames()).toEqual(['Rice (nasi kandar)', 'Ayam goreng', 'Kubis', 'Kuah campur', 'Teh o ais']);
    expect(screen.getByText(`“${SENTENCE}”`)).toBeInTheDocument();
    expect(screen.getByText('880 kcal')).toBeInTheDocument();
    expect(screen.getByText('likely 750–1,010')).toBeInTheDocument();
    expect(screen.getByText('Is there kuah under the rice?')).toBeInTheDocument();
    // Today: 1,230 eaten of 1,800, so 880 more leaves 310 over, covered by the +650 saved.
    expect(await screen.findByText('After this: 310 over today · covered by your +650 saved')).toBeInTheDocument();

    const kuah = screen.getByRole('group', { name: 'Kuah campur portion' });
    await user.click(within(kuah).getByRole('button', { name: 'Banjir' }));
    expect(screen.getByText('980 kcal')).toBeInTheDocument();
    expect(screen.queryByText('Is there kuah under the rice?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
    expect(await screen.findByText('Saved · ~980 kcal')).toBeInTheDocument();

    const meals = await db.meals.where('logicalDay').equals(TODAY).toArray();
    const saved = meals.find((m) => m.method === 'text' && m.text === SENTENCE);
    expect(saved).toBeDefined();
    expect(saved?.placeId).toBe(DEMO_IDS.places.medanSelera);
    expect(saved?.slot).toBe('dinner');
    expect(Math.round(mealMacros(saved!).kcal)).toBe(980);
    const savedKuah = saved?.items.find((i) => i.catalogueId === 'kuah-campur');
    expect(savedKuah?.variants?.[savedKuah.selectedVariant ?? -1]?.label).toBe('Banjir');
    expect(savedKuah?.edited).toBe(true);
    expect(useUiStore.getState().logText).toBe('');
    // Review drops the draft as it unmounts, which can land just after Today first renders.
    await waitFor(() => expect(useUiStore.getState().reviewDraft).toBeNull());
  });

  it('takes the save back with Undo', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft({
      ...textDraft('teh tarik', context()),
      items: [itemFromCatalogue(byId('teh-tarik')!, { id: 'teh' })],
    });
    renderLogRoutes(PATHS.review);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText(/^Saved · ~/);
    const before = await db.meals.count();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await db.meals.count()).toBe(before - 1));
  });
});

describe('Review', () => {
  it('sends a direct visit with no draft to Today', async () => {
    renderLogRoutes(PATHS.review);
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
  });

  it('adds an item from the library and saves the price and a new Usual', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft({
      ...textDraft('roti canai', context(DEMO_IDS.places.nasiKandar)),
      items: [itemFromCatalogue(byId('roti-canai')!, { id: 'roti' })],
    });
    renderLogRoutes(PATHS.review);

    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const search = await screen.findByRole('dialog', { name: 'Add an item' });
    await user.type(within(search).getByRole('searchbox', { name: 'Search food' }), 'teh o ais');
    await user.click(await within(search).findByRole('button', { name: /^Teh o ais kurang\s*· your correction/ }));
    expect(await itemNames()).toEqual(['Roti canai', 'Teh o ais']);

    await user.type(screen.getByRole('textbox', { name: /Price/ }), '6.50');
    await user.click(screen.getByRole('switch', { name: 'Also save as a Usual' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: /Today screen/ });

    const meal = (await db.meals.toArray()).find((m) => m.name === 'Roti canai + teh o ais');
    expect(meal?.priceRm).toBe(6.5);
    expect(meal?.placeId).toBe(DEMO_IDS.places.nasiKandar);
    const usual = (await db.usuals.toArray()).find((u) => u.name === 'Roti canai + teh o ais');
    expect(usual?.items).toHaveLength(2);
    expect(usual?.placeId).toBe(DEMO_IDS.places.nasiKandar);
  });

  it('swaps and removes items', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft({
      ...textDraft('ayam goreng, kubis', context()),
      items: [itemFromCatalogue(byId('ayam-goreng-mamak')!, { id: 'a' }), itemFromCatalogue(byId('kubis')!, { id: 'k' })],
    });
    renderLogRoutes(PATHS.review);

    await user.click(await screen.findByRole('button', { name: 'More for Kubis' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(await itemNames()).toEqual(['Ayam goreng']);

    await user.click(screen.getByRole('button', { name: 'More for Ayam goreng' }));
    await user.click(screen.getByRole('menuitem', { name: 'Swap item' }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap item' });
    const box = within(sheet).getByRole('searchbox', { name: 'Search food' });
    await user.clear(box);
    await user.type(box, 'ayam madu');
    await user.click(await within(sheet).findByRole('button', { name: /^Ayam madu/ }));
    expect(await itemNames()).toEqual(['Ayam madu']);
  });

  it('logs a Usual with one tap from its review', async () => {
    const user = userEvent.setup();
    const usual = await db.usuals.get(DEMO_IDS.usuals.rotiCanai);
    useUiStore.getState().setReviewDraft(orderDraft(usualOption(usual!), context()));
    renderLogRoutes(PATHS.review);

    expect(await screen.findByRole('heading', { name: 'Your usual order' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Also save as a Usual' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved · ~560 kcal')).toBeInTheDocument();
    const meal = (await db.meals.where('logicalDay').equals(TODAY).toArray()).find((m) => m.method === 'usual');
    expect(meal?.name).toBe('Roti canai + teh tarik');
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.useCount).toBe(7);
  });

  it('clears the Log text once a typed usual is saved, so the next Log starts empty', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setLogText('roti canai');
    const usual = await db.usuals.get(DEMO_IDS.usuals.rotiCanai);
    useUiStore.getState().setReviewDraft(orderDraft(usualOption(usual!), context()));
    renderLogRoutes(PATHS.review);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
    expect(useUiStore.getState().logText).toBe('');
  });

  it('says a save made offline is kept and will sync', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft({
      ...textDraft('teh tarik', context()),
      items: [itemFromCatalogue(byId('teh-tarik')!, { id: 'teh' })],
    });
    renderLogRoutes(PATHS.review);
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(SAVED_OFFLINE_TOAST)).toBeInTheDocument();
    expect(SAVED_OFFLINE_TOAST).toBe("Saved offline. It'll sync when you're back online.");
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe('Review · edit mode', () => {
  it('updates the stored meal and returns to the entry', async () => {
    const user = userEvent.setup();
    const lunch = await db.meals.get(DEMO_IDS.meals.todayLunch);
    useUiStore.getState().setReviewDraft(editDraft(lunch!));
    renderLogRoutes(PATHS.review);

    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeInTheDocument();
    expect(screen.getByText('670 kcal')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Price/ })).toHaveValue('9.50');
    // Editing today's lunch: the after-line leaves the old version out of today.
    expect(await screen.findByText('After this: 570 kcal left today')).toBeInTheDocument();

    const kuah = screen.getByRole('group', { name: 'Kuah on rice portion' });
    await user.click(within(kuah).getByRole('button', { name: 'Banjir' }));
    expect(screen.getByText('750 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: new RegExp(`Entry screen ${PATHS.entry(DEMO_IDS.meals.todayLunch)}`) })).toBeInTheDocument();
    expect(screen.getByText('Saved · ~750 kcal')).toBeInTheDocument();
    const updated = await db.meals.get(DEMO_IDS.meals.todayLunch);
    expect(Math.round(mealMacros(updated!).kcal)).toBe(750);
    expect(updated?.eatenAt).toBe(lunch?.eatenAt);
    expect(updated?.priceRm).toBe(9.5);
    expect(await db.meals.where('logicalDay').equals(TODAY).count()).toBe(2);
  });

  it('deletes the entry after a confirm, with Undo', async () => {
    const user = userEvent.setup();
    const lunch = await db.meals.get(DEMO_IDS.meals.todayLunch);
    useUiStore.getState().setReviewDraft(editDraft(lunch!));
    renderLogRoutes(PATHS.review);

    await user.click(await screen.findByRole('button', { name: 'Delete entry' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this entry?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: new RegExp(`Diary screen ${PATHS.diary}\\?day=${TODAY}`) })).toBeInTheDocument();
    expect(await db.meals.get(DEMO_IDS.meals.todayLunch)).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await db.meals.get(DEMO_IDS.meals.todayLunch)).toBeDefined());
  });
});

describe('Review · repeated correction (C28)', () => {
  it('offers to make a correction made twice at a Place the default there', async () => {
    const user = userEvent.setup();
    const medan = DEMO_IDS.places.medanSelera;
    const kuah = () => itemFromCatalogue(byId('kuah-campur')!, { id: `kuah-${Math.random()}` });
    // First time at Medan selera: kuah Normal → Banjir.
    await saveMeal({ ...textDraft('kuah campur', context(medan)), items: [selectVariant(kuah(), 2)] });

    useUiStore.getState().setReviewDraft({ ...textDraft('nasi campur, kuah campur', context(medan)), items: [kuah()] });
    renderLogRoutes(PATHS.review);
    const group = await screen.findByRole('group', { name: 'Kuah campur portion' });
    await user.click(within(group).getByRole('button', { name: 'Banjir' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const prompt = await screen.findByRole('dialog', { name: 'Make this the default here?' });
    expect(within(prompt).getByText("You've changed kuah campur to banjir here twice. Make banjir the default here?")).toBeInTheDocument();
    // The saved toast waits for the answer, so it never covers the prompt's buttons.
    expect(useUiStore.getState().toast).toBeNull();
    await user.click(within(prompt).getByRole('button', { name: 'Yes' }));

    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toMatch(/^Saved · ~[\d,]+ kcal$/);
    await waitFor(async () => expect((await db.places.get(medan))?.defaultVariants['kuah-campur']).toBe(2));
    const personal = (await db.personalItems.toArray()).find((p) => p.placeId === medan && p.catalogueId === 'kuah-campur');
    expect(personal?.scope).toBe('place');
  });

  it('asks nothing after a one-off fix', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setReviewDraft({
      ...textDraft('kuah campur', context(DEMO_IDS.places.medanSelera)),
      items: [itemFromCatalogue(byId('kuah-campur')!, { id: 'k' })],
    });
    renderLogRoutes(PATHS.review);
    const group = await screen.findByRole('group', { name: 'Kuah campur portion' });
    await user.click(within(group).getByRole('button', { name: 'Sikit' }));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Make this the default here?' })).not.toBeInTheDocument();
  });
});
