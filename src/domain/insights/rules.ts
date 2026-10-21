/**
 * The starting insight rules (plan §13.4). Each one: a minimum amount of data, a calculation,
 * a kcal-a-week impact, a confidence, a sentence template and the meals behind it.
 * Facts first, one thing to try, no judging words (handoff §10.3).
 */
import { byId } from '@/data/catalogue';
import { addDays, compareDays, daysBetween, minutesIntoLogicalDay, weekStartOf, weekdayIndex } from '@/domain/day';
import { fmtClock, fmtDayRange, fmtInt, fmtKg, fmtKgRate, roundTo10 } from '@/domain/format';
import { maintenanceWorking } from '@/domain/maintenance';
import { mealMacros } from '@/domain/meal';
import { paceOf } from '@/domain/targets';
import { DEFAULT_MAX_WINDOW_HOURS, eatingWindow } from '@/domain/timing';
import type { MealItem, MealLog, MealSlot } from '@/domain/types';
import { categoryShares, isDrink, isHomeMeal, itemCategory, itemGroup, itemKcal, mealKcal, variantLabel } from './categories';
import { hasSugarChoice, isLessSugar, nasiKandarRice } from './focusRules';
import { isWeekend, recurringItems } from './summaries';
import type { CategoryGroupId, EvidenceEntry, InsightContext, InsightDay, InsightFinding, InsightRule } from './types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Meals of the period that were really logged (guesses have no food detail). */
function periodMeals(ctx: InsightContext): MealLog[] {
  return ctx.periodDays.flatMap((d) => d.meals).filter((m) => !m.isGuess);
}

/** Days of the period with at least one logged meal. */
function loggedDays(days: InsightDay[]): InsightDay[] {
  return days.filter((d) => d.meals.some((m) => !m.isGuess));
}

/** Finished days only (today is still going). */
function finished(days: InsightDay[], ctx: InsightContext): InsightDay[] {
  return days.filter((d) => compareDays(d.day, ctx.today) < 0);
}

/** Per-week scale for counts over the period. */
function perWeek(ctx: InsightContext, value: number): number {
  return (value * 7) / Math.max(1, ctx.periodDays.length);
}

/** "last week", "this week", "in the last 7 days", "so far". */
export function periodPhrase(ctx: InsightContext): string {
  const { period, today } = ctx;
  if (period.kind === 'soFar') return 'so far';
  if (period.kind === 'last7') return 'in the last 7 days';
  const thisWeek = weekStartOf(today);
  if (period.from === thisWeek) return 'this week';
  if (period.from === addDays(thisWeek, -7)) return 'last week';
  return `in ${fmtDayRange(period.from, addDays(period.from, 6))}`;
}

function early(ctx: InsightContext, solidDays: number): boolean {
  return ctx.completeDays < solidDays;
}

/** "Nasi kandar near home" → "Nasi kandar". */
export function shortPlaceName(name: string): string {
  const short = name.replace(/\s+(near (home|the office|office|work)|nearby)$/i, '').trim();
  return short.length > 0 ? short : name;
}

const SLOT_TIME_WORD: Record<MealSlot, string> = {
  breakfast: 'mornings',
  lunch: 'lunches',
  snack: 'snacks',
  dinner: 'nights',
  supper: 'late nights',
};

