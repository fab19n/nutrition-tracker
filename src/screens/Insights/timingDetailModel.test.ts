// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { loadDemo } from '@/db/seed/demo';
import { getTimingDetailIn, type TimingDetailView } from '@/db/timingDetail';
import { setDemoClock } from '@/domain/clock';
import { timelineFor } from '@/screens/Diary/diaryModel';
import {
  NO_MEALS_NOTE,
  PAUSED_NOTE,
  earlyNote,
  fmtDuration,
  legendItems,
  mealRows,
  metricRows,
  numbersHeading,
  sleepExplainer,
  timingDayPath,
  weekHeading,
  weekLabels,
} from './timingDetailModel';

const TODAY = '2026-10-16';
const THURSDAY = '2026-10-15';
/** Fri 16 Oct, 7:10pm. */
const NOW = new Date('2026-10-16T11:10:00.000Z');

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`timing-model-${crypto.randomUUID()}`);
  await loadDemo(db);
  setDemoClock(true);
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

async function read(day = TODAY): Promise<TimingDetailView> {
  const view = await getTimingDetailIn(db, day, { today: TODAY });
  if (!view) throw new Error('no view');
  return view;
}

function timelineOf(view: TimingDetailView) {
  return timelineFor({
    day: view.day,
    isToday: view.isToday,
    meals: view.summary.meals,
    tags: view.summary.tags,
    window: view.summary.window,
    now: NOW,
    tz: view.tz,
    rolloverHour: view.rolloverHour,
    ...(view.summary.record?.sleepAt ? { sleepAt: view.summary.record.sleepAt } : {}),
    expanded: true,
  });
}

describe('timingDayPath and fmtDuration', () => {
  it('needs no param for today', () => {
    expect(timingDayPath(TODAY, TODAY)).toBe('/insights/timing');
    expect(timingDayPath(THURSDAY, TODAY)).toBe('/insights/timing?day=2026-10-15');
  });

  it('writes minutes the short way', () => {
    expect(fmtDuration(45)).toBe('45 min');
    expect(fmtDuration(120)).toBe('2 h');
    expect(fmtDuration(70)).toBe('1 h 10 min');
    expect(fmtDuration(69.6)).toBe('1 h 10 min');
    expect(fmtDuration(0)).toBe('0 min');
  });
});

describe('notes and headings', () => {
  it('words the early read, singular and plural', () => {
    expect(earlyNote(9)).toEqual({ lead: 'Early read.', rest: 'Based on 9 complete days. Your usual times firm up by day 14.' });
    expect(earlyNote(1).rest).toBe('Based on 1 complete day. Your usual times firm up by day 14.');
  });

  it('has the paused and empty-day copy', () => {
    expect(PAUSED_NOTE).toEqual({ lead: 'Paused.', rest: 'Timing is off while your goal is paused. This day stays out of timing insights.' });
    expect(NO_MEALS_NOTE).toBe('No meals logged this day.');
    expect(numbersHeading(true)).toBe('Today so far');
    expect(numbersHeading(false)).toBe('The day in numbers');
  });

  it('names the week', () => {
    expect(weekHeading('2026-10-12', TODAY)).toBe('This week');
    expect(weekHeading('2026-10-05', TODAY)).toBe('5–11 Oct');
    expect(weekHeading('2026-09-28', TODAY)).toBe('28 Sep–4 Oct');
  });
});

describe('metricRows on the demo Friday (today so far)', () => {
  it('reads the day against your usual time and the Cut rules', async () => {
    const rows = metricRows(await read());
    expect(rows.map((r) => r.key)).toEqual(['first', 'last', 'window', 'occasions', 'sleep']);
    expect(rows[0]).toEqual({ key: 'first', label: 'First meal', value: '10:40am', sub: 'Breakfast · 1 h 10 min later than your usual 9:30am' });
    expect(rows[1]).toEqual({ key: 'last', label: 'Last meal', value: '2:15pm', sub: 'Lunch' });
    expect(rows[2]).toEqual({
      key: 'window',
      label: 'Eating window',
      value: '3.6 h',
      sub: 'First bite to last bite so far',
      status: { tone: 'ok', text: 'Within your 12 h limit' },
    });
    expect(rows[3]).toEqual({
      key: 'occasions',
      label: 'Eating occasions',
      value: '2',
      sub: 'Meals within 30 min count as one so far',
      status: { tone: 'ok', text: 'Within your limit of 5' },
    });
    expect(rows[4]).toEqual({ key: 'sleep', label: 'Last meal before sleep', value: '—', sub: 'Waiting for a Going to sleep tap' });
  });
});

