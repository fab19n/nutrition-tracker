// @vitest-environment node
import { SYNC_TABLES } from '@/db/db';
import type { MealLog, Profile } from '@/domain/types';
import {
  DEVICE_PROFILE_FIELDS,
  canonicalJson,
  fromServerRow,
  hashJson,
  isRealChange,
  isSyncTable,
  primaryKeyField,
  toServerRow,
  wireHash,
} from './rows';

const profile: Profile = {
  id: 'me',
  age: 34,
  sex: 'male',
  heightCm: 172,
  weightKgAtSetup: 78.6,
  activity: 'light',
  timeZone: 'Asia/Kuala_Lumpur',
  rolloverHour: 5,
  weekStartsOn: 1,
  dailyMinimumKcal: 1400,
  theme: 'dark',
  aiEstimates: 'auto',
  keepPhotos: true,
  useLocation: true,
  startedOn: '2026-10-01',
  setupCompletedAt: '2026-10-01T01:00:00.000Z',
  demoMode: false,
};

const meal: MealLog = {
  id: 'm1',
  eatenAt: '2026-10-16T04:30:00.000Z',
  logicalDay: '2026-10-16',
  slot: 'lunch',
  name: 'Economy rice',
  items: [],
  method: 'manual',
  finished: 'all',
  createdAt: '2026-10-16T04:31:00.000Z',
  updatedAt: '2026-10-16T04:31:00.000Z',
  syncState: 'local',
};

describe('tables and keys', () => {
  it('knows the synced tables and their key fields', () => {
    expect(isSyncTable('meals')).toBe(true);
    expect(isSyncTable('photos')).toBe(false);
    expect(isSyncTable('syncOutbox')).toBe(false);
    expect(isSyncTable('somethingNew')).toBe(false);
    expect(Object.fromEntries(SYNC_TABLES.map((t) => [t, primaryKeyField(t)]))).toMatchObject({
      meals: 'id',
      profile: 'id',
      days: 'logicalDay',
      weekPlans: 'weekStart',
      insightFeedback: 'ruleId',
    });
  });
});

describe('toServerRow', () => {
  it("strips a meal's syncState and drops undefined fields", () => {
    const data = toServerRow('meals', { ...meal, placeId: undefined });
    expect(data).not.toHaveProperty('syncState');
    expect(data).not.toHaveProperty('placeId');
    expect(data).toMatchObject({ id: 'm1', name: 'Economy rice' });
  });

  it('strips the device-only profile fields and keeps the rest', () => {
    const data = toServerRow('profile', profile);
    for (const field of DEVICE_PROFILE_FIELDS) expect(data).not.toHaveProperty(field);
    expect(data).toMatchObject({ id: 'me', aiEstimates: 'auto', keepPhotos: true, rolloverHour: 5, timeZone: 'Asia/Kuala_Lumpur' });
  });

  it('leaves other tables whole', () => {
    expect(toServerRow('weights', { id: 'w1', kg: 78, syncState: 'x' })).toEqual({ id: 'w1', kg: 78, syncState: 'x' });
  });

  it('drops NUL characters, which Postgres jsonb refuses (one would fail the whole push)', () => {
    const data = toServerRow('meals', { ...meal, text: 'nasi\u0000 lemak', items: [{ name: '\u0000teh' }] });
    expect(data).toMatchObject({ text: 'nasi lemak', items: [{ name: 'teh' }] });
    expect(JSON.stringify(data)).not.toContain('\\u0000');
  });

  it('makes a lone surrogate U+FFFD, which Postgres refuses (one would fail the whole push), and keeps whole pairs', () => {
    const high = String.fromCharCode(0xd83c);
    const low = String.fromCharCode(0xdf5c);
    const noodles = high + low; // one emoji, a whole pair
    const data = toServerRow('meals', { ...meal, text: `mee ${high}`, name: `${low}Mee ${noodles}`, items: [{ name: `${high}${high}${noodles}` }] });
    const replacement = String.fromCharCode(0xfffd);
    expect(data).toMatchObject({ text: `mee ${replacement}`, name: `${replacement}Mee ${noodles}`, items: [{ name: `${replacement}${replacement}${noodles}` }] });
    expect(JSON.stringify(data)).not.toMatch(/\\ud[89a-f]/i);
    // The hash is of what is sent, so the row matches what the account then holds.
    expect(wireHash('meals', { ...meal, text: `mee ${high}` })).toBe(wireHash('meals', { ...meal, text: `mee ${replacement}` }));
    expect(wireHash('meals', { ...meal, text: `mee ${noodles}` })).not.toBe(wireHash('meals', { ...meal, text: `mee ${replacement}` }));
  });
});

