import { addDays, instantAt } from './day';
import { fmtKgDelta } from './format';
import { TREND_ALPHA, dailyWeights, emaTrend, trendChange, trendOn, weekTrendChange, weightTrend } from './trend';
import type { WeightLog } from './types';

/** The design's 14 readings, 3–16 Oct 2026 (design_handoff §9.5). */
const SAMPLE = [78.6, 78.3, 78.5, 78.1, 78.2, 78.0, 79.0, 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8];

function log(day: string, kg: number, hour = 8, minute = 5): WeightLog {
  return { id: `${day}-${hour}${minute}`, logicalDay: day, measuredAt: instantAt(day, hour, minute), kg };
}

const sampleLogs = SAMPLE.map((kg, i) => log(addDays('2026-10-03', i), kg));

describe('emaTrend', () => {
  it('is a plain EMA with α = 0.25 by default', () => {
    expect(TREND_ALPHA).toBe(0.25);
    expect(emaTrend([80, 78])).toEqual([80, 79.5]);
    expect(emaTrend([80, 78], 0.5)).toEqual([80, 79]);
  });

  it('matches the prototype chart on the design sample (77.99 kg)', () => {
    const trend = emaTrend(SAMPLE);
    expect(trend).toHaveLength(14);
    expect(trend[0]).toBe(78.6);
    expect(trend.at(-1)).toBeCloseTo(77.99, 2);
  });

  it('smooths out a single water-weight jump', () => {
    const trend = emaTrend(SAMPLE);
    // 79.0 reading on day 7 moves the trend far less than the reading moved
    expect((trend[6] ?? 0) - (trend[5] ?? 0)).toBeLessThan(0.3);
  });

  it('keeps a constant series constant and handles empty input', () => {
    expect(emaTrend([78, 78, 78])).toEqual([78, 78, 78]);
    expect(emaTrend([])).toEqual([]);
  });

  it('never undershoots a plateau after a steady loss', () => {
    const losing = Array.from({ length: 30 }, (_, i) => 80 - 0.1 * i);
    const flat = Array.from({ length: 10 }, () => 77.1);
    for (const value of emaTrend([...losing, ...flat]).slice(-10)) expect(value).toBeGreaterThanOrEqual(77.1);
  });
});

describe('dailyWeights', () => {
  it('keeps the last reading of each day, sorted by day', () => {
    const logs = [log('2026-10-16', 77.8, 8, 5), log('2026-10-15', 78.0), log('2026-10-16', 78.4, 7, 0)];
    expect(dailyWeights(logs)).toEqual([
      { day: '2026-10-15', kg: 78.0 },
      { day: '2026-10-16', kg: 77.8 },
    ]);
    expect(dailyWeights([...logs].reverse())).toEqual(dailyWeights(logs));
  });

  it('skips impossible readings', () => {
    expect(dailyWeights([log('2026-10-16', 0), log('2026-10-15', Number.NaN), log('2026-10-14', 78)])).toEqual([
      { day: '2026-10-14', kg: 78 },
    ]);
  });
});

describe('weightTrend', () => {
  it('matches emaTrend for daily readings', () => {
    const points = weightTrend(sampleLogs);
    expect(points).toHaveLength(14);
    expect(points[0]).toEqual({ day: '2026-10-03', kg: 78.6, trendKg: 78.6 });
    const last = points.at(-1);
    expect(last?.day).toBe('2026-10-16');
    expect(last?.kg).toBe(77.8);
    expect(last?.trendKg).toBeCloseTo(emaTrend(SAMPLE).at(-1) ?? 0, 10);
  });

  it('gives a reading after a long gap more weight', () => {
    const points = weightTrend([log('2026-10-01', 80), log('2026-10-11', 79)]);
    const afterGap = points[1]?.trendKg ?? 0;
    expect(afterGap).toBeGreaterThan(79);
    expect(afterGap).toBeLessThan(79.2);
    const consecutive = weightTrend([log('2026-10-01', 80), log('2026-10-02', 79)]);
    expect(consecutive[1]?.trendKg).toBeCloseTo(79.75, 6);
  });

  it('returns nothing without readings', () => {
    expect(weightTrend([])).toEqual([]);
  });
});

describe('trendChange', () => {
  const linear = Array.from({ length: 15 }, (_, i) => ({ day: addDays('2026-10-02', i), trendKg: 79 - 0.05 * i }));

  it('is the trend now minus the trend that many days ago', () => {
    expect(trendChange(linear, 7)).toBeCloseTo(-0.35, 10);
    expect(trendChange(linear, 14)).toBeCloseTo(-0.7, 10);
  });

  it('uses the last point on or before the earlier day', () => {
    const sparse = [
      { day: '2026-10-01', trendKg: 79 },
      { day: '2026-10-08', trendKg: 78.6 },
      { day: '2026-10-16', trendKg: 78.2 },
    ];
    expect(trendChange(sparse, 7)).toBeCloseTo(-0.4, 10); // 9 Oct → uses 8 Oct
    expect(trendChange([...sparse].reverse(), 7)).toBeCloseTo(-0.4, 10);
  });

  it('is null without enough history', () => {
    expect(trendChange(linear, 30)).toBeNull();
    expect(trendChange([], 7)).toBeNull();
  });

  it('gives about −0.5 kg over the design sample’s last 7 days and −0.6 kg over its 13-day span', () => {
    const points = weightTrend(sampleLogs);
    expect(trendChange(points, 7)).toBeCloseTo(-0.46, 2);
    // 14 daily readings span 13 days, so "14 days ago" has no reading yet.
    expect(trendChange(points, 14)).toBeNull();
    expect(trendChange(points, 13)).toBeCloseTo(-0.61, 2);
  });
});

describe('trendOn', () => {
  it('finds the last point on or before a day', () => {
    const points = [
      { day: '2026-10-08', trendKg: 78.6 },
      { day: '2026-10-01', trendKg: 79 },
    ];
    expect(trendOn(points, '2026-10-07')?.trendKg).toBe(79);
    expect(trendOn(points, '2026-10-08')?.trendKg).toBe(78.6);
    expect(trendOn(points, '2026-09-30')).toBeUndefined();
  });
});

describe('weekTrendChange', () => {
  it('measures the current week from last Sunday’s trend: the design’s “This week −0.4 kg”', () => {
    const change = weekTrendChange(weightTrend(sampleLogs), '2026-10-12');
    expect(change).toBeCloseTo(-0.43, 2);
    expect(fmtKgDelta(change ?? 0)).toBe('−0.4 kg');
  });

  it('measures a finished week from Sunday to Sunday', () => {
    expect(weekTrendChange(weightTrend(sampleLogs), '2026-10-05')).toBeCloseTo(-0.11, 2);
  });

  it('is null without a reading before the week, or none since it started', () => {
    expect(weekTrendChange(weightTrend(sampleLogs), '2026-09-28')).toBeNull();
    expect(weekTrendChange(weightTrend(sampleLogs), '2026-10-19')).toBeNull();
    expect(weekTrendChange([], '2026-10-12')).toBeNull();
  });
});
