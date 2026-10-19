/**
 * Copy and small rules for S21 Places and S22 Place detail. Pure: formatting goes through
 * src/domain/format.ts; data comes from src/db/places.ts.
 */
import { byId, normaliseName } from '@/data/catalogue';
import type { OrderOption } from '@/db/logging';
import { LEARNING_VISITS, STATS_DAYS, type HomeDish, type LearnedDefault, type PlaceStats } from '@/db/places';
import { potState } from '@/db/pots';
import { fmtApprox, fmtInt, fmtRelativeDay, fmtRm, fmtSigned, roundTo10 } from '@/domain/format';
import type { LogicalDay, MealItem, OilLevel, PlaceType, Pot } from '@/domain/types';
import { itemDisplayName } from '@/screens/Log/library';
import { potServingKcal, servingsText } from '@/screens/Log/PotsSheet';
import { clearsText } from '@/screens/Pots/potModel';

export const PLACE_TYPE_OPTIONS: readonly { value: PlaceType; label: string }[] = [
  { value: 'mamak', label: 'Mamak' },
  { value: 'economyRice', label: 'Economy rice' },
  { value: 'kopitiam', label: 'Kopitiam' },
  { value: 'hawker', label: 'Hawker' },
  { value: 'home', label: 'Home' },
  { value: 'other', label: 'Other' },
];

export const OIL_OPTIONS: readonly { value: OilLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const EMPTY_PLACES_COPY = "Places appear as you log. Type a name in 'Where?' next time you eat out.";

/** "14 visits in 30 days", "1 visit in 30 days", "No visits in 30 days". */
export function visitsLabel(visits: number): string {
  if (visits === 0) return `No visits in ${STATS_DAYS} days`;
  return `${fmtInt(visits)} ${visits === 1 ? 'visit' : 'visits'} in ${STATS_DAYS} days`;
}

/** The card's short form (the list says the window once): "14 visits", "1 visit", "No visits". */
export function visitsShort(visits: number): string {
  if (visits === 0) return 'No visits';
  return `${fmtInt(visits)} ${visits === 1 ? 'visit' : 'visits'}`;
}

export function isLearning(stats: Pick<PlaceStats, 'visits'>): boolean {
  return stats.visits < LEARNING_VISITS;
}

/** "~920" (rounded to 10), or undefined without meals. */
export function avgKcalLabel(kcal: number | null): string | undefined {
  return kcal === null ? undefined : fmtApprox(roundTo10(kcal));
}

/** "RM 16.80 this week", else "RM 122.00 in 30 days", else nothing. */
export function spendLabel(stats: Pick<PlaceStats, 'spendWeekRm' | 'spend30Rm'>): string | undefined {
  if (stats.spendWeekRm > 0) return `${fmtRm(stats.spendWeekRm)} this week`;
  if (stats.spend30Rm > 0) return `${fmtRm(stats.spend30Rm)} in ${STATS_DAYS} days`;
  return undefined;
}

/** "last today", "last yesterday", "last Thu", "last Fri 2 Oct". */
export function lastVisitLabel(day: LogicalDay | undefined, today: LogicalDay): string | undefined {
  if (!day) return undefined;
  const rel = fmtRelativeDay(day, today);
  return `last ${rel === 'Today' || rel === 'Yesterday' ? rel.toLowerCase() : rel}`;
}

/** "14 visits in 30 days · last today". */
export function visitsLine(stats: Pick<PlaceStats, 'visits' | 'lastVisitDay'>, today: LogicalDay): string {
  const last = lastVisitLabel(stats.lastVisitDay, today);
  return last ? `${visitsLabel(stats.visits)} · ${last}` : visitsLabel(stats.visits);
}

// ---------------------------------------------------------------------------
// Usual orders (C35)
// ---------------------------------------------------------------------------

/** Words of a name, without the "(nasi kandar)" style note. */
function words(text: string): string[] {
  return normaliseName(text.replace(/\(.*?\)/g, ' ')).split(' ').filter(Boolean);
}

/** An item the order's name already says (at least half its words are in the name). */
function namedInOrder(item: MealItem, orderWords: ReadonlySet<string>): boolean {
  const own = words(item.name);
  if (own.length === 0) return true;
  const hits = own.filter((w) => orderWords.has(w)).length;
  return hits * 2 >= own.length;
}

/** The parts of an order its name doesn't say, e.g. "Kuah campur" for "Nasi kandar ayam goreng". Rice is implied. */
export function orderExtras(order: Pick<OrderOption, 'name' | 'items'>, max = 2): string[] {
  const orderWords = new Set(words(order.name));
  const extras = order.items.filter((item) => {
    const food = item.catalogueId ? byId(item.catalogueId) : undefined;
    if (food?.category === 'rice') return false;
    return !namedInOrder(item, orderWords);
  });
  return extras.slice(0, max).map((item) => itemDisplayName(item));
}

/** "9 times", "Once", or nothing for a Usual never logged yet. */
export function timesLabel(times: number): string | undefined {
  if (times >= 2) return `${fmtInt(times)} times`;
  if (times === 1) return 'Once';
  return undefined;
}

/** "Kuah campur · 9 times · ~950 kcal". */
export function orderDetailLine(order: Pick<OrderOption, 'name' | 'items' | 'times' | 'kcal'>): string {
  // Sentence case: "Ayam masak merah, kangkung belacan".
  const extras = orderExtras(order).map((text, i) => (i === 0 ? text.charAt(0).toLocaleUpperCase() : text.charAt(0).toLocaleLowerCase()) + text.slice(1));
  const lead = extras.length > 0 ? extras.join(', ') : undefined;
  return [lead, timesLabel(order.times), `${fmtApprox(roundTo10(order.kcal))} kcal`].filter(Boolean).join(' · ');
}

export function orderLoggedToday(order: Pick<OrderOption, 'name'>, loggedToday: readonly string[]): boolean {
  return loggedToday.includes(normaliseName(order.name));
}

// ---------------------------------------------------------------------------
// What you've taught it (C36)
// ---------------------------------------------------------------------------

/** "Mamak big, +30%", "Normal", "Your version · ~420". */
export function learnedValue(row: Pick<LearnedDefault, 'variantLabel' | 'changePct' | 'kcal'>): string {
  if (!row.variantLabel) return `Your version · ${fmtApprox(roundTo10(row.kcal))}`;
  return row.changePct !== undefined ? `${row.variantLabel}, ${fmtSigned(row.changePct)}%` : row.variantLabel;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** "Ikan goreng" · "6 times · ~190 each". */
export function homeDishLine(dish: HomeDish): string {
  return [timesLabel(dish.times), `${fmtApprox(roundTo10(dish.kcal))} each`].filter(Boolean).join(' · ');
}

/**
 * "3 of 8 left · ~500 a serving · clears Sunday": the clear day reads as on the Pots screens
 * (potModel.clearsText), so a pot says the same thing wherever it shows.
 */
export function potLine(pot: Pot, today: LogicalDay): string {
  const clears = clearsText(potState(pot, today), pot.expiresOn, today);
  return `${servingsText(pot.servingsLeft)} of ${fmtInt(pot.servings)} left · ${fmtApprox(roundTo10(potServingKcal(pot)))} a serving · ${clears.charAt(0).toLocaleLowerCase()}${clears.slice(1)}`;
}