describe('metricRows on a finished day with a Going to sleep tap (Thu 15 Oct)', () => {
  it('measures the last meal before a 1:30am tap against the 2 h rule', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T17:30:00.000Z');
    const rows = metricRows(await read(THURSDAY));
    expect(rows.find((r) => r.key === 'window')).toMatchObject({
      value: '11.3 h',
      sub: 'First bite to last bite',
      status: { tone: 'ok', text: 'Within your 12 h limit' },
    });
    expect(rows.find((r) => r.key === 'occasions')).toMatchObject({ value: '3', sub: 'Meals within 30 min count as one' });
    expect(rows.find((r) => r.key === 'sleep')).toEqual({
      key: 'sleep',
      label: 'Last meal before sleep',
      value: '4.8 h',
      sub: 'You tapped Going to sleep at 1:30am',
      status: { tone: 'ok', text: 'Meets your rule of 2 h or more' },
    });
  });

  it('is fine with a tap 2.25 h after dinner, and flags a tap an hour after', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T15:00:00.000Z'); // 11:00pm, dinner 8:45pm
    expect(metricRows(await read(THURSDAY)).find((r) => r.key === 'sleep')).toMatchObject({
      value: '2.3 h',
      status: { tone: 'ok', text: 'Meets your rule of 2 h or more' },
    });
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T13:45:00.000Z'); // 9:45pm
    expect(metricRows(await read(THURSDAY)).find((r) => r.key === 'sleep')).toMatchObject({
      value: '1.0 h',
      status: { tone: 'over', text: 'Less than your 2 h rule' },
    });
  });

  it('skips the row with a word when there was no tap, and judges nothing', async () => {
    const sleep = metricRows(await read(THURSDAY)).find((r) => r.key === 'sleep');
    expect(sleep).toEqual({ key: 'sleep', label: 'Last meal before sleep', value: '—', sub: 'Skipped: no Going to sleep tap this day' });
  });

  it('leaves meals after the tap out, and says so', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T13:00:00.000Z'); // 9:00pm: dinner at 8:45pm is before, none after
    let view = await read(THURSDAY);
    expect(metricRows(view).find((r) => r.key === 'sleep')?.sub).toBe('You tapped Going to sleep at 9:00pm');
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T11:00:00.000Z'); // 7:00pm: dinner is after the tap
    view = await read(THURSDAY);
    expect(metricRows(view).find((r) => r.key === 'sleep')).toMatchObject({
      value: expect.any(String),
      sub: 'You tapped Going to sleep at 7:00pm · 1 meal after the tap left out',
    });
  });

  it('says there was no meal before a tap that came first', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T00:00:00.000Z'); // 8:00am, before breakfast
    const row = metricRows(await read(THURSDAY)).find((r) => r.key === 'sleep');
    expect(row).toEqual({
      key: 'sleep',
      label: 'Last meal before sleep',
      value: '—',
      sub: 'You tapped Going to sleep at 8:00am · No meal before the tap',
    });
  });
});

