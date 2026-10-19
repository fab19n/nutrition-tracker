/**
 * The non-ranked parts of the Insights tab: calories by Place, recurring calories, the timing
 * grid and "what we learned about you" (the day-7 weekly review). All pure.
 */
import { byId, normaliseName } from '@/data/catalogue';
import { MINUTES_PER_DAY, minutesIntoLogicalDay, weekdayIndex } from '@/domain/day';
import { fmtDayLetter } from '@/domain/format';
import { DEFAULT_MAX_WINDOW_HOURS, MEAL_SLOTS, eatingWindow, timingTag, type SlotBaselines } from '@/domain/timing';
import type { Id, LogicalDay, MealLog, MealSlot, Place } from '@/domain/types';
import { itemCategory, itemGroup, itemKcal, mealKcal } from './categories';
import type { CategoryGroupId, EvidenceEntry, InsightContext, InsightDay } from './types';

// ---------------------------------------------------------------------------
// By Place (kcal and RM)
// ---------------------------------------------------------------------------

export interface PlaceTotal {
  placeId: Id;
  name: string;
  kcal: number;
  /** Σ prices logged there; 0 when none were. */
  spendRm: number;
  visits: number;
}

/** Calories and spend per Place, biggest first. Meals without a Place are left out. */
export function placeTotals(meals: MealLog[], places: Place[]): PlaceTotal[] {
  const byIdMap = new Map(places.map((p) => [p.id, p]));
  const totals = new Map<Id, PlaceTotal>();
  for (const meal of meals) {
    if (meal.isGuess || !meal.placeId) continue;
    const place = byIdMap.get(meal.placeId);
    if (!place) continue;
    const row = totals.get(place.id) ?? { placeId: place.id, name: place.name, kcal: 0, spendRm: 0, visits: 0 };
    row.kcal += mealKcal(meal);
    row.spendRm += meal.priceRm ?? 0;
    row.visits += 1;
    totals.set(place.id, row);
  }
  return [...totals.values()]
    .map((row) => ({ ...row, kcal: Math.round(row.kcal), spendRm: Math.round(row.spendRm * 100) / 100 }))
    .sort((a, b) => b.kcal - a.kcal || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Recurring calories (C43)
// ---------------------------------------------------------------------------

/**
 * Small things you have often: drinks, kuih, snacks, fruit, bread and noodles. Parts of a plate
 * (rice, lauk, sayur, kuah) are what the Place comparison is for.
 */
const RECURRING_CATEGORIES = new Set(['drinks', 'kuih', 'snack', 'fruit', 'bread', 'noodles', 'other']);
/** "~3+ times a week". */
export const RECURRING_MIN_PER_WEEK = 3;

export interface RecurringItem {
  key: string;
  catalogueId?: string;
  name: string;
  count: number;
  /** Times a week (count scaled to 7 days). */
  perWeek: number;
  kcal: number;
  kcalPerWeek: number;
  avgKcal: number;
  group: CategoryGroupId;
  entries: EvidenceEntry[];
}

/** Items logged about 3 or more times a week over `dayCount` days, most kcal first. */
export function recurringItems(meals: MealLog[], dayCount: number, places: Place[] = []): RecurringItem[] {
  const placeById = new Map(places.map((p) => [p.id, p]));
  const scale = 7 / Math.max(1, dayCount);
  const byKey = new Map<string, RecurringItem>();
  for (const meal of meals) {
    if (meal.isGuess) continue;
    for (const item of meal.items) {
      const category = itemCategory(item);
      if (category === undefined || !RECURRING_CATEGORIES.has(category)) continue;
      const entry = item.catalogueId ? byId(item.catalogueId) : undefined;
      const key = item.catalogueId ?? `name:${normaliseName(item.name)}`;
      const kcal = itemKcal(item, meal);
      const row: RecurringItem = byKey.get(key) ?? {
        key,
        name: entry?.name ?? item.name,
        count: 0,
        perWeek: 0,
        kcal: 0,
        kcalPerWeek: 0,
        avgKcal: 0,
        group: itemGroup(item, meal, placeById),
        entries: [],
      };
      if (item.catalogueId) row.catalogueId = item.catalogueId;
      row.count += item.quantity;
      row.kcal += kcal;
      row.entries.push({ mealId: meal.id, kcal, label: item.name });
      byKey.set(key, row);
    }
  }
  return [...byKey.values()]
    .map((row) => ({
      ...row,
      kcal: Math.round(row.kcal),
      perWeek: row.count * scale,
      kcalPerWeek: Math.round(row.kcal * scale),
      avgKcal: row.count > 0 ? Math.round(row.kcal / row.count) : 0,
    }))
    .filter((row) => row.perWeek >= RECURRING_MIN_PER_WEEK - 1e-9)
    .sort((a, b) => b.kcalPerWeek - a.kcalPerWeek || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Timing grid (C13)
// ---------------------------------------------------------------------------

export interface TimingDot {
  /** Position across the logical day (rollover to rollover), 0–100. */
  pct: number;
  /** 7–12px by kcal. */
  sizePx: number;
  late: boolean;
}

export interface TimingRow {
  day: LogicalDay;
  /** Day letter, "M". */
  label: string;
  windowStartPct: number;
  windowLenPct: number;
  dots: TimingDot[];
  /** First bite to last bite; 0 with fewer than two meals. */
  windowHours: number;
}

const DOT_MIN_PX = 7;
const DOT_MAX_PX = 12;
/** A meal this big gets the largest dot. */
const DOT_FULL_KCAL = 900;

function dotSize(kcal: number): number {
  return Math.round(DOT_MIN_PX + (DOT_MAX_PX - DOT_MIN_PX) * Math.min(1, Math.max(0, kcal / DOT_FULL_KCAL)));
}

export interface TimingGridData {
  rows: TimingRow[];
  /** Average first-to-last-bite hours over days with two or more meals; null without any. */
  averageWindowHours: number | null;
}

/** One row per day: the eating window and a dot per meal, late ones flagged (against your own times). */
export function timingGrid(
  days: InsightDay[],
  opts: { baselines: SlotBaselines; tz: string; rolloverHour: number; maxWindowHours?: number },
): TimingGridData {
  const rules = { maxWindowHours: opts.maxWindowHours ?? DEFAULT_MAX_WINDOW_HOURS };
  const lengths: number[] = [];
  const rows = days.map((d): TimingRow => {
    const meals = d.meals.filter((m) => !m.isGuess);
    const window = eatingWindow(meals, rules, { tz: opts.tz, rolloverHour: opts.rolloverHour });
    const minutes = meals.map((m) => minutesIntoLogicalDay(m.eatenAt, opts.tz, opts.rolloverHour));
    const first = minutes.length > 0 ? Math.min(...minutes) : 0;
    const last = minutes.length > 0 ? Math.max(...minutes) : 0;
    if (meals.length >= 2) lengths.push(window.lengthHours);
    return {
      day: d.day,
      label: fmtDayLetter(d.day),
      windowStartPct: (first / MINUTES_PER_DAY) * 100,
      windowLenPct: ((last - first) / MINUTES_PER_DAY) * 100,
      windowHours: window.lengthHours,
      dots: meals.map((meal, i) => {
        const tag = timingTag(meal, { baselines: opts.baselines, window, tz: opts.tz, rolloverHour: opts.rolloverHour });
        return {
          pct: ((minutes[i] ?? 0) / MINUTES_PER_DAY) * 100,
          sizePx: dotSize(mealKcal(meal)),
          late: tag === 'lateForYou' || tag === 'outsideWindow' || tag === 'afterMidnight',
        };
      }),
    };
  });
  const averageWindowHours = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null;
  return { rows, averageWindowHours };
}

// ---------------------------------------------------------------------------
// What we learned about you (day-7 review)
// ---------------------------------------------------------------------------

export interface LearnedAboutYou {
  /** Your usual time per slot (minutes after midnight), for slots seen on 3+ days. */
  usualTimes: { slot: MealSlot; minutes: number }[];
  topPlaces: { name: string; visits: number }[];
  topFoods: { name: string; count: number }[];
  completeDays: number;
  daysInUse: number;
}

const LEARNED_MIN_SAMPLES = 3;

export function learnedAboutYou(ctx: InsightContext): LearnedAboutYou {
  const meals = ctx.periodDays.flatMap((d) => d.meals).filter((m) => !m.isGuess);
  const usualTimes = MEAL_SLOTS.flatMap((slot) => {
    const own = ctx.baselines[slot];
    if (own.samples >= LEARNED_MIN_SAMPLES) return [{ slot, minutes: own.medianMin }];
    // First week: no complete history yet, so read the week itself.
    const times = ctx.periodDays
      .map((d) => d.meals.filter((m) => !m.isGuess && m.slot === slot)[0])
      .filter((m): m is MealLog => m !== undefined)
      .map((m) => minutesIntoLogicalDay(m.eatenAt, ctx.tz, ctx.rolloverHour))
      .sort((a, b) => a - b);
    if (times.length < LEARNED_MIN_SAMPLES) return [];
    const mid = times[Math.floor(times.length / 2)] ?? 0;
    return [{ slot, minutes: (mid + ctx.rolloverHour * 60) % MINUTES_PER_DAY }];
  });
  const topPlaces = placeTotals(meals, ctx.places)
    .sort((a, b) => b.visits - a.visits || b.kcal - a.kcal)
    .slice(0, 3)
    .map((p) => ({ name: p.name, visits: p.visits }));
  // Meals as you name them ("Economy rice", "Nasi kandar ayam goreng"), not their parts.
  const counts = new Map<string, { name: string; count: number }>();
  for (const meal of meals) {
    const key = normaliseName(meal.name);
    const row = counts.get(key) ?? { name: meal.name, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  const topFoods = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);
  return {
    usualTimes,
    topPlaces,
    topFoods,
    completeDays: ctx.periodDays.filter((d) => d.status === 'complete').length,
    daysInUse: ctx.periodDays.length,
  };
}

/** Saturday or Sunday. */
export function isWeekend(day: LogicalDay): boolean {
  return weekdayIndex(day) >= 5;
}

/**
 * 10.4 → '10.4 h' (the timing grid's "Average window 10.4 h").
 * CONTRACT: belongs in src/domain/format.ts next to fmtKg; kept here until that file grows one.
 */
export function fmtHours(hours: number): string {
  if (!Number.isFinite(hours)) return '— h';
  return `${(Math.round(Math.max(0, hours) * 10) / 10).toFixed(1)} h`;
}

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** '2026-10-11' → 'Sunday'. */
export function fmtWeekdayLong(day: LogicalDay): string {
  return WEEKDAY_LONG[weekdayIndex(day)] ?? '';
}