function dominantSlot(meals: MealLog[]): MealSlot {
  const counts = new Map<MealSlot, number>();
  for (const m of meals) counts.set(m.slot, (counts.get(m.slot) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'dinner';
}

function displayName(item: MealItem): string {
  return (item.catalogueId ? byId(item.catalogueId)?.name : undefined) ?? item.name;
}

/** "Teh tarik · Kurang". */
function itemLabel(item: MealItem): string {
  const label = variantLabel(item);
  return label && (item.variants?.length ?? 0) > 1 ? `${displayName(item)} · ${label}` : displayName(item);
}

/** "Teh tarik 8 times, milo ais 3 times". */
function topNames(items: MealItem[], limit = 2): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(displayName(item), (counts.get(displayName(item)) ?? 0) + item.quantity);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  return top.map(([name, n], i) => `${i === 0 ? name : lowerFirst(name)} ${plural(n, 'time')}`).join(', ');
}

/** kcal saved by moving an item to the chip labelled `target` (0 when it's already lighter). */
function savingTo(item: MealItem, target: (label: string, index: number) => boolean): number {
  const variants = item.variants ?? [];
  const index = variants.findIndex((v, i) => target(v.label.toLowerCase(), i));
  const lighter = variants[index];
  if (!lighter || item.selectedVariant === undefined || index >= item.selectedVariant) return 0;
  return Math.max(0, (item.unitMacros.kcal - lighter.macros.kcal) * item.quantity);
}

function mealEntries(meals: MealLog[]): EvidenceEntry[] {
  return meals.map((m) => ({ mealId: m.id, kcal: Math.round(mealKcal(m)) }));
}

function ids(entries: EvidenceEntry[]): string[] {
  return [...new Set(entries.map((e) => e.mealId))];
}

// ---------------------------------------------------------------------------
// Category share
// ---------------------------------------------------------------------------

const DRINKS_MIN_PCT = 8;
const SNACKS_MIN_PCT = 10;

const categoryShare: InsightRule = {
  id: 'categoryShare',
  unlockDay: 7,
  solidDays: 7,
  minimumData: '7 days',
  compute(ctx) {
    const meals = periodMeals(ctx);
    const shares = categoryShares(meals, ctx.places);
    const basisDays = loggedDays(ctx.periodDays).length;
    if (basisDays < 3) return null;
    const placeById = new Map(ctx.places.map((p) => [p.id, p]));
    const confidence = 0.9 * clamp01(basisDays / 7);

    const drinksPct = shares.find((s) => s.id === 'drinks')?.pct ?? 0;
    const drinks = meals.flatMap((meal) => meal.items.filter(isDrink).map((item) => ({ meal, item })));
    if (drinksPct >= DRINKS_MIN_PCT && drinks.length >= 3) {
      const kcal = drinks.reduce((sum, d) => sum + itemKcal(d.item, d.meal), 0);
      const sweet = drinks.filter((d) => hasSugarChoice(d.item) && !isLessSugar(d.item));
      const saving = sweet.reduce((sum, d) => sum + savingTo(d.item, (l) => l === 'kurang'), 0);
      const halfPerWeek = roundTo10(perWeek(ctx, saving / 2));
      const entries = drinks.map((d) => ({ mealId: d.meal.id, kcal: Math.round(itemKcal(d.item, d.meal)), label: itemLabel(d.item) }));
      const finding: InsightFinding = {
        headline: `Drinks were ${fmtInt(drinksPct)}% of your calories`,
        evidence: `${topNames(drinks.map((d) => d.item))}, ~${fmtInt(roundTo10(kcal))} kcal.`,
        linkLabel: `See ${plural(drinks.length, 'drink')}`,
        evidenceMealIds: ids(entries),
        evidenceEntries: entries,
        summary: `${plural(drinks.length, 'drink')} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(kcal))} kcal`,
        tryText:
          halfPerWeek >= 30
            ? `kurang manis for half of them, about ${fmtInt(halfPerWeek)} kcal a week less`
            : 'teh o kosong or air kosong for one of them a day',
        impactKcalPerWeek: halfPerWeek >= 30 ? halfPerWeek : roundTo10(perWeek(ctx, kcal) * 0.15),
        confidence,
        earlyRead: early(ctx, categoryShare.solidDays),
        basisDays,
        category: 'drinks',
        topic: 'drinks',
      };
      if (sweet.length > 0) {
        finding.focus = 'drinksKurang';
        finding.focusSub = halfPerWeek >= 30 ? `About ${fmtInt(halfPerWeek)} kcal a week less` : 'Less sugar in teh, kopi and milo';
      }
      return finding;
    }

    const snacksPct = shares.find((s) => s.id === 'snacks')?.pct ?? 0;
    const snacks = meals.flatMap((meal) =>
      meal.items.filter((item) => itemGroup(item, meal, placeById) === 'snacks').map((item) => ({ meal, item })),
    );
    if (snacksPct >= SNACKS_MIN_PCT && snacks.length >= 3) {
      const kcal = snacks.reduce((sum, d) => sum + itemKcal(d.item, d.meal), 0);
      const lessPerWeek = roundTo10(perWeek(ctx, kcal) * 0.4);
      const entries = snacks.map((d) => ({ mealId: d.meal.id, kcal: Math.round(itemKcal(d.item, d.meal)), label: itemLabel(d.item) }));
      return {
        headline: `Snacks and kuih were ${fmtInt(snacksPct)}% of your calories`,
        evidence: `${topNames(snacks.map((d) => d.item))}, ~${fmtInt(roundTo10(kcal))} kcal.`,
        linkLabel: `See ${plural(snacks.length, 'snack')}`,
        evidenceMealIds: ids(entries),
        evidenceEntries: entries,
        summary: `${plural(snacks.length, 'snack')} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(kcal))} kcal`,
        tryText: `keep one a day and have fruit for the rest, about ${fmtInt(lessPerWeek)} kcal a week less`,
        impactKcalPerWeek: lessPerWeek,
        confidence,
        earlyRead: early(ctx, categoryShare.solidDays),
        basisDays,
        category: 'snacks',
        topic: 'snacks',
      };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Place comparison
// ---------------------------------------------------------------------------

const MAIN_SLOTS: ReadonlySet<MealSlot> = new Set(['breakfast', 'lunch', 'dinner']);
const PLACE_MIN_DIFF_KCAL = 150;
/** Saving per visit worth suggesting. */
const PLACE_MIN_SAVING = 40;

function averageSaving(meals: MealLog[], pick: (meal: MealLog) => MealItem | undefined, target: (label: string, index: number) => boolean): number {
  return avg(meals.map((m) => {
    const item = pick(m);
    return item ? savingTo(item, target) : 0;
  }));
}

function gravyOf(meal: MealLog): MealItem | undefined {
  return meal.items.find((i) => itemCategory(i) === 'gravy' && (i.variants?.length ?? 0) > 1);
}

function riceOf(meal: MealLog): MealItem | undefined {
  return meal.items.find((i) => itemCategory(i) === 'rice' && (i.variants?.length ?? 0) > 1);
}

const placeComparison: InsightRule = {
  id: 'placeComparison',
  unlockDay: 7,
  solidDays: 7,
  minimumData: '2+ visits',
  compute(ctx) {
    const meals = periodMeals(ctx);
    const placeById = new Map(ctx.places.map((p) => [p.id, p]));
    let best: { finding: InsightFinding; weight: number } | undefined;

    const byPlace = new Map<string, MealLog[]>();
    for (const m of meals) {
      if (!m.placeId || isHomeMeal(m, placeById)) continue;
      byPlace.set(m.placeId, [...(byPlace.get(m.placeId) ?? []), m]);
    }
    for (const [placeId, visits] of byPlace) {
      const place = placeById.get(placeId);
      if (!place || visits.length < 2) continue;
      const slot = dominantSlot(visits);
      const sameSlot = meals.filter((m) => m.placeId !== placeId && m.slot === slot);
      const elsewhere = sameSlot.length >= 2 ? sameSlot : meals.filter((m) => m.placeId !== placeId && MAIN_SLOTS.has(m.slot));
      if (elsewhere.length < 2) continue;
      const each = avg(visits.map(mealKcal));
      const other = avg(elsewhere.map(mealKcal));
      const diff = each - other;
      if (diff < PLACE_MIN_DIFF_KCAL) continue;

      const riceSaving = averageSaving(visits, riceOf, (_, i) => i === 0);
      const gravySaving = averageSaving(visits, gravyOf, (_, i) => i === 0);
      const gravy = visits.map(gravyOf).find((g) => g !== undefined);
      const gravyWords = gravy && /^kuah/i.test(displayName(gravy)) ? 'kuah sikit' : `${lowerFirst(gravy ? displayName(gravy) : 'kuah')} sikit`;
      const tryParts: string[] = [];
      if (riceSaving >= PLACE_MIN_SAVING) tryParts.push('half rice there');
      if (gravySaving >= PLACE_MIN_SAVING) tryParts.push(tryParts.length > 0 ? gravyWords : `${gravyWords} there`);
      const perVisit = Math.max(riceSaving, gravySaving);
      const visitsPerWeek = perWeek(ctx, visits.length);
      const impact = perVisit >= PLACE_MIN_SAVING ? perVisit * visitsPerWeek : diff * 0.25 * visitsPerWeek;
      const total = visits.reduce((sum, m) => sum + mealKcal(m), 0);
      const entries = mealEntries(visits);
      const mainGroup = (() => {
        const counts = new Map<CategoryGroupId, number>();
        for (const v of visits) for (const i of v.items) if (!isDrink(i)) counts.set(itemGroup(i, v, placeById), (counts.get(itemGroup(i, v, placeById)) ?? 0) + itemKcal(i, v));
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      })();

      const finding: InsightFinding = {
        headline: `${shortPlaceName(place.name)} ${SLOT_TIME_WORD[slot]} cost the most`,
        evidence: `${plural(visits.length, 'visit')}, ~${fmtInt(roundTo10(each))} kcal each vs ${fmtInt(roundTo10(other))} elsewhere.`,
        linkLabel: `See ${plural(visits.length, 'visit')}`,
        evidenceMealIds: ids(entries),
        evidenceEntries: entries,
        summary: `${plural(visits.length, 'visit')} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(total))} kcal`,
        tryText: tryParts.length > 0 ? tryParts.join(', or ') : 'a smaller plate there, or share a side',
        impactKcalPerWeek: roundTo10(impact),
        confidence: 0.8 * clamp01(visits.length / 4) * clamp01(elsewhere.length / 3),
        earlyRead: early(ctx, placeComparison.solidDays),
        basisDays: loggedDays(ctx.periodDays).length,
        basisLabel: plural(visits.length, 'visit'),
        topic: `place:${placeId}`,
      };
      if (mainGroup) finding.category = mainGroup;
      if (riceSaving >= PLACE_MIN_SAVING && visits.some((v) => nasiKandarRice(v) !== undefined)) {
        finding.focus = 'halfRiceNasiKandar';
        finding.focusSub = `Around ${fmtInt(roundTo10(riceSaving))} kcal a visit`;
      }
      const weight = diff * visits.length;
      if (!best || weight > best.weight) best = { finding, weight };
    }
    return best?.finding ?? null;
  },
};

// ---------------------------------------------------------------------------
// Recurring calories
// ---------------------------------------------------------------------------

const recurringCalories: InsightRule = {
  id: 'recurringCalories',
  unlockDay: 7,
  solidDays: 7,
  minimumData: '7 days',
  compute(ctx) {
    const basisDays = loggedDays(ctx.periodDays).length;
    if (basisDays < 3) return null;
    const meals = periodMeals(ctx);
    const top = recurringItems(meals, ctx.periodDays.length, ctx.places)[0];
    if (!top) return null;
    const itemsOf = meals.flatMap((m) => m.items.filter((i) => (i.catalogueId ?? '') === (top.catalogueId ?? '') && displayName(i) === top.name).map((item) => ({ meal: m, item })));
    const sweet = itemsOf.filter((d) => hasSugarChoice(d.item) && !isLessSugar(d.item));
    const kurangSaving = roundTo10(perWeek(ctx, sweet.reduce((sum, d) => sum + savingTo(d.item, (l) => l === 'kurang'), 0)));
    const nameLower = lowerFirst(top.name);
    const drink = top.group === 'drinks';
    const finding: InsightFinding = {
      headline: `${top.name} adds up to ~${fmtInt(roundTo10(top.kcalPerWeek))} kcal a week`,
      evidence: `${plural(Math.round(top.count), 'time')} ${periodPhrase(ctx)}, ~${fmtInt(roundTo10(top.avgKcal))} each.`,
      linkLabel: `See ${fmtInt(Math.round(top.count))} ${nameLower}`,
      evidenceMealIds: ids(top.entries),
      evidenceEntries: top.entries.map((e) => ({ ...e, kcal: Math.round(e.kcal) })),
      summary: `${fmtInt(Math.round(top.count))} ${nameLower} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(top.kcal))} kcal`,
      tryText:
        drink && kurangSaving >= 30
          ? `${nameLower} kurang manis, about ${fmtInt(kurangSaving)} kcal a week less`
          : `have it every other day, about ${fmtInt(roundTo10(top.kcalPerWeek / 2))} kcal a week less`,
      impactKcalPerWeek: drink && kurangSaving >= 30 ? kurangSaving : roundTo10(top.kcalPerWeek / 2),
      confidence: 0.6 * clamp01(basisDays / 7),
      earlyRead: early(ctx, recurringCalories.solidDays),
      basisDays,
      category: top.group,
      topic: drink ? 'drinks' : `item:${top.key}`,
    };
    if (drink && sweet.length > 0) {
      finding.focus = 'drinksKurang';
      finding.focusSub = kurangSaving >= 30 ? `About ${fmtInt(kurangSaving)} kcal a week less` : 'Less sugar in teh, kopi and milo';
    }
    return finding;
  },
};

// ---------------------------------------------------------------------------
// Weekday vs weekend
// ---------------------------------------------------------------------------

const weekdayWeekend: InsightRule = {
  id: 'weekdayWeekend',
  unlockDay: 7,
  solidDays: 14,
  minimumData: '7 days',
  compute(ctx) {
    const days = ctx.historyDays.filter((d) => d.status === 'complete');
    const weekend = days.filter((d) => isWeekend(d.day));
    const weekday = days.filter((d) => !isWeekend(d.day));
    if (weekend.length < 2 || weekday.length < 4) return null;
    const weekendAvg = avg(weekend.map((d) => d.eatenKcal));
    const weekdayAvg = avg(weekday.map((d) => d.eatenKcal));
    const diff = weekendAvg - weekdayAvg;
    if (diff < 250) return null;
    const entries = mealEntries(weekend.flatMap((d) => d.meals.filter((m) => !m.isGuess)));
    return {
      headline: `Weekends averaged ${fmtInt(roundTo10(diff))} kcal more a day`,
      evidence: `~${fmtInt(roundTo10(weekendAvg))} on Saturdays and Sundays vs ${fmtInt(roundTo10(weekdayAvg))} on weekdays.`,
      linkLabel: `See ${plural(weekend.length, 'weekend day')}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(weekend.length, 'weekend day')} · ~${fmtInt(roundTo10(weekendAvg))} kcal a day`,
      tryText: "plan a makan day, so the extra comes out of the week's savings",
      impactKcalPerWeek: roundTo10(diff * 2 * 0.5),
      confidence: 0.7 * clamp01(weekend.length / 4),
      earlyRead: early(ctx, weekdayWeekend.solidDays),
      basisDays: days.length,
      topic: 'weekend',
    };
  },
};

// ---------------------------------------------------------------------------
// Protein gaps
// ---------------------------------------------------------------------------

const SLOT_PLURAL: Record<MealSlot, string> = {
  breakfast: 'breakfasts',
  lunch: 'lunches',
  snack: 'snacks',
  dinner: 'dinners',
  supper: 'suppers',
};

const PROTEIN_TRY: Record<MealSlot, string> = {
  breakfast: 'two telur separuh masak with breakfast, about 12g more',
  lunch: 'an extra piece of ayam or ikan at lunch',
  dinner: 'tauhu or telur with dinner, about 7–12g more',
  snack: 'a glass of susu or soya as a snack',
  supper: 'a boiled egg instead of a sweet supper',
};

const proteinGaps: InsightRule = {
  id: 'proteinGaps',
  unlockDay: 7,
  solidDays: 7,
  minimumData: '7 days',
  compute(ctx) {
    const target = ctx.version?.proteinG;
    if (!target || target <= 0) return null;
    const days = loggedDays(finished(ctx.periodDays, ctx));
    if (days.length < 3) return null;
    const proteinOf = (d: InsightDay): number => d.meals.reduce((sum, m) => sum + mealMacros(m).proteinG, 0);
    const reached = days.filter((d) => proteinOf(d) >= target * 0.95).length;
    if (reached / days.length >= 0.6) return null;
    const avgProtein = avg(days.map(proteinOf));
    const slots: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
    const bySlot = slots
      .map((slot) => {
        const meals = days.flatMap((d) => d.meals.filter((m) => !m.isGuess && m.slot === slot));
        return { slot, meals, protein: avg(meals.map((m) => mealMacros(m).proteinG)) };
      })
      .filter((s) => s.meals.length >= 2)
      .sort((a, b) => a.protein - b.protein);
    const lowest = bySlot[0];
    if (!lowest) return null;
    const gap = Math.max(0, target - avgProtein);
    const factor = ctx.goal?.template === 'leanBulk' ? 4 : 1;
    const entries = lowest.meals.map((m) => ({
      mealId: m.id,
      kcal: Math.round(mealKcal(m)),
      label: `${m.name} · ${fmtInt(mealMacros(m).proteinG)}g protein`,
    }));
    return {
      headline: `Protein target reached on ${fmtInt(reached)} of ${plural(days.length, 'day')}`,
      evidence: `You averaged ${fmtInt(avgProtein)}g a day against ${fmtInt(target)}g. ${upperFirst(lowest.slot)} is lowest, ~${fmtInt(lowest.protein)}g.`,
      linkLabel: `See ${plural(lowest.meals.length, lowest.slot, SLOT_PLURAL[lowest.slot])}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(lowest.meals.length, lowest.slot, SLOT_PLURAL[lowest.slot])} · ~${fmtInt(lowest.protein)}g protein each`,
      tryText: PROTEIN_TRY[lowest.slot],
      impactKcalPerWeek: roundTo10(gap * 7 * factor),
      confidence: 0.5 * clamp01(days.length / 7),
      earlyRead: early(ctx, proteinGaps.solidDays),
      basisDays: days.length,
      topic: 'protein',
    };
  },
};

// ---------------------------------------------------------------------------
// Budget result
// ---------------------------------------------------------------------------

const budgetResult: InsightRule = {
  id: 'budgetResult',
  unlockDay: 7,
  solidDays: 7,
  minimumData: '7 days',
  compute(ctx) {
    const budget = ctx.budget;
    if (!budget || ctx.period.kind !== 'week') return null;
    const done = budget.days.filter((d) => d.isFinished && d.kind !== 'paused');
    if (done.length < 4) return null;
    const counted = done.reduce((sum, d) => sum + d.countedKcal, 0);
    const base = done.reduce((sum, d) => sum + d.baseKcal, 0);
    const over = counted - base;
    if (Math.abs(over) < 50) return null;
    const overDays = done.filter((d) => d.eatenKcal > d.baseKcal && d.kind !== 'notCounted').sort((a, b) => b.eatenKcal - b.baseKcal - (a.eatenKcal - a.baseKcal));
    const biggest = overDays[0];
    const entries = mealEntries(
      ctx.periodDays.filter((d) => overDays.some((o) => o.day === d.day)).flatMap((d) => d.meals),
    );
    const totals = `${fmtInt(counted)} of ${fmtInt(base)}.`;
    if (over > 0) {
      return {
        headline: `Week finished ${fmtInt(over)} kcal over plan`,
        evidence: biggest
          ? `${totals} ${WEEKDAY_NAMES[weekdayIndex(biggest.day)] ?? ''} went over by ${fmtInt(biggest.eatenKcal - biggest.baseKcal)}.`
          : totals,
        linkLabel: overDays.length > 0 ? `See ${plural(overDays.length, 'day')} over` : '',
        evidenceMealIds: ids(entries),
        evidenceEntries: entries,
        summary: `${plural(overDays.length, 'day')} over ${periodPhrase(ctx)}`,
        tryText: 'plan a makan day ahead, so a big day comes out of savings',
        impactKcalPerWeek: roundTo10(over * 0.5),
        confidence: 0.9,
        earlyRead: early(ctx, budgetResult.solidDays),
        basisDays: done.length,
        topic: 'budget',
      };
    }
    return {
      headline: `Week finished ${fmtInt(-over)} kcal under plan`,
      evidence: totals,
      linkLabel: '',
      evidenceMealIds: [],
      evidenceEntries: [],
      summary: `${fmtInt(-over)} kcal under plan ${periodPhrase(ctx)}`,
      tryText: 'keep the same rhythm; savings can go to a makan day',
      impactKcalPerWeek: 0,
      confidence: 0.9,
      earlyRead: early(ctx, budgetResult.solidDays),
      basisDays: done.length,
      topic: 'budget',
    };
  },
};

// ---------------------------------------------------------------------------
// Eating window vs calories
// ---------------------------------------------------------------------------

function windowHoursOf(d: InsightDay, ctx: InsightContext, maxHours: number): number {
  const meals = d.meals.filter((m) => !m.isGuess);
  return eatingWindow(meals, { maxWindowHours: maxHours }, { tz: ctx.tz, rolloverHour: ctx.rolloverHour }).lengthHours;
}

const windowVsCalories: InsightRule = {
  id: 'windowVsCalories',
  unlockDay: 14,
  solidDays: 14,
  minimumData: '14 days',
  compute(ctx) {
    const maxHours = ctx.goal?.timing.maxWindowHours ?? DEFAULT_MAX_WINDOW_HOURS;
    const days = ctx.historyDays.filter((d) => d.status === 'complete' && d.meals.filter((m) => !m.isGuess).length >= 2);
    const long = days.filter((d) => windowHoursOf(d, ctx, maxHours) > maxHours + 1e-9);
    const short = days.filter((d) => windowHoursOf(d, ctx, maxHours) <= maxHours + 1e-9);
    if (long.length < 2 || short.length < 3) return null;
    const longAvg = avg(long.map((d) => d.eatenKcal));
    const diff = longAvg - avg(short.map((d) => d.eatenKcal));
    if (diff < 150) return null;
    const entries = mealEntries(long.flatMap((d) => d.meals.filter((m) => !m.isGuess)));
    const longPerWeek = (long.length * 7) / days.length;
    return {
      headline: 'Long eating days ran higher',
      evidence: `Days over ${fmtInt(maxHours)} hours averaged +${fmtInt(roundTo10(diff))} kcal.`,
      linkLabel: `See ${plural(long.length, 'day')}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(long.length, 'long day')} · ~${fmtInt(roundTo10(longAvg))} kcal a day`,
      tryText: `finish eating within ${fmtInt(maxHours)} hours of your first meal`,
      // The weekly focus is about 12 hours; a goal with a longer window gets the insight only.
      ...(maxHours <= 12 ? { focus: 'windowUnder12h' as const, focusSub: `Long days ran +${fmtInt(roundTo10(diff))}` } : {}),
      impactKcalPerWeek: roundTo10(diff * longPerWeek * 0.6),
      confidence: 0.7 * clamp01(days.length / 14),
      earlyRead: early(ctx, windowVsCalories.solidDays),
      basisDays: days.length,
      topic: 'window',
    };
  },
};

// ---------------------------------------------------------------------------
// First-meal drift
// ---------------------------------------------------------------------------

function firstMealMinutes(d: InsightDay, ctx: InsightContext): number | undefined {
  const first = d.meals.find((m) => !m.isGuess);
  return first ? minutesIntoLogicalDay(first.eatenAt, ctx.tz, ctx.rolloverHour) : undefined;
}

function hoursPhrase(minutes: number): string {
  const halves = Math.max(1, Math.round(Math.abs(minutes) / 30));
  const hours = halves / 2;
  return `${Number.isInteger(hours) ? fmtInt(hours) : hours.toFixed(1)} ${hours === 1 ? 'hour' : 'hours'}`;
}

const firstMealDrift: InsightRule = {
  id: 'firstMealDrift',
  unlockDay: 14,
  solidDays: 14,
  minimumData: '14 days',
  compute(ctx) {
    const recent = loggedDays(finished(ctx.periodDays, ctx));
    const before = ctx.historyDays.filter((d) => d.status === 'complete' && compareDays(d.day, ctx.period.from) < 0);
    const recentTimes = recent.map((d) => firstMealMinutes(d, ctx)).filter((m): m is number => m !== undefined);
    const usualTimes = before.map((d) => firstMealMinutes(d, ctx)).filter((m): m is number => m !== undefined);
    if (recentTimes.length < 4 || usualTimes.length < 5) return null;
    const drift = median(recentTimes) - median(usualTimes);
    if (Math.abs(drift) < 60) return null;
    const toWall = (logical: number): number => (logical + ctx.rolloverHour * 60) % 1440;
    const firsts = recent.map((d) => d.meals.find((m) => !m.isGuess)).filter((m): m is MealLog => m !== undefined);
    const entries = mealEntries(firsts);
    const later = drift > 0;
    return {
      headline: `Your first meal moved ${hoursPhrase(drift)} ${later ? 'later' : 'earlier'} ${periodPhrase(ctx)}`,
      evidence: `Usually around ${fmtClock(toWall(median(usualTimes)), { compact: true })}; ${periodPhrase(ctx)} around ${fmtClock(toWall(median(recentTimes)), { compact: true })}.`,
      linkLabel: `See ${plural(firsts.length, 'first meal')}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(firsts.length, 'first meal')} ${periodPhrase(ctx)}`,
      tryText: later ? "your usual breakfast time, so dinner isn't the biggest meal" : "keep dinner at its usual time, so the day doesn't stretch",
      impactKcalPerWeek: roundTo10(Math.abs(drift) / 60 * 40),
      confidence: 0.5 * clamp01(recentTimes.length / 7),
      earlyRead: early(ctx, firstMealDrift.solidDays),
      basisDays: recentTimes.length + usualTimes.length,
      topic: 'timing',
    };
  },
};

// ---------------------------------------------------------------------------
// Grazing
// ---------------------------------------------------------------------------

const AFTERNOON_FROM_MIN = 15 * 60 - 5 * 60;
const AFTERNOON_TO_MIN = 18 * 60 - 5 * 60;

const grazing: InsightRule = {
  id: 'grazing',
  unlockDay: 14,
  solidDays: 14,
  minimumData: '14 days',
  compute(ctx) {
    const maxOccasions = ctx.goal?.timing.maxEatingOccasions;
    const days = loggedDays(ctx.periodDays);
    if (days.length < 4) return null;
    const between = (m: MealLog): boolean => m.slot === 'snack' && !m.isGuess;
    const occasionsOf = (d: InsightDay): number =>
      eatingWindow(d.meals.filter((m) => !m.isGuess), {}, { tz: ctx.tz, rolloverHour: ctx.rolloverHour }).occasions;

    const busyDays = maxOccasions ? days.filter((d) => occasionsOf(d) > maxOccasions) : [];
    if (maxOccasions && busyDays.length >= 2) {
      const snacks = busyDays.flatMap((d) => d.meals.filter(between));
      const kcal = snacks.reduce((sum, m) => sum + mealKcal(m), 0);
      const entries = mealEntries(snacks);
      return {
        headline: `More than ${fmtInt(maxOccasions)} eating times on ${plural(busyDays.length, 'day')}`,
        evidence: `Snacks between meals added ~${fmtInt(roundTo10(kcal))} kcal.`,
        linkLabel: `See ${plural(snacks.length, 'snack')}`,
        evidenceMealIds: ids(entries),
        evidenceEntries: entries,
        summary: `${plural(snacks.length, 'snack')} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(kcal))} kcal`,
        tryText: 'one planned snack in the afternoon, then nothing until dinner',
        impactKcalPerWeek: roundTo10(perWeek(ctx, kcal) * 0.4),
        confidence: 0.6 * clamp01(days.length / 7),
        earlyRead: early(ctx, grazing.solidDays),
        basisDays: days.length,
        topic: 'grazing',
      };
    }

    const workdays = days.filter((d) => !isWeekend(d.day));
    const afternoon = workdays.flatMap((d) =>
      d.meals.filter((m) => {
        if (m.isGuess || m.slot === 'lunch' || m.slot === 'dinner') return false;
        const min = minutesIntoLogicalDay(m.eatenAt, ctx.tz, ctx.rolloverHour);
        return min >= AFTERNOON_FROM_MIN && min < AFTERNOON_TO_MIN;
      }),
    );
    const daysWith = new Set(afternoon.map((m) => m.logicalDay)).size;
    if (afternoon.length < 3 || daysWith < Math.ceil(workdays.length / 2)) return null;
    const kcal = afternoon.reduce((sum, m) => sum + mealKcal(m), 0);
    const entries = mealEntries(afternoon);
    return {
      headline: `${plural(afternoon.length, 'snack')} between 3pm and 6pm on workdays`,
      evidence: `~${fmtInt(roundTo10(perWeek(ctx, kcal)))} kcal a week, mostly ${topNames(afternoon.flatMap((m) => m.items), 1)}.`,
      linkLabel: `See ${plural(afternoon.length, 'snack')}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(afternoon.length, 'snack')} ${periodPhrase(ctx)} · ~${fmtInt(roundTo10(kcal))} kcal`,
      tryText: 'one planned snack at 4pm, then nothing until dinner',
      impactKcalPerWeek: roundTo10(perWeek(ctx, kcal) * 0.4),
      confidence: 0.55 * clamp01(workdays.length / 5),
      earlyRead: early(ctx, grazing.solidDays),
      basisDays: days.length,
      topic: 'grazing',
    };
  },
};

// ---------------------------------------------------------------------------
// Late eating (needs "Going to sleep" taps)
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;

const lateEating: InsightRule = {
  id: 'lateEating',
  unlockDay: 14,
  solidDays: 14,
  minimumData: '14 days with sleep taps',
  compute(ctx) {
    const minHours = ctx.goal?.timing.minHoursBeforeSleep;
    if (!minHours) return null;
    const tapped = ctx.historyDays.filter((d) => d.sleepAt && d.meals.some((m) => !m.isGuess));
    if (tapped.length < 3) return null;
    const late = tapped
      .map((d) => {
        const sleep = Date.parse(d.sleepAt ?? '');
        const close = d.meals.filter((m) => !m.isGuess && sleep - Date.parse(m.eatenAt) < minHours * MS_PER_HOUR && Date.parse(m.eatenAt) <= sleep);
        return { day: d, close };
      })
      .filter((x) => x.close.length > 0);
    if (late.length < 3) return null;
    const meals = late.flatMap((x) => x.close);
    const kcal = meals.reduce((sum, m) => sum + mealKcal(m), 0);
    const entries = mealEntries(meals);
    return {
      headline: `Last meal was within ${plural(minHours, 'hour')} of sleep on ${plural(late.length, 'night')}`,
      evidence: `~${fmtInt(roundTo10(kcal / late.length))} kcal in those last hours, on average.`,
      linkLabel: `See ${plural(meals.length, 'meal')}`,
      evidenceMealIds: ids(entries),
      evidenceEntries: entries,
      summary: `${plural(late.length, 'night')} · ~${fmtInt(roundTo10(kcal))} kcal close to sleep`,
      tryText: 'an earlier dinner on WFH nights, or a lighter supper',
      impactKcalPerWeek: roundTo10(((kcal / tapped.length) * 7) * 0.3),
      confidence: 0.6 * clamp01(tapped.length / 7),
      earlyRead: tapped.length < lateEating.solidDays,
      basisDays: tapped.length,
      topic: 'late',
    };
  },
};

// ---------------------------------------------------------------------------
// Weight trend vs plan, maintenance estimate
// ---------------------------------------------------------------------------

/** Least-squares slope of the trend in kg a week over the last 28 days, with the span used. */
function trendSlope(ctx: InsightContext): { kgPerWeek: number; spanDays: number; startKg: number; endKg: number } | null {
  const from = addDays(ctx.today, -28);
  const points = ctx.trend.filter((p) => compareDays(p.day, from) >= 0 && compareDays(p.day, ctx.today) <= 0);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 5) return null;
  const spanDays = daysBetween(first.day, last.day);
  if (spanDays < 14) return null;
  const xs = points.map((p) => daysBetween(first.day, p.day));
  const mx = avg(xs);
  const my = avg(points.map((p) => p.trendKg));
  let sxy = 0;
  let sxx = 0;
  points.forEach((p, i) => {
    const dx = (xs[i] ?? 0) - mx;
    sxy += dx * (p.trendKg - my);
    sxx += dx * dx;
  });
  if (sxx === 0) return null;
  return { kgPerWeek: (sxy / sxx) * 7, spanDays, startKg: first.trendKg, endKg: last.trendKg };
}

const weightTrendVsPlan: InsightRule = {
  id: 'weightTrendVsPlan',
  unlockDay: 21,
  solidDays: 21,
  minimumData: '21 days',
  compute(ctx) {
    const goal = ctx.goal;
    if (!goal || goal.template === 'pause') return null;
    const slope = trendSlope(ctx);
    if (!slope) return null;
    const plannedLoss = paceOf(goal, ctx.version);
    const actualLoss = -slope.kgPerWeek;
    const diff = actualLoss - plannedLoss;
    if (Math.abs(diff) < 0.15) return null;
    const headline =
      plannedLoss > 0
        ? actualLoss > 0
          ? `Losing ${fmtKg(actualLoss)} a week vs ${fmtKgRate(plannedLoss)} planned`
          : `Trend is up ${fmtKg(-actualLoss)} a week vs ${fmtKgRate(plannedLoss)} loss planned`
        : `Trend moved ${fmtKg(Math.abs(actualLoss))} a week vs ${fmtKgRate(Math.abs(plannedLoss))} planned`;
    return {
      headline,
      evidence: `Trend ${fmtKg(slope.startKg)} to ${fmtKg(slope.endKg)} over ${plural(slope.spanDays, 'day')}.`,
      linkLabel: '',
      evidenceMealIds: [],
      evidenceEntries: [],
      summary: `Trend over ${plural(slope.spanDays, 'day')}`,
      tryText: diff < 0 ? 'keep logging; your real maintenance will show if the target needs a nudge' : 'a little more food keeps the pace steady',
      impactKcalPerWeek: roundTo10(Math.abs(diff) * 7700),
      confidence: 0.3 * clamp01(slope.spanDays / 28),
      earlyRead: early(ctx, weightTrendVsPlan.solidDays),
      basisDays: slope.spanDays,
      topic: 'weight',
    };
  },
};

/**
 * Reads the shared target check (src/db/targetSuggestion), so the insight, the S37 card and the
 * Today notice agree; it only has something to say while a suggestion waits (not kept).
 */
const maintenanceEstimate: InsightRule = {
  id: 'maintenanceEstimate',
  unlockDay: 21,
  solidDays: 21,
  minimumData: '21 days',
  compute(ctx) {
    const check = ctx.maintenance;
    if (check?.kind !== 'suggestion') return null;
    const { estimate, current } = check;
    const { suggested } = check.proposal;
    const withPace = current.template === 'cut' || current.template === 'custom';
    return {
      headline: `Maintenance is about ${fmtInt(estimate.maintenanceKcal)}, not ${fmtInt(current.maintenanceKcal)}`,
      evidence: maintenanceWorking(estimate),
      linkLabel: '',
      evidenceMealIds: [],
      evidenceEntries: [],
      summary: `${plural(estimate.daysUsed, 'complete day')}`,
      tryText: withPace
        ? `a daily target of ${fmtInt(suggested.dailyKcal)} at your ${fmtKgRate(suggested.paceKgPerWeek)} a week pace`
        : `a daily target of ${fmtInt(suggested.dailyKcal)}`,
      impactKcalPerWeek: roundTo10(Math.abs(estimate.maintenanceKcal - current.maintenanceKcal) * 7),
      confidence: 0.5 * clamp01(estimate.daysUsed / 28),
      earlyRead: early(ctx, maintenanceEstimate.solidDays),
      basisDays: estimate.daysUsed,
      topic: 'maintenance',
    };
  },
};

/** Every starting rule, in the plan's order. */
export const INSIGHT_RULES: readonly InsightRule[] = [
  categoryShare,
  placeComparison,
  recurringCalories,
  weekdayWeekend,
  proteinGaps,
  budgetResult,
  windowVsCalories,
  firstMealDrift,
  grazing,
  lateEating,
  weightTrendVsPlan,
  maintenanceEstimate,
];