describe('fromServerRow', () => {
  const defaults = { theme: 'light' as const };

  it("keeps this device's theme and location permission, and never sets demo mode", () => {
    const data = { ...toServerRow('profile', profile), demoMode: true, rolloverHour: 4 };
    const local = { ...profile, theme: 'system', useLocation: false };
    expect(fromServerRow('profile', 'me', data, local, defaults)).toEqual({
      ...toServerRow('profile', profile),
      rolloverHour: 4,
      theme: 'system',
      useLocation: false,
      demoMode: false,
    });
    const { demoMode: _flag, ...withoutFlag } = local;
    expect(fromServerRow('profile', 'me', data, withoutFlag, defaults)).not.toHaveProperty('demoMode');
  });

  it('uses the defaults on a fresh device', () => {
    const next = fromServerRow('profile', 'me', toServerRow('profile', profile), undefined, defaults);
    expect(next).toMatchObject({ id: 'me', theme: 'light', useLocation: false });
    expect(next).not.toHaveProperty('demoMode');
  });

  it("keeps a meal's local syncState, or marks it synced", () => {
    const data = toServerRow('meals', meal);
    expect(fromServerRow('meals', 'm1', data, { ...meal, syncState: 'pending' }, defaults)).toEqual({ ...meal, syncState: 'pending' });
    expect(fromServerRow('meals', 'm1', data, undefined, defaults)).toEqual({ ...meal, syncState: 'synced' });
  });

  it('gives null for data that is not a row of that table under that key', () => {
    expect(fromServerRow('meals', 'm2', toServerRow('meals', meal), undefined, defaults)).toBeNull();
    expect(fromServerRow('days', '2026-10-16', { id: '2026-10-16' }, undefined, defaults)).toBeNull();
    expect(fromServerRow('meals', 'm1', null, undefined, defaults)).toBeNull();
    expect(fromServerRow('meals', 'm1', ['m1'], undefined, defaults)).toBeNull();
    expect(fromServerRow('days', '2026-10-16', { logicalDay: '2026-10-16', status: 'open' }, undefined, defaults)).toEqual({
      logicalDay: '2026-10-16',
      status: 'open',
    });
  });

  it('round-trips with toServerRow, so an echo compares equal', () => {
    const back = fromServerRow('meals', 'm1', toServerRow('meals', meal), meal, defaults);
    expect(canonicalJson(back)).toBe(canonicalJson(meal));
    const me = fromServerRow('profile', 'me', toServerRow('profile', profile), profile, defaults);
    expect(wireHash('profile', me)).toBe(wireHash('profile', profile));
  });
});

describe('canonical hash', () => {
  it('is stable under key order and ignores undefined fields', () => {
    const a = { id: 'x', kg: 1, nested: { b: [1, { d: 2, c: 3 }], a: null } };
    const b = { nested: { a: null, b: [1, { c: 3, d: 2 }] }, kg: 1, extra: undefined, id: 'x' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"id":"x","kg":1,"nested":{"a":null,"b":[1,{"c":3,"d":2}]}}');
    expect(hashJson(a)).toBe(hashJson(b));
    expect(hashJson(a)).toMatch(/^[0-9a-z]+$/);
  });

  it('changes when any value changes', () => {
    expect(hashJson({ id: 'x', kg: 1 })).not.toBe(hashJson({ id: 'x', kg: 2 }));
    expect(hashJson({ id: 'x', items: [1, 2] })).not.toBe(hashJson({ id: 'x', items: [2, 1] }));
    expect(hashJson({ id: 'x', a: null })).not.toBe(hashJson({ id: 'x' }));
  });

  it("hashes a row as it would be sent, and 'deleted' for a missing row", () => {
    expect(wireHash('meals', meal)).toBe(hashJson(toServerRow('meals', meal)));
    expect(wireHash('meals', { ...meal, syncState: 'synced' })).toBe(wireHash('meals', meal));
    expect(wireHash('profile', { ...profile, theme: 'light' })).toBe(wireHash('profile', profile));
    expect(wireHash('meals', undefined)).toBe('deleted');
  });
});

describe('isRealChange', () => {
  const rev = (hash?: string) => ({ table: 'meals', key: 'm1', rev: 3, ...(hash ? { hash } : {}) });

  it.each([
    { name: 'the profile with a missing row', table: 'profile' as const, row: undefined, rev: { ...rev('abc'), table: 'profile' }, real: false },
    { name: 'a missing row that never synced', table: 'meals' as const, row: undefined, rev: undefined, real: false },
    { name: 'a missing row the account already has as deleted', table: 'meals' as const, row: undefined, rev: rev('deleted'), real: false },
    { name: 'a row whose synced fields are unchanged', table: 'meals' as const, row: { ...meal, syncState: 'synced' }, rev: rev(wireHash('meals', meal)), real: false },
    { name: 'a profile with only the theme changed', table: 'profile' as const, row: { ...profile, theme: 'light' }, rev: rev(wireHash('profile', profile)), real: false },
    { name: 'a missing row that synced', table: 'meals' as const, row: undefined, rev: rev(wireHash('meals', meal)), real: true },
    { name: 'a missing row whose revision has no hash', table: 'meals' as const, row: undefined, rev: rev(), real: true },
    { name: 'a new row', table: 'meals' as const, row: meal, rev: undefined, real: true },
    { name: 'an edited row', table: 'meals' as const, row: { ...meal, name: 'Nasi lemak' }, rev: rev(wireHash('meals', meal)), real: true },
    { name: 'a row whose revision has no hash', table: 'meals' as const, row: meal, rev: rev(), real: true },
  ])('$name: $real', ({ table, row, rev: known, real }) => {
    expect(isRealChange(table, row, known)).toBe(real);
  });
});
