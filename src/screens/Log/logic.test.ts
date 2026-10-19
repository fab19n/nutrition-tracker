import { byId } from '@/data/catalogue';
import { distanceMetres, nearestPlace } from '@/db/logging';
import type { PersonalItem, Place } from '@/domain/types';
import { DEFAULT_SLOT_TIMES } from '@/domain/timing';
import { contextMeta } from './drafts';
import { buildLogMatches, itemDisplayName, learnedItem, searchLibrary } from './library';
import {
  absoluteTimeLabel,
  afterMidnightHint,
  customTimeAt,
  resumedContext,
  slotTimeAt,
  timeChipLabel,
  withSlot,
  type MealContext,
} from './mealTime';
import { parsePrice } from './price';

const S = { tz: 'Asia/Kuala_Lumpur', rolloverHour: 5 };
/** Fri 16 Oct 2026, 7:10pm MYT. */
const NOW = new Date('2026-10-16T11:10:00.000Z');

describe('meal time', () => {
  it('labels every choice with a clock time, plus last night and after-midnight times', () => {
    expect(timeChipLabel({ timeId: 'now' }, NOW, S)).toBe('Now · 7:10pm');
    expect(timeChipLabel({ timeId: 'm30', eatenAt: '2026-10-16T10:40:00.000Z' }, NOW, S)).toBe('30 min ago · 6:40pm');
    expect(timeChipLabel({ timeId: 'h1', eatenAt: '2026-10-16T10:10:00.000Z' }, NOW, S)).toBe('1 h ago · 6:10pm');
    expect(timeChipLabel({ timeId: 'slot', eatenAt: '2026-10-16T01:30:00.000Z' }, NOW, S)).toBe('9:30am');
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
    expect(timeChipLabel({ timeId: 'now' }, late, S)).toBe('Now · 1:00am · counts toward Fri');
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
    // A time the slot chip set stays a slot time, so another slot can still move it, and the slot
    // counts as picked, so a new time keeps it.
    expect(resumedContext({ eatenAt: '2026-10-16T01:30:00.000Z', slot: 'breakfast', timeFromSlot: true }, NOW, S)).toMatchObject({
      timeId: 'slot',
      slot: 'breakfast',
      slotTouched: true,
    });
  });
});

