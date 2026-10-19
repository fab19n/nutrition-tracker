import { addDays } from './day';
import { adaptiveMaintenance, targetSuggestion } from './maintenance';
import type { DayStatusKind } from './types';

const END = '2026-10-15';

interface DayRow {
  day: string;
  eatenKcal: number;
  workoutKcal: number;
  status: DayStatusKind | null;
}

/** `count` days ending on `end`, newest last. */
function days(count: number, row: Partial<DayRow> = {}, end = END): DayRow[] {
  return Array.from({ length: count }, (_, i) => ({
    day: addDays(end, i - count + 1),
    eatenKcal: 1820,
    workoutKcal: 0,
    status: 'complete' as const,
    ...row,
  }));
}

/** A straight trend line losing `kgPerWeek` (negative = gaining), one point per day. */
function trend(kgPerWeek: number, count = 28, end = END): { day: string; trendKg: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    day: addDays(end, i - count + 1),
    trendKg: 80 - (kgPerWeek / 7) * i,
  }));
}

describe('adaptiveMaintenance', () => {
  it('logged ~1,820 a day and the trend dropped 0.25 kg a week → about 2,100', () => {
    const result = adaptiveMaintenance({ days: days(28), trend: trend(0.25) });
    expect(result).not.toBeNull();
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
    expect((result?.maintenanceKcal ?? 1) % 10).toBe(0);
    expect(result?.avgEatenKcal).toBe(1820);
    expect(result?.avgWorkoutKcal).toBe(0);
    expect(result?.trendKgPerWeek).toBeCloseTo(-0.25, 6);
    expect(result?.daysUsed).toBe(28);
  });

  it('works from exactly 21 complete days', () => {
    const result = adaptiveMaintenance({ days: days(21), trend: trend(0.25, 21) });
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
    expect(result?.daysUsed).toBe(21);
  });

  it('subtracts workout calories so they are not counted twice', () => {
    const result = adaptiveMaintenance({ days: days(28, { workoutKcal: 200 }), trend: trend(0.25) });
    expect(result?.avgWorkoutKcal).toBe(200);
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 1895)).toBeLessThanOrEqual(10);
  });

  it('uses complete days only', () => {
    const complete = days(21, {}, '2026-10-08');
    const others = [
      ...days(3, { eatenKcal: 3000, status: 'guess' }, '2026-10-11'),
      ...days(2, { eatenKcal: 900, status: 'unconfirmed' }, '2026-10-13'),
      { day: '2026-10-14', eatenKcal: 400, workoutKcal: 0, status: 'notCounted' as const },
      { day: '2026-10-15', eatenKcal: 2500, workoutKcal: 0, status: null },
    ];
    const result = adaptiveMaintenance({ days: [...complete, ...others], trend: trend(0.25) });
    expect(result?.daysUsed).toBe(21);
    expect(result?.avgEatenKcal).toBe(1820);
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
  });

  it('is null with fewer than 21 complete days', () => {
    const mixed = [...days(20), ...days(8, { status: 'notCounted' }, '2026-10-23')];
    expect(adaptiveMaintenance({ days: days(20), trend: trend(0.25) })).toBeNull();
    expect(adaptiveMaintenance({ days: mixed, trend: trend(0.25, 36, '2026-10-23') })).toBeNull();
    expect(adaptiveMaintenance({ days: [], trend: trend(0.25) })).toBeNull();
  });

  it('accepts a lower minimum', () => {
    expect(adaptiveMaintenance({ days: days(14), trend: trend(0.25, 14), minCompleteDays: 14 })).not.toBeNull();
  });

  it('only looks at the last 28 days', () => {
    const old = days(20, { eatenKcal: 2600 }, '2026-09-10');
    const recent = days(21);
    const result = adaptiveMaintenance({ days: [...old, ...recent], trend: trend(0.25, 60) });
    expect(result?.daysUsed).toBe(21);
    expect(result?.avgEatenKcal).toBe(1820);
  });

  it('is null without a usable trend', () => {
    expect(adaptiveMaintenance({ days: days(28), trend: [] })).toBeNull();
    expect(adaptiveMaintenance({ days: days(28), trend: trend(0.25, 3) })).toBeNull();
  });

  it('goes below intake when the trend is rising', () => {
    const result = adaptiveMaintenance({ days: days(28), trend: trend(-0.25) });
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 1545)).toBeLessThanOrEqual(10);
    expect(result?.trendKgPerWeek).toBeCloseTo(0.25, 6);
  });
});

describe('targetSuggestion', () => {
  const cut = { template: 'cut' as const, paceKgPerWeek: 0.5 };
  const current = { maintenanceKcal: 2350, dailyKcal: 1800 };

  it('suggests a new target with a slower-pace alternative (S37)', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2100 }, cut, 1400)).toEqual({
      suggestedDailyKcal: 1550,
      newMaintenanceKcal: 2100,
      altSlowerPace: { paceKgPerWeek: 0.25, dailyKcal: 1825 },
    });
  });

  it('is null when maintenance moved by 100 kcal or less', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2260 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2250 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2450 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2249 }, cut, 1400)).not.toBeNull();
  });

  it('offers no slower pace when the target goes up', () => {
    const up = targetSuggestion(current, { maintenanceKcal: 2500 }, cut, 1400);
    expect(up).toEqual({ suggestedDailyKcal: 1950, newMaintenanceKcal: 2500 });
  });

  it('offers no slower pace at the slowest pace or for other goals', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2100 }, { template: 'cut', paceKgPerWeek: 0.25 }, 1400)?.altSlowerPace).toBeUndefined();
    expect(
      targetSuggestion({ maintenanceKcal: 2350, dailyKcal: 2350 }, { maintenanceKcal: 2100 }, { template: 'festive', paceKgPerWeek: 0 }, 1400),
    ).toEqual({ suggestedDailyKcal: 2100, newMaintenanceKcal: 2100 });
  });

  it('steps down from 0.75 to 0.5', () => {
    const fast = targetSuggestion({ maintenanceKcal: 2350, dailyKcal: 1525 }, { maintenanceKcal: 2200 }, { template: 'cut', paceKgPerWeek: 0.75 }, 1300);
    expect(fast?.suggestedDailyKcal).toBe(1375);
    expect(fast?.altSlowerPace).toEqual({ paceKgPerWeek: 0.5, dailyKcal: 1650 });
  });

  it('never suggests below the daily minimum', () => {
    const low = targetSuggestion(current, { maintenanceKcal: 1800 }, { template: 'cut', paceKgPerWeek: 0.75 }, 1400);
    expect(low?.suggestedDailyKcal).toBe(1400);
    expect(low?.altSlowerPace?.dailyKcal).toBe(1400);
  });
});
