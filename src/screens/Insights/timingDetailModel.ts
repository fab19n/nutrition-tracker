/**
 * Pure helpers that turn the timing detail view (src/db/timingDetail) into what S35 shows: the
 * day's numbers against the goal's own rules, the legend, the week's labels and the Going to
 * sleep explainer. All of S35's copy lives here. Nothing here judges a missing sleep tap: it is
 * skipped, never read as a late meal.
 */
import { PATHS } from '@/app/paths';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import type { TimingDetailView } from '@/db/timingDetail';
import { addDays, logicalToWallMinutes, weekStartOf } from '@/domain/day';
import { fmtClock, fmtDayRange, fmtInt, fmtTime } from '@/domain/format';
import { fmtHours } from '@/domain/insights';
import { MIN_BASELINE_SAMPLES, type TimingTagKind } from '@/domain/timing';
import type { LogicalDay } from '@/domain/types';
import { DEFAULT_SLEEP_FROM_WALL_MIN, SLEEP_LEAD_MIN } from '@/screens/Today/todayModel';
import type { TimelineModel } from '@/screens/Diary/diaryModel';

/** Under this many minutes from your usual time reads as "about" it. */
const ABOUT_USUAL_MIN = 15;

/** Link to S35: today needs no param. */
export function timingDayPath(day: LogicalDay, today: LogicalDay): string {
  return day === today ? PATHS.timing : `${PATHS.timing}?day=${day}`;
}

