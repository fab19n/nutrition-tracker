// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import { DEMO_IDS, loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { fmtHours } from '@/domain/insights';
import { getTimingDetailIn } from './timingDetail';

const TODAY = '2026-10-16';
const THURSDAY = '2026-10-15';
const at = { today: TODAY };

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`timing-${crypto.randomUUID()}`);
  await loadDemo(db);
  setDemoClock(true);
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

async function read(day = TODAY, today = TODAY) {
  const view = await getTimingDetailIn(db, day, { today });
  if (!view) throw new Error('no view');
  return view;
}

describe('the demo Friday (16 Oct, day 19)', () => {
  it('reads the day against your own times and the Cut rules', async () => {
    const view = await read();
    expect(view).toMatchObject({
      day: TODAY,
      today: TODAY,
      isToday: true,
      tz: 'Asia/Kuala_Lumpur',
      rolloverHour: 5,
      earliest: '2026-09-28',
      completeDays: 17,
      earlyRead: false,
      paused: false,
      rules: { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 },
    });
    expect(view.metrics).toMatchObject({
      mealCount: 2,
      first: { slot: 'breakfast' },
      last: { slot: 'lunch' },
      occasions: 2,
      firstOffsetMin: 70,
      usualFirstMin: 9 * 60 + 30,
      sleepTapped: false,
      mealsAfterSleep: 0,
      windowOk: true,
      occasionsOk: true,
    });
    expect(view.metrics.first?.at).toBe('2026-10-16T02:40:00.000Z'); // 10:40am
    expect(view.metrics.last?.at).toBe('2026-10-16T06:15:00.000Z'); // 2:15pm
    expect(fmtHours(view.metrics.windowHours ?? 0)).toBe('3.6 h');
    expect(view.metrics.beforeSleepHours).toBeUndefined();
    expect(view.summary.day).toBe(TODAY);
    expect(view.summary.window.closesAt).toBe('2026-10-16T14:40:00.000Z');
    expect(Object.values(view.summary.tags)).toContain('lateForYou');
  });

  it('has the usual Going to sleep time as minutes since the rollover, or null before any tap', async () => {
    expect((await read()).usualSleepLogicalMin).toBeNull();
    await createActions(db).setSleepTap('2026-10-14', '2026-10-14T17:00:00.000Z'); // 1:00am
    await createActions(db).setSleepTap('2026-10-13', '2026-10-13T16:30:00.000Z'); // 12:30am
    expect((await read()).usualSleepLogicalMin).toBe(19 * 60 + 45);
  });

  it('gives the week Monday to Sunday, today so far, with the average over finished days', async () => {
    const { week } = await read();
    expect(week.weekStart).toBe('2026-10-12');
    expect(week.rows.map((r) => r.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(week.rows.map((r) => r.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(week.rows[4]?.dots).toHaveLength(2);
    expect(week.rows.slice(5).every((r) => r.dots.length === 0)).toBe(true);
    // Mon-Thu: finished days only, so today's short window doesn't pull it down.
    const finished = week.rows.slice(0, 4).filter((r) => r.windowHours > 0).map((r) => r.windowHours);
    expect(finished.length).toBeGreaterThan(0);
    expect(week.averageWindowHours).toBeCloseTo(finished.reduce((a, b) => a + b, 0) / finished.length, 6);
  });
});

describe('a day with a Going to sleep tap (Thu 15 Oct)', () => {
  it('measures the last meal before the 1:30am tap', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T17:30:00.000Z');
    const view = await read(THURSDAY);
    expect(view.isToday).toBe(false);
    expect(view.metrics).toMatchObject({ mealCount: 3, occasions: 3, sleepTapped: true, mealsAfterSleep: 0, windowOk: true, sleepOk: true });
    expect(view.metrics.windowHours).toBeCloseTo(11.25, 6);
    expect(view.metrics.beforeSleepHours).toBeCloseTo(4.75, 6);
    expect(view.summary.record?.sleepAt).toBe('2026-10-15T17:30:00.000Z');
  });

  it('skips the sleep numbers on the same day without a tap', async () => {
    const view = await read(THURSDAY);
    expect(view.metrics.sleepTapped).toBe(false);
    expect(view.metrics.beforeSleepHours).toBeUndefined();
    expect(view.metrics.sleepOk).toBeUndefined();
  });

  it('flags a tap an hour after the last meal', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T13:45:00.000Z'); // 9:45pm
    const view = await read(THURSDAY);
    expect(view.metrics.beforeSleepHours).toBeCloseTo(1, 6);
    expect(view.metrics.sleepOk).toBe(false);
  });
});

describe('a Pause day', () => {
  beforeEach(async () => {
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-14' });
    await db.goalPeriods.put({ id: 'pause-period', goalId: DEMO_IDS.goals.pause, from: '2026-10-14', to: '2026-10-15' });
    await db.goalPeriods.put({ id: 'cut-again', goalId: DEMO_IDS.goals.cut, from: '2026-10-15' });
  });

  it('has timing off: no window to close, no tags', async () => {
    const view = await read('2026-10-14');
    expect(view.paused).toBe(true);
    expect(view.summary.tags).toEqual({});
    expect(view.summary.window.closesAt).toBeUndefined();
    expect(view.metrics.mealCount).toBe(view.summary.meals.length);
    expect(view.metrics.mealCount).toBeGreaterThan(0);
  });

  it('draws the paused day empty in the week grid, and the other days as they are', async () => {
    const { week } = await read('2026-10-14');
    expect(week.rows[2]).toMatchObject({ day: '2026-10-14', dots: [], windowLenPct: 0, windowHours: 0 });
    expect(week.rows[1]?.dots.length).toBeGreaterThan(0);
    expect(week.rows[3]?.dots.length).toBeGreaterThan(0);
    expect((await read(TODAY)).paused).toBe(false);
  });
});

describe('an early read', () => {
  it('is early under 14 complete days since the first day of use', async () => {
    // 7-15 Oct is 9 days, and the 11th is "not counted".
    await db.profile.update('me', { startedOn: '2026-10-07' });
    const view = await read();
    expect(view.completeDays).toBe(8);
    expect(view.earlyRead).toBe(true);
    expect(view.earliest).toBe('2026-10-07');
  });

  it('is not early at exactly 14', async () => {
    await db.profile.update('me', { startedOn: '2026-10-01' });
    expect(await read()).toMatchObject({ completeDays: 14, earlyRead: false });
    await db.profile.update('me', { startedOn: '2026-10-02' });
    expect(await read()).toMatchObject({ completeDays: 13, earlyRead: true });
  });

  it('counts only complete days before today', async () => {
    await db.days.update('2026-10-13', { status: 'unconfirmed' });
    await db.days.put({ logicalDay: TODAY, status: 'complete' });
    expect((await read()).completeDays).toBe(16);
  });
});

describe('edges', () => {
  it('reads an empty day', async () => {
    const view = await read('2026-10-17');
    expect(view.metrics).toEqual({ mealCount: 0, occasions: 0, sleepTapped: false, mealsAfterSleep: 0 });
    expect(view.summary.meals).toEqual([]);
  });

  it('leaves guess entries out of the numbers', async () => {
    const lunch = await db.meals.get(DEMO_IDS.meals.todayLunch);
    if (!lunch) throw new Error('missing demo lunch');
    await db.meals.put({ ...lunch, isGuess: true });
    const view = await read();
    expect(view.metrics.mealCount).toBe(1);
    expect(view.metrics.windowHours).toBeUndefined();
    expect(view.week.rows[4]?.dots).toHaveLength(1);
  });

  it('is undefined without a profile', async () => {
    await db.profile.clear();
    expect(await getTimingDetailIn(db, TODAY, at)).toBeUndefined();
  });

  it('never writes', async () => {
    const capturing = createDb(`timing-capture-${crypto.randomUUID()}`, { capture: () => true });
    try {
      await loadDemo(capturing);
      const dump = async () => {
        const out: Record<string, unknown[]> = {};
        for (const name of [...TABLE_NAMES, 'syncOutbox'] as const) out[name] = await capturing.table(name).toArray();
        return out;
      };
      const before = await dump();
      await getTimingDetailIn(capturing, TODAY, at);
      await getTimingDetailIn(capturing, THURSDAY, at);
      await getTimingDetailIn(capturing, '2026-09-28', { today: '2026-12-01' });
      expect(await dump()).toEqual(before);
    } finally {
      await capturing.delete();
    }
  });
});
