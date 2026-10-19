// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import type { PersonalItem, Place, Pot, Usual } from '@/domain/types';
import {
  deletePersonalItem,
  deletePhoto,
  deletePhotos,
  deletePlace,
  deletePot,
  deleteUsual,
  findPersonalItem,
  findPlaceByName,
  getPersonalItem,
  getPhoto,
  getPlace,
  getPot,
  getUsual,
  listActivePots,
  listPersonalItems,
  listPersonalItemsForCatalogue,
  listPersonalItemsForPlace,
  listPhotoIds,
  listPlaces,
  listPots,
  listUsuals,
  listUsualsAtPlace,
  putPersonalItem,
  putPhoto,
  putPlace,
  putPot,
  putUsual,
  recordUsualUse,
  setPlaceDefaultVariant,
  takePotServings,
  updatePersonalItem,
  updatePlace,
  updatePot,
  updateUsual,
} from '.';

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

const T = '2026-09-28T01:10:00.000Z';
const macros = { kcal: 60, proteinG: 0, carbsG: 15, fatG: 0 };

describe('places repo', () => {
  const nasiKandar: Place = { id: 'nk', name: 'Nasi kandar near home', type: 'mamak', defaultVariants: {}, oilLevel: 'high', createdAt: T };
  const home: Place = { id: 'home', name: 'Home', type: 'home', defaultVariants: {}, createdAt: T };

  it('round-trips, sorts by name and finds by typed name', async () => {
    await putPlace(db, nasiKandar);
    await putPlace(db, home);
    expect(await getPlace(db, 'nk')).toEqual(nasiKandar);
    expect((await listPlaces(db)).map((p) => p.name)).toEqual(['Home', 'Nasi kandar near home']);
    expect((await findPlaceByName(db, '  nasi KANDAR   near home '))?.id).toBe('nk');
    expect(await findPlaceByName(db, 'Kedai')).toBeUndefined();
    expect(await findPlaceByName(db, '   ')).toBeUndefined();

    expect(await updatePlace(db, 'nk', { typicalPriceRm: 12 })).toBe(true);
    expect((await getPlace(db, 'nk'))?.typicalPriceRm).toBe(12);
    await deletePlace(db, 'home');
    expect(await getPlace(db, 'home')).toBeUndefined();
  });

  it('learns and forgets default portions', async () => {
    await putPlace(db, nasiKandar);
    expect(await setPlaceDefaultVariant(db, 'nk', 'rice-nasi-kandar', 2)).toBe(true);
    expect(await setPlaceDefaultVariant(db, 'nk', 'kuah-campur', 2)).toBe(true);
    expect((await getPlace(db, 'nk'))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2, 'kuah-campur': 2 });
    await setPlaceDefaultVariant(db, 'nk', 'kuah-campur', null);
    expect((await getPlace(db, 'nk'))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2 });
    expect(await setPlaceDefaultVariant(db, 'missing', 'x', 1)).toBe(false);
  });
});

