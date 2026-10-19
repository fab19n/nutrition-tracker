import { byId } from '@/data/catalogue';
import { distanceMetres, nearestPlace } from '@/db/logging';
import type { PersonalItem, Place } from '@/domain/types';
import { buildLogMatches, itemDisplayName, learnedItem, searchLibrary } from './library';
import { absoluteTimeLabel, afterMidnightHint, customTimeAt, resumedContext, timeChipLabel } from './mealTime';
import { parsePrice } from './price';

const S = { tz: 'Asia/Kuala_Lumpur', rolloverHour: 5 };
/** Fri 16 Oct 2026, 7:10pm MYT. */
const NOW = new Date('2026-10-16T11:10:00.000Z');

describe('meal time', () => {
  it('labels quick choices, last night and after-midnight times', () => {
    expect(timeChipLabel({ timeId: 'now' }, NOW, S)).toBe('Now');
    expect(timeChipLabel({ timeId: 'now' }, NOW, S, true)).toBe('Now · 7:10pm');
    expect(timeChipLabel({ timeId: 'm30', eatenAt: '2026-10-16T10:40:00.000Z' }, NOW, S)).toBe('30 min ago');
    expect(absoluteTimeLabel('2026-10-15T13:00:00.000Z', NOW, S)).toBe('Last night 9:00pm');
    expect(absoluteTimeLabel('2026-10-15T05:30:00.000Z', NOW, S)).toBe('Yesterday 1:30pm');
    expect(absoluteTimeLabel('2026-10-16T06:15:00.000Z', NOW, S)).toBe('2:15pm');
    expect(absoluteTimeLabel('2026-10-13T12:00:00.000Z', NOW, S)).toBe('Tue 8:00pm');
  });

  it('puts a custom time on the right day', () => {
    // 1pm today.
    expect(customTimeAt('13:00', '2026-10-16', NOW, S)).toBe('2026-10-16T05:00:00.000Z');
    // 12:40am is after midnight: it counts toward the day before (Thu).
    const late = customTimeAt('00:40', '2026-10-16', NOW, S);
    expect(late).toBe('2026-10-15T16:40:00.000Z');
    expect(afterMidnightHint(late, S)).toBe('Counts toward Thu');
    // 9pm hasn't happened yet today, so it means last night.
    expect(customTimeAt('21:00', '2026-10-16', NOW, S)).toBe('2026-10-15T13:00:00.000Z');
    expect(customTimeAt('25:00', '2026-10-16', NOW, S)).toBeUndefined();
  });

  it('says "Now" after midnight counts toward the day before', () => {
    // Sat 17 Oct, 1:00am MYT: still Friday's logical day.
    const late = new Date('2026-10-16T17:00:00.000Z');
    expect(timeChipLabel({ timeId: 'now' }, late, S)).toBe('Now · counts toward Fri');
    expect(timeChipLabel({ timeId: 'now' }, late, S, true)).toBe('Now · 1:00am · counts toward Fri');
    expect(afterMidnightHint(late.toISOString(), S)).toBe('Counts toward Fri');
  });

  it('picks the Log context back up after Cancel, with the preset time as its own choice', () => {
    const lastNight = '2026-10-15T13:00:00.000Z';
    expect(resumedContext({ eatenAt: lastNight, placeId: 'p', slot: 'dinner' }, NOW, S, lastNight)).toEqual({
      timeId: 'preset',
      eatenAt: lastNight,
      placeId: 'p',
      slot: 'dinner',
      slotTouched: false,
    });
    expect(resumedContext({ eatenAt: lastNight, slot: 'snack' }, NOW, S)).toMatchObject({ timeId: 'custom', slot: 'snack', slotTouched: true });
    expect(resumedContext({ placeName: 'Warung baru' }, NOW, S)).toMatchObject({ timeId: 'now', placeName: 'Warung baru' });
  });
});

describe('library', () => {
  const tehOAis = byId('teh-o-ais');
  const kurang: PersonalItem = {
    id: 'p1',
    name: 'Teh o ais',
    catalogueId: 'teh-o-ais',
    scope: 'dish',
    variants: tehOAis?.variants ?? [],
    selectedVariant: 1,
    unitMacros: tehOAis?.variants[1]?.macros ?? { kcal: 60, proteinG: 0, carbsG: 15, fatG: 0 },
    uncertainty: 0.15,
    corrections: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const nasiKandar: Place = {
    id: 'nk',
    name: 'Nasi kandar near home',
    type: 'mamak',
    defaultVariants: { 'rice-nasi-kandar': 2 },
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  it('applies your corrections and the Place’s learned portions', () => {
    const teh = learnedItem(tehOAis!, { personal: [kurang] });
    expect([teh.source, teh.unitMacros.kcal, itemDisplayName(teh)]).toEqual(['yourCorrection', 60, 'Teh o ais kurang']);
    const rice = learnedItem(byId('rice-nasi-kandar')!, { place: nasiKandar, personal: [] });
    expect([rice.source, rice.unitMacros.kcal]).toEqual(['yourCorrection', 430]);
  });

  it('matches the piece being typed, and whole orders at the start', () => {
    const matches = buildLogMatches('nasi kandar ayam goreng, teh o ais', {
      place: nasiKandar,
      personal: [kurang],
      orders: [{ id: 'o1', name: 'Nasi kandar ayam goreng', items: [], times: 9, kcal: 950, method: 'placeOrder', placeId: 'nk' }],
    });
    expect(matches[0]).toMatchObject({ kind: 'order', name: 'Nasi kandar ayam goreng', detail: 'your usual here', kcal: 950 });
    expect(matches[1]).toMatchObject({ kind: 'item', name: 'Teh o ais kurang', detail: 'your correction', kcal: 60 });
  });

  it('searches corrections, usuals and the catalogue', () => {
    const results = searchLibrary('teh', { personal: [kurang], usuals: [] });
    expect(results[0]).toMatchObject({ name: 'Teh o ais kurang', detail: 'your correction' });
    expect(results.some((r) => r.detail === 'Catalogue')).toBe(true);
  });
});

describe('places and prices', () => {
  it('finds the nearest saved Place within 150 m', () => {
    const at = { lat: 3.1413, lng: 101.6865 };
    const places: Place[] = [
      { id: 'nk', name: 'Nasi kandar', type: 'mamak', coords: { lat: 3.1412, lng: 101.6865 }, defaultVariants: {}, createdAt: '' },
      { id: 'kedai', name: 'Kedai', type: 'economyRice', coords: { lat: 3.1405, lng: 101.6879 }, defaultVariants: {}, createdAt: '' },
      { id: 'home', name: 'Home', type: 'home', defaultVariants: {}, createdAt: '' },
    ];
    expect(distanceMetres(at, { lat: 3.1412, lng: 101.6865 })).toBeLessThan(15);
    expect(nearestPlace(places, at)?.id).toBe('nk');
    expect(nearestPlace(places, { lat: 3.15, lng: 101.7 })).toBeUndefined();
  });

  it('reads a typed price', () => {
    expect(parsePrice('9.5')).toBe(9.5);
    expect(parsePrice('12,30')).toBe(12.3);
    expect(parsePrice('')).toBeUndefined();
  });
});