describe('picking a slot moves a "Now" meal to its usual time', () => {
  const BREAKFAST = DEFAULT_SLOT_TIMES.breakfast; // 9:30am
  const LUNCH = DEFAULT_SLOT_TIMES.lunch; // 1:30pm
  const nowCtx: MealContext = { timeId: 'now', slot: 'dinner', slotTouched: false };

  it('moves to the slot’s usual time today when that was 2 hours ago or more', () => {
    expect(slotTimeAt('breakfast', BREAKFAST, NOW, S)).toBe('2026-10-16T01:30:00.000Z');
    expect(slotTimeAt('lunch', LUNCH, NOW, S)).toBe('2026-10-16T05:30:00.000Z');
    // Your own usual time, when the app has learned one: breakfast at 8:05am.
    expect(slotTimeAt('breakfast', 8 * 60 + 5, NOW, S)).toBe('2026-10-16T00:05:00.000Z');
    // Exactly 2 hours ago moves; 1 h 40 min ago is too close to tell from now (a late learned lunch).
    expect(slotTimeAt('lunch', 17 * 60 + 10, NOW, S)).toBe('2026-10-16T09:10:00.000Z');
    expect(slotTimeAt('lunch', 17 * 60 + 30, NOW, S)).toBeUndefined();
  });

  it('leaves later slots, snacks and the slot now falls in at now', () => {
    expect(slotTimeAt('supper', DEFAULT_SLOT_TIMES.supper, NOW, S)).toBeUndefined();
    expect(slotTimeAt('snack', DEFAULT_SLOT_TIMES.snack, NOW, S)).toBeUndefined();
    // 7:10pm is dinner time: even a learned 5pm dinner is the dinner being eaten now.
    expect(slotTimeAt('dinner', 17 * 60, NOW, S)).toBeUndefined();
  });

  it('keeps a meal at now when you re-tap the slot it already shows', () => {
    // Sat 2:15am is supper (Friday's logical day); tapping Supper again is the supper being eaten now…
    const supperTime = new Date('2026-10-16T18:15:00.000Z');
    const start: MealContext = { timeId: 'now', slot: 'supper', slotTouched: false };
    expect(withSlot(start, 'supper', DEFAULT_SLOT_TIMES.supper, supperTime, S)).toEqual({ timeId: 'now', slot: 'supper', slotTouched: true });
    // …while Dinner still means the one at 8:30pm.
    expect(withSlot(start, 'dinner', DEFAULT_SLOT_TIMES.dinner, supperTime, S)).toMatchObject({ timeId: 'slot', eatenAt: '2026-10-16T12:30:00.000Z' });
    // 3:45pm is lunch time: Lunch stays now, even with a learned 12:30 lunch.
    const lunchTime = new Date('2026-10-16T07:45:00.000Z');
    expect(withSlot({ timeId: 'now', slot: 'lunch', slotTouched: false }, 'lunch', 12 * 60 + 30, lunchTime, S)).toMatchObject({ timeId: 'now' });
  });

  it('reads the slot on the logical day after midnight', () => {
    // Sat 17 Oct, 1:00am MYT is still Friday: "Breakfast" means Friday morning.
    const late = new Date('2026-10-16T17:00:00.000Z');
    expect(slotTimeAt('breakfast', BREAKFAST, late, S)).toBe('2026-10-16T01:30:00.000Z');
    // Dinner at 8:30pm is Friday's too.
    expect(slotTimeAt('dinner', DEFAULT_SLOT_TIMES.dinner, late, S)).toBe('2026-10-16T12:30:00.000Z');
    // Before the rollover it's supper time, so Supper is the one being eaten now, even with a
    // learned 12:30am supper 2 h 30 min before 3am.
    expect(slotTimeAt('supper', DEFAULT_SLOT_TIMES.supper, late, S)).toBeUndefined();
    expect(slotTimeAt('supper', 30, new Date('2026-10-16T19:00:00.000Z'), S)).toBeUndefined();
  });

  it('moves the time, then back to "Now" for a slot that is not earlier', () => {
    const breakfast = withSlot(nowCtx, 'breakfast', BREAKFAST, NOW, S);
    expect(breakfast).toEqual({ timeId: 'slot', eatenAt: '2026-10-16T01:30:00.000Z', slot: 'breakfast', slotTouched: true });
    expect(withSlot(breakfast, 'lunch', LUNCH, NOW, S)).toMatchObject({ timeId: 'slot', eatenAt: '2026-10-16T05:30:00.000Z', slot: 'lunch' });
    const dinner = withSlot(breakfast, 'dinner', DEFAULT_SLOT_TIMES.dinner, NOW, S);
    expect(dinner).toEqual({ timeId: 'now', slot: 'dinner', slotTouched: true });
  });

  it('never moves a time you picked', () => {
    const picked = '2026-10-16T08:00:00.000Z';
    for (const timeId of ['custom', 'preset', 'm30', 'h1'] as const) {
      const ctx: MealContext = { timeId, eatenAt: picked, slot: 'snack', slotTouched: false };
      expect(withSlot(ctx, 'breakfast', BREAKFAST, NOW, S)).toEqual({ timeId, eatenAt: picked, slot: 'breakfast', slotTouched: true });
    }
  });

  it('marks a slot time in the review draft, and only that', () => {
    const breakfast = withSlot(nowCtx, 'breakfast', BREAKFAST, NOW, S);
    expect(contextMeta(breakfast)).toEqual({ slot: 'breakfast', eatenAt: '2026-10-16T01:30:00.000Z', timeFromSlot: true });
    expect(contextMeta({ ...breakfast, timeId: 'custom' })).toEqual({ slot: 'breakfast', eatenAt: '2026-10-16T01:30:00.000Z' });
    expect(contextMeta(nowCtx)).toEqual({ slot: 'dinner' });
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