/** 45 → "45 min", 120 → "2 h", 70 → "1 h 10 min". */
export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${fmtInt(m)} min`;
  return m === 0 ? `${fmtInt(h)} h` : `${fmtInt(h)} h ${fmtInt(m)} min`;
}

/** A rule's hours as a limit reads: 12 → "12 h", 10.5 → "10.5 h". */
function limitHours(hours: number): string {
  return `${Number.isInteger(hours) ? fmtInt(hours) : String(Math.round(hours * 10) / 10)} h`;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** The early-read banner: bold lead, then the rest. */
export function earlyNote(completeDays: number): { lead: string; rest: string } {
  return {
    lead: 'Early read.',
    rest: `Based on ${plural(completeDays, 'complete day')}. Your usual times firm up by day 14.`,
  };
}

/** The banner on a day the goal paused. */
export const PAUSED_NOTE = { lead: 'Paused.', rest: 'Timing is off while your goal is paused. This day stays out of timing insights.' } as const;

export const NO_MEALS_NOTE = 'No meals logged this day.';

// ---------------------------------------------------------------------------
// The day's numbers
// ---------------------------------------------------------------------------

export interface MetricStatus {
  /** ok: within your rule (check icon) · over: past it (amber alert) · info: no judgement. */
  tone: 'ok' | 'over' | 'info';
  text: string;
}

export interface MetricRow {
  key: 'first' | 'last' | 'window' | 'occasions' | 'sleep';
  label: string;
  value: string;
  sub?: string;
  status?: MetricStatus;
}

function firstMealSub(view: TimingDetailView): string {
  const { metrics } = view;
  const slot = metrics.first ? SLOT_LABEL[metrics.first.slot] : '';
  const { firstOffsetMin: offset, usualFirstMin: usual } = metrics;
  if (offset === undefined || usual === undefined) return `${slot} · usual time shows after ${MIN_BASELINE_SAMPLES} days`;
  const usualText = fmtClock(usual);
  if (Math.abs(offset) < ABOUT_USUAL_MIN) return `${slot} · about your usual ${usualText}`;
  return `${slot} · ${fmtDuration(Math.abs(offset))} ${offset > 0 ? 'later' : 'earlier'} than your usual ${usualText}`;
}

function windowRow(view: TimingDetailView): MetricRow {
  const { metrics, rules, isToday } = view;
  const row: MetricRow = {
    key: 'window',
    label: 'Eating window',
    value: metrics.windowHours === undefined ? '—' : fmtHours(metrics.windowHours),
    sub: metrics.windowHours === undefined ? 'Needs two meals' : `First bite to last bite${isToday ? ' so far' : ''}`,
  };
  if (rules.fixedWindow) {
    const { startMin, endMin } = rules.fixedWindow;
    row.status = { tone: 'info', text: `Your window ${fmtClock(startMin, { compact: true })}–${fmtClock(endMin, { compact: true })}` };
  } else if (rules.maxWindowHours !== undefined && metrics.windowOk !== undefined) {
    const limit = limitHours(rules.maxWindowHours);
    row.status = metrics.windowOk ? { tone: 'ok', text: `Within your ${limit} limit` } : { tone: 'over', text: `Over your ${limit} limit` };
  }
  return row;
}

function occasionsRow(view: TimingDetailView): MetricRow {
  const { metrics, rules, isToday } = view;
  const row: MetricRow = {
    key: 'occasions',
    label: 'Eating occasions',
    value: fmtInt(metrics.occasions),
    sub: `Meals within 30 min count as one${isToday ? ' so far' : ''}`,
  };
  if (rules.maxEatingOccasions !== undefined && metrics.occasionsOk !== undefined) {
    row.status =
      metrics.occasionsOk
        ? { tone: 'ok', text: `Within your limit of ${fmtInt(rules.maxEatingOccasions)}` }
        : { tone: 'over', text: `More than your limit of ${fmtInt(rules.maxEatingOccasions)}` };
  }
  return row;
}

function sleepRow(view: TimingDetailView): MetricRow | undefined {
  const { metrics, rules, summary, isToday, tz } = view;
  const sleepAt = summary.record?.sleepAt;
  if (rules.minHoursBeforeSleep === undefined && !metrics.sleepTapped) return undefined;
  const row: MetricRow = { key: 'sleep', label: 'Last meal before sleep', value: '—' };

  if (!metrics.sleepTapped || !sleepAt) {
    row.sub = isToday ? 'Waiting for a Going to sleep tap' : 'Skipped: no Going to sleep tap this day';
    return row;
  }
  const tapped = `You tapped Going to sleep at ${fmtTime(sleepAt, tz)}`;
  if (metrics.beforeSleepHours === undefined) {
    row.sub = `${tapped} · No meal before the tap`;
    return row;
  }
  row.value = fmtHours(metrics.beforeSleepHours);
  row.sub = metrics.mealsAfterSleep > 0 ? `${tapped} · ${plural(metrics.mealsAfterSleep, 'meal')} after the tap left out` : tapped;
  if (rules.minHoursBeforeSleep !== undefined && metrics.sleepOk !== undefined) {
    const rule = limitHours(rules.minHoursBeforeSleep);
    row.status = metrics.sleepOk ? { tone: 'ok', text: `Meets your rule of ${rule} or more` } : { tone: 'over', text: `Less than your ${rule} rule` };
  }
  return row;
}

/** The numbers card, top to bottom. Empty on a paused day (timing is off) and on a day with no real meals. */
export function metricRows(view: TimingDetailView): MetricRow[] {
  const { metrics, tz } = view;
  if (view.paused || metrics.mealCount === 0 || !metrics.first || !metrics.last) return [];
  const rows: MetricRow[] = [
    { key: 'first', label: 'First meal', value: fmtTime(metrics.first.at, tz), sub: firstMealSub(view) },
    { key: 'last', label: 'Last meal', value: fmtTime(metrics.last.at, tz), sub: SLOT_LABEL[metrics.last.slot] },
    windowRow(view),
    occasionsRow(view),
  ];
  const sleep = sleepRow(view);
  if (sleep) rows.push(sleep);
  return rows;
}

/** "Today so far" or "The day in numbers". */
export function numbersHeading(isToday: boolean): string {
  return isToday ? 'Today so far' : 'The day in numbers';
}

// ---------------------------------------------------------------------------
// Timeline legend
// ---------------------------------------------------------------------------

export interface LegendItem {
  key: 'meal' | 'onTime' | 'late' | 'window' | 'sleep';
  label: string;
}

/** What the strip's marks mean, only for the marks it shows. A paused day has just meals. */
export function legendItems(view: Pick<TimingDetailView, 'paused'>, timeline: Pick<TimelineModel, 'dots' | 'windowStartPct' | 'sleep'>): LegendItem[] {
  if (view.paused) {
    // No window band and no tags: the dots are just meals.
    const paused: LegendItem[] = timeline.dots.length > 0 ? [{ key: 'meal', label: 'Meal' }] : [];
    if (timeline.sleep) paused.push({ key: 'sleep', label: 'Going to sleep' });
    return paused;
  }
  const items: LegendItem[] = [];
  if (timeline.dots.some((d) => d.tone === 'onTime')) items.push({ key: 'onTime', label: 'On time' });
  if (timeline.dots.some((d) => d.tone === 'late')) items.push({ key: 'late', label: 'Late for you' });
  if (timeline.windowStartPct !== undefined) items.push({ key: 'window', label: 'Eating window' });
  if (timeline.sleep) items.push({ key: 'sleep', label: 'Going to sleep' });
  return items;
}

// ---------------------------------------------------------------------------
// Meals list
// ---------------------------------------------------------------------------

export interface TimingMealRow {
  id: string;
  time: string;
  name: string;
  slot: string;
  tag?: TimingTagKind;
}

/** The real meals of the day with their tags. Guess entries have no real time, so they are left out. */
export function mealRows(view: TimingDetailView): TimingMealRow[] {
  return view.summary.meals
    .filter((m) => !m.isGuess)
    .map((m) => {
      const row: TimingMealRow = { id: m.id, time: fmtTime(m.eatenAt, view.tz), name: m.name, slot: SLOT_LABEL[m.slot] };
      const tag = view.paused ? undefined : view.summary.tags[m.id];
      if (tag) row.tag = tag;
      return row;
    });
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

/** "This week" for the current week, else "5–11 Oct". */
export function weekHeading(weekStart: LogicalDay, today: LogicalDay): string {
  return weekStart === weekStartOf(today) ? 'This week' : fmtDayRange(weekStart, addDays(weekStart, 6));
}

export interface WeekLabels {
  heading: string;
  headerLeft: string;
  headerRight: string;
  axisLabels: string[];
  ariaLabel: string;
}

export function weekLabels(view: Pick<TimingDetailView, 'week' | 'today' | 'earlyRead' | 'completeDays' | 'rolloverHour'>): WeekLabels {
  const { week } = view;
  const heading = weekHeading(week.weekStart, view.today);
  const headerLeft = week.averageWindowHours === null ? 'Average window —' : `Average window ${fmtHours(week.averageWindowHours)}`;
  const headerRight = view.earlyRead ? `Early read · ${plural(view.completeDays, 'day')}` : heading;
  const late = week.rows.filter((r) => r.dots.some((d) => d.late)).length;
  return {
    heading,
    headerLeft,
    headerRight,
    axisLabels: [fmtClock(view.rolloverHour * 60, { compact: true }), 'noon', '6pm', 'midnight'],
    ariaLabel: `${headerLeft}. ${headerRight}. Late meals on ${plural(late, 'day')}.`,
  };
}

// ---------------------------------------------------------------------------
// Going to sleep explainer
// ---------------------------------------------------------------------------

/** The paragraphs under "Going to sleep": when the button shows, what it feeds, and that it is optional. */
export function sleepExplainer(input: {
  rules: Pick<TimingDetailView['rules'], 'minHoursBeforeSleep'>;
  usualSleepLogicalMin: number | null;
  rolloverHour: number;
}): string[] {
  const { rules, usualSleepLogicalMin, rolloverHour } = input;
  const when =
    usualSleepLogicalMin === null
      ? `It shows up from ${fmtClock(DEFAULT_SLEEP_FROM_WALL_MIN, { compact: true })} until the app learns your usual sleep time.`
      : `It shows up from about an hour before your usual sleep time, around ${fmtClock(
          logicalToWallMinutes(Math.max(0, usualSleepLogicalMin - SLEEP_LEAD_MIN), rolloverHour),
          { compact: true },
        )}.`;
  const rule =
    rules.minHoursBeforeSleep !== undefined
      ? `With a tap, the app checks your last meal against your goal's rule: ${limitHours(rules.minHoursBeforeSleep)} or more before sleep.`
      : 'With a tap, the app can show how long before sleep your last meal was.';
  return [
    `On Today, a Going to sleep button shows up in the evening. ${when} Tap it when you head to bed. It's optional, and the app works without it.`,
    rule,
    'Without a tap, that check is skipped for the day. A missing tap is never read as a late meal.',
    'Tapped it by mistake? Use Undo on Today.',
  ];
}