describe('usuals repo', () => {
  const usual = (id: string, name: string, useCount: number, placeId?: string): Usual => ({
    id,
    name,
    items: [{ id: `${id}-1`, name, unitMacros: macros, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
    useCount,
    createdAt: T,
    ...(placeId ? { placeId } : {}),
  });

  it('round-trips and keeps the most used first', async () => {
    await putUsual(db, usual('u1', 'Teh o ais kurang', 3));
    await putUsual(db, usual('u2', 'Roti canai + teh tarik', 6, 'nk'));
    await putUsual(db, usual('u3', 'Bread, kaya, kopi', 3));
    expect((await getUsual(db, 'u2'))?.placeId).toBe('nk');
    expect((await listUsuals(db)).map((u) => u.id)).toEqual(['u2', 'u3', 'u1']);
    expect((await listUsualsAtPlace(db, 'nk')).map((u) => u.id)).toEqual(['u2']);

    expect(await recordUsualUse(db, 'u1')).toBe(true);
    expect(await recordUsualUse(db, 'u1')).toBe(true);
    expect((await listUsuals(db)).map((u) => u.id)).toEqual(['u2', 'u1', 'u3']);
    expect(await recordUsualUse(db, 'missing')).toBe(false);

    expect(await updateUsual(db, 'u3', { name: 'Kaya toast + kopi' })).toBe(true);
    expect((await getUsual(db, 'u3'))?.name).toBe('Kaya toast + kopi');
    await deleteUsual(db, 'u3');
    expect(await getUsual(db, 'u3')).toBeUndefined();
  });
});

describe('pots repo', () => {
  const pot = (id: string, cookedOn: string, expiresOn: string, servingsLeft: number): Pot => ({
    id,
    name: 'Kari ayam',
    recipeText: '1 ekor ayam, 1 tin santan',
    ingredients: [{ id: `${id}-ayam`, name: 'Ayam', amount: '1 ekor', macros: { kcal: 2150, proteinG: 190, carbsG: 0, fatG: 154 }, source: 'myfcd' }],
    servings: 8,
    servingsLeft,
    cookedOn,
    expiresOn,
    createdAt: `${cookedOn}T10:30:00.000Z`,
  });

  it('round-trips and lists the pots still in the fridge', async () => {
    await putPot(db, pot('old', '2026-10-01', '2026-10-05', 2));
    await putPot(db, pot('kari', '2026-10-14', '2026-10-18', 3));
    await putPot(db, pot('done', '2026-10-13', '2026-10-17', 0));
    expect((await getPot(db, 'kari'))?.servingsLeft).toBe(3);
    expect((await listPots(db)).map((p) => p.id)).toEqual(['kari', 'done', 'old']);
    expect((await listActivePots(db, '2026-10-16')).map((p) => p.id)).toEqual(['kari']);
    expect((await listActivePots(db, '2026-10-18')).map((p) => p.id)).toEqual(['kari']);
    expect(await listActivePots(db, '2026-10-19')).toEqual([]);

    expect(await updatePot(db, 'kari', { name: 'Kari ayam kentang' })).toBe(true);
    await deletePot(db, 'old');
    expect(await getPot(db, 'old')).toBeUndefined();
  });

  it('takes servings out, never below zero or above the total', async () => {
    await putPot(db, pot('kari', '2026-10-14', '2026-10-18', 3));
    expect((await takePotServings(db, 'kari', 0.5))?.servingsLeft).toBe(2.5);
    expect((await takePotServings(db, 'kari', 5))?.servingsLeft).toBe(0);
    expect((await takePotServings(db, 'kari', -2))?.servingsLeft).toBe(2);
    expect((await takePotServings(db, 'kari', -20))?.servingsLeft).toBe(8);
    expect(await takePotServings(db, 'missing', 1)).toBeUndefined();
  });
});

describe('photos repo', () => {
  it('round-trips photo blobs', async () => {
    const blob = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
    const thumb = new Blob(['thumb'], { type: 'image/jpeg' });
    await putPhoto(db, { id: 'p1', blob, thumb, createdAt: T });
    await putPhoto(db, { id: 'p2', blob, thumb, createdAt: T });

    const stored = await getPhoto(db, 'p1');
    expect(stored?.blob.type).toBe('image/jpeg');
    expect(await stored?.blob.text()).toBe('jpeg bytes');
    expect(await stored?.thumb.text()).toBe('thumb');
    expect((await listPhotoIds(db)).sort()).toEqual(['p1', 'p2']);

    await deletePhoto(db, 'p1');
    await deletePhotos(db, ['p2']);
    expect(await listPhotoIds(db)).toEqual([]);
  });
});

describe('personal items repo', () => {
  const item = (id: string, scope: PersonalItem['scope'], placeId?: string): PersonalItem => ({
    id,
    name: 'Kuah campur',
    catalogueId: 'kuah-campur',
    scope,
    unitMacros: macros,
    uncertainty: 0.15,
    corrections: 2,
    createdAt: T,
    updatedAt: T,
    ...(placeId ? { placeId } : {}),
  });

  it('round-trips and prefers a correction saved for this Place', async () => {
    await putPersonalItem(db, item('dish', 'dish'));
    await putPersonalItem(db, item('at-nk', 'place', 'nk'));
    expect((await getPersonalItem(db, 'dish'))?.scope).toBe('dish');
    expect(await listPersonalItems(db)).toHaveLength(2);
    expect((await listPersonalItemsForPlace(db, 'nk')).map((p) => p.id)).toEqual(['at-nk']);
    expect((await listPersonalItemsForCatalogue(db, 'kuah-campur')).length).toBe(2);

    expect((await findPersonalItem(db, 'kuah-campur', 'nk'))?.id).toBe('at-nk');
    expect((await findPersonalItem(db, 'kuah-campur', 'kedai'))?.id).toBe('dish');
    expect((await findPersonalItem(db, 'kuah-campur'))?.id).toBe('dish');
    expect(await findPersonalItem(db, 'teh-o-ais', 'nk')).toBeUndefined();

    expect(await updatePersonalItem(db, 'dish', { corrections: 3 })).toBe(true);
    expect((await getPersonalItem(db, 'dish'))?.corrections).toBe(3);
    await deletePersonalItem(db, 'dish');
    expect(await findPersonalItem(db, 'kuah-campur', 'kedai')).toBeUndefined();
  });
});