describe('metricRows edge cases', () => {
  it('says "about your usual" under 15 minutes, and "earlier" when before it', async () => {
    const view = await read();
    const about = metricRows({ ...view, metrics: { ...view.metrics, firstOffsetMin: 14 } })[0];
    expect(about?.sub).toBe('Breakfast · about your usual 9:30am');
    const earlier = metricRows({ ...view, metrics: { ...view.metrics, firstOffsetMin: -40 } })[0];
    expect(earlier?.sub).toBe('Breakfast · 40 min earlier than your usual 9:30am');
    const later = metricRows({ ...view, metrics: { ...view.metrics, firstOffsetMin: 15 } })[0];
    expect(later?.sub).toBe('Breakfast · 15 min later than your usual 9:30am');
  });

  it('waits for 5 days of that slot before comparing', async () => {
    const view = await read();
    const { firstOffsetMin: _offset, usualFirstMin: _usual, ...metrics } = view.metrics;
    expect(metricRows({ ...view, metrics })[0]?.sub).toBe('Breakfast · usual time shows after 5 days');
  });

  it('needs two meals for a window', async () => {
    const view = await read();
    const { windowHours: _hours, windowOk: _ok, ...metrics } = view.metrics;
    const window = metricRows({ ...view, metrics: { ...metrics, mealCount: 1, occasions: 1 } }).find((r) => r.key === 'window');
    expect(window).toEqual({ key: 'window', label: 'Eating window', value: '—', sub: 'Needs two meals' });
  });

  it('says Over when a limit is passed, in words as well as tone', async () => {
    const view = await read();
    const rows = metricRows({
      ...view,
      metrics: { ...view.metrics, windowHours: 13.5, windowOk: false, occasions: 6, occasionsOk: false },
    });
    expect(rows.find((r) => r.key === 'window')).toMatchObject({ value: '13.5 h', status: { tone: 'over', text: 'Over your 12 h limit' } });
    expect(rows.find((r) => r.key === 'occasions')).toMatchObject({ value: '6', status: { tone: 'over', text: 'More than your limit of 5' } });
  });

  it('shows a fixed window as information, not a verdict', async () => {
    const view = await read();
    const rows = metricRows({
      ...view,
      rules: { fixedWindow: { startMin: 10 * 60, endMin: 20 * 60 } },
      metrics: { ...view.metrics, windowOk: undefined },
    });
    expect(rows.find((r) => r.key === 'window')?.status).toEqual({ tone: 'info', text: 'Your window 10am–8pm' });
  });

  it('leaves out rule lines when the goal has no such rule, and the sleep row without a rule or a tap', async () => {
    const view = await read();
    const { windowOk: _w, occasionsOk: _o, ...metrics } = view.metrics;
    const rows = metricRows({ ...view, rules: {}, metrics });
    expect(rows.map((r) => r.key)).toEqual(['first', 'last', 'window', 'occasions']);
    expect(rows.every((r) => r.status === undefined)).toBe(true);
    // Numbers still show.
    expect(rows.find((r) => r.key === 'window')?.value).toBe('3.6 h');
  });

  it('shows the sleep row for a tap even without a rule, with no verdict', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T17:30:00.000Z');
    const view = await read(THURSDAY);
    const { sleepOk: _s, ...metrics } = view.metrics;
    const sleep = metricRows({ ...view, rules: { maxWindowHours: 12 }, metrics }).find((r) => r.key === 'sleep');
    expect(sleep).toMatchObject({ value: '4.8 h', sub: 'You tapped Going to sleep at 1:30am' });
    expect(sleep?.status).toBeUndefined();
  });

  it('has no rows on an empty day or a paused day', async () => {
    expect(metricRows(await read('2026-10-17'))).toEqual([]);
    const view = await read();
    expect(metricRows({ ...view, paused: true })).toEqual([]);
  });

  it('writes a decimal limit as it is', async () => {
    const view = await read();
    const rows = metricRows({ ...view, rules: { ...view.rules, maxWindowHours: 10.5 }, metrics: { ...view.metrics, windowOk: true } });
    expect(rows.find((r) => r.key === 'window')?.status?.text).toBe('Within your 10.5 h limit');
  });
});

describe('legendItems', () => {
  it('lists only the marks on the strip', async () => {
    const view = await read();
    const items = legendItems(view, timelineOf(view));
    expect(items.map((i) => i.label)).toEqual(['On time', 'Late for you', 'Eating window']);
  });

  it('adds Going to sleep once tapped', async () => {
    await createActions(db).setSleepTap(THURSDAY, '2026-10-15T17:30:00.000Z');
    const view = await read(THURSDAY);
    expect(legendItems(view, timelineOf(view)).at(-1)).toEqual({ key: 'sleep', label: 'Going to sleep' });
  });

  it('has no legend on an empty day', async () => {
    const view = await read('2026-10-17');
    expect(legendItems(view, timelineOf(view))).toEqual([]);
  });

  it('shows just Meal on a paused day (no window, no tags)', async () => {
    const view = await read();
    const timeline = timelineOf({ ...view, summary: { ...view.summary, tags: {}, window: { lengthHours: 0, occasions: 0 } } });
    expect(legendItems({ paused: true }, timeline)).toEqual([{ key: 'meal', label: 'Meal' }]);
  });
});

describe('mealRows and weekLabels', () => {
  it('lists the real meals with their timing tags', async () => {
    const view = await read();
    const rows = mealRows(view);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ time: '10:40am', slot: 'Breakfast', tag: 'lateForYou' });
    expect(rows[1]).toMatchObject({ time: '2:15pm', slot: 'Lunch' });
  });

  it('leaves guess entries out', async () => {
    const view = await read();
    const [first, second] = view.summary.meals;
    if (!first || !second) throw new Error('demo meals');
    const guessed = { ...view, summary: { ...view.summary, meals: [first, { ...second, isGuess: true }] } };
    expect(mealRows(guessed)).toHaveLength(1);
  });

  it('has no tags on a paused day', async () => {
    const view = await read();
    expect(mealRows({ ...view, paused: true }).every((m) => m.tag === undefined)).toBe(true);
  });

  it('labels the week grid', async () => {
    const view = await read();
    const labels = weekLabels(view);
    expect(labels.heading).toBe('This week');
    expect(labels.headerLeft).toMatch(/^Average window \d+\.\d h$/);
    expect(labels.headerRight).toBe('This week');
    expect(labels.axisLabels).toEqual(['5am', 'noon', '6pm', 'midnight']);
    expect(labels.ariaLabel).toMatch(/^Average window \d+\.\d h\. This week\. Late meals on \d+ days?\.$/);
  });

  it('says early read on the grid header, and an empty average', async () => {
    const view = await read();
    const labels = weekLabels({ ...view, earlyRead: true, completeDays: 9, week: { ...view.week, averageWindowHours: null } });
    expect(labels.headerLeft).toBe('Average window —');
    expect(labels.headerRight).toBe('Early read · 9 days');
  });
});

describe('sleepExplainer', () => {
  it('names the usual time when the app knows it, and the rule when the goal has one', () => {
    // Usual sleep 1:30am is 1,230 minutes after the 5am rollover.
    const paragraphs = sleepExplainer({ rules: { minHoursBeforeSleep: 2 }, usualSleepLogicalMin: 1230, rolloverHour: 5 });
    expect(paragraphs).toEqual([
      "On Today, a Going to sleep button shows up in the evening. It shows up from about an hour before your usual sleep time, around 12:30am. Tap it when you head to bed. It's optional, and the app works without it.",
      "With a tap, the app checks your last meal against your goal's rule: 2 h or more before sleep.",
      'Without a tap, that check is skipped for the day. A missing tap is never read as a late meal.',
      'Tapped it by mistake? Use Undo on Today.',
    ]);
  });

  it('falls back to 10pm until it learns, and to a plain line without a rule', () => {
    const paragraphs = sleepExplainer({ rules: {}, usualSleepLogicalMin: null, rolloverHour: 5 });
    expect(paragraphs[0]).toBe(
      "On Today, a Going to sleep button shows up in the evening. It shows up from 10pm until the app learns your usual sleep time. Tap it when you head to bed. It's optional, and the app works without it.",
    );
    expect(paragraphs[1]).toBe('With a tap, the app can show how long before sleep your last meal was.');
  });
});
