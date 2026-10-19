/**
 * "What should I eat?" (plan §12, S36): three picks with different jobs, plus Surprise me.
 *
 * Plain scoring: budget fit + protein fit + familiarity at this slot + variety (days since you
 * last had it) + timing fit (the window closing) + nearby bonus − recently ignored, weighted by
 * the goal (Cut: budget fit first; Lean bulk: protein first). Lighter swaps come from the
 * catalogue's swap links or lighter portions of something you like. Before there is any
 * history, the picks come from your usuals and the starter catalogue. Nothing is labelled bad:
 * a pick "fits" or is a "tight fit".
 */
import { byId, normaliseName } from '@/data/catalogue';
import { addDays, compareDays, daysBetween, weekdayIndex } from '@/domain/day';
import { fmtInt, roundTo10 } from '@/domain/format';
import { itemCategory } from '@/domain/insights/categories';
import { itemFromCatalogue, itemMacros, sumMacros } from '@/domain/meal';
import type {
  Id,
  Instant,
  LogicalDay,
  MealItem,
  MealLog,
  MealSlot,
  Place,
  SuggestionEvent,
  SuggestionWeights,
  Usual,
} from '@/domain/types';

export type SuggestionRole = SuggestionEvent['role'];
export type SuggestionFit = 'fits' | 'tightFit';

/** normal · little budget left · over budget · no budget (Pause). */
export type IdeasMode = 'normal' | 'little' | 'over' | 'noBudget';

export interface MealSuggestion {
  /** Stable per dish and Place, for React keys and suggestion events. */
  key: string;
  role: SuggestionRole;
  name: string;
  reason: string;
  /** Best guess, rounded to 10. */
  kcal: number;
  proteinG: number;
  placeId?: Id;
  placeName?: string;
  items: MealItem[];
  fit: SuggestionFit;
  score: number;
}

export interface SuggestionInput {
  today: LogicalDay;
  now: Date | Instant;
  slot: MealSlot;
  /** null = no budget today (Pause). */
  leftTodayKcal: number | null;
  proteinLeftG: number | null;
  windowClosesAt?: Instant;
  /** Logged meals, newest last; the last ~60 days is plenty. */
  history: MealLog[];
  usuals: Usual[];
  places: Place[];
  /** Recent suggestion events; "ignored" ones lower a pick's score. */
  events?: SuggestionEvent[];
  weights: SuggestionWeights;
  /** Places you're near now (none until location is wired in). */
  nearbyPlaceIds?: Id[];
}

export interface SuggestionResult {
  /** Your usual · Lighter swap · Something different (fewer only when nothing else exists). */
  cards: MealSuggestion[];
  /** Everything Surprise me can draw from. */
  pool: MealSuggestion[];
  hasHistory: boolean;
  mode: IdeasMode;
}

/** Below this much left, only light options are shown. */
export const LITTLE_BUDGET_KCAL = 300;
/** "You had this 6 times this month". */
const MONTH_DAYS = 30;
/** "Not had in a while". */
const DIFFERENT_MIN_DAYS = 7;
/** A swap has to save at least this much to be worth showing. */
const MIN_SWAP_SAVING = 80;
const IGNORED_WINDOW_DAYS = 14;
const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Starter picks (no history yet, and "Something different")
// ---------------------------------------------------------------------------

interface StarterSpec {
  name: string;
  /** [catalogue id, chip label]. */
  items: readonly (readonly [string, string?])[];
  home?: boolean;
}

const AYAM_BAKAR_SET: StarterSpec = {
  name: 'Ayam bakar, half rice, ulam',
  items: [['ayam-bakar'], ['rice-economy', 'Half'], ['ulam-sambal']],
};
const MEE_SUP: StarterSpec = { name: 'Mee sup ayam', items: [['mee-sup-ayam', 'Normal']] };
const PISANG: StarterSpec = { name: 'Pisang', items: [['pisang', '1 piece']] };
const HALF_BOILED: StarterSpec = { name: 'Telur separuh masak', items: [['half-boiled-eggs', '2 eggs']] };

const STARTERS: Record<MealSlot, readonly StarterSpec[]> = {
  breakfast: [
    { name: 'Roti canai + teh tarik kurang', items: [['roti-canai-dhal', '1 piece'], ['teh-tarik', 'Kurang']] },
    { name: 'Bread, kaya, kopi', items: [['kaya-toast-kopi']] },
    { name: 'Telur separuh masak + roti bakar kaya', items: [['half-boiled-eggs', '2 eggs'], ['kaya-toast']] },
    { name: 'Oats with milk', items: [['oats', 'With milk']], home: true },
    { name: 'Thosai + teh o kurang', items: [['thosai', '1 piece'], ['teh-o', 'Kurang']] },
  ],
  lunch: [
    { name: 'Economy rice, ayam masak merah, kangkung', items: [['rice-economy', '1 scoop'], ['ayam-masak-merah'], ['kangkung-belacan']] },
    MEE_SUP,
    { name: 'Chicken rice, steamed', items: [['chicken-rice', 'Steamed']] },
    AYAM_BAKAR_SET,
  ],
  dinner: [
    AYAM_BAKAR_SET,
    MEE_SUP,
    { name: '3-egg omelette, sayur, small rice', items: [['omelette', '3 eggs'], ['sayur-goreng'], ['nasi-putih', 'Small']], home: true },
    { name: 'Ikan bakar, small rice, sayur', items: [['ikan-bakar', '1 piece'], ['nasi-putih', 'Small'], ['sayur-campur']] },
    { name: 'Sup ayam, small rice', items: [['sup-ayam'], ['nasi-putih', 'Small']], home: true },
  ],
  snack: [PISANG, { name: 'Cut fruit', items: [['buah-potong']] }, { name: 'Kopi o kurang', items: [['kopi-o', 'Kurang']] }],
  supper: [{ name: 'Bubur ayam, small', items: [['bubur-ayam', 'Small']] }, HALF_BOILED, PISANG, { name: 'Maggi sup', items: [['maggi-sup', 'Normal']] }],
};

/** Light options for a little or no budget left, any slot. */
const LIGHT_STARTERS: readonly StarterSpec[] = [
  PISANG,
  { name: 'Cut fruit', items: [['buah-potong']] },
  HALF_BOILED,
  { name: 'Sup ayam', items: [['sup-ayam']], home: true },
  { name: 'Telur rebus', items: [['telur-rebus']], home: true },
  { name: 'Teh o kosong', items: [['teh-o', 'Kosong']] },
];

const SLOT_PHRASE: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'a snack',
  dinner: 'dinner',
  supper: 'supper',
};

/** Slots whose meals make sense for the current one. */
const SLOT_FAMILY: Record<MealSlot, readonly MealSlot[]> = {
  breakfast: ['breakfast'],
  lunch: ['lunch', 'dinner'],
  dinner: ['dinner', 'lunch'],
  snack: ['snack'],
  supper: ['supper', 'snack', 'dinner'],
};

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

type CandidateSource = 'history' | 'usual' | 'starter' | 'swap';

interface Candidate {
  key: string;
  name: string;
  items: MealItem[];
  placeId?: Id;
  source: CandidateSource;
  /** Days with it at this slot in the last 30 days. */
  slotCount: number;
  /** Times in the last 30 days. */
  monthCount: number;
  /** Slots it was eaten at. */
  slots: Set<MealSlot>;
  lastDay?: LogicalDay;
  weekdayCounts: number[];
  /** A Usual saved for this slot (or for any slot). */
  usualForSlot: boolean;
  home: boolean;
  kcal: number;
  proteinG: number;
  /** For swaps: the favourite it lightens and the kcal it saves. */
  base?: Candidate;
  savingKcal?: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dishKey(name: string, placeId: Id | undefined): string {
  return `${normaliseName(name)}|${placeId ?? ''}`;
}

/** A clean copy of a logged item: the same snapshot, no audit fields. */
function cleanItem(item: MealItem, id: string): MealItem {
  const copy: MealItem = {
    id,
    name: item.name,
    unitMacros: { ...item.unitMacros },
    quantity: item.quantity,
    uncertainty: item.uncertainty,
    source: item.source,
  };
  if (item.catalogueId) copy.catalogueId = item.catalogueId;
  if (item.variants) copy.variants = item.variants.map((v) => ({ ...v, macros: { ...v.macros } }));
  if (item.selectedVariant !== undefined) copy.selectedVariant = item.selectedVariant;
  return copy;
}

function totals(items: MealItem[]): { kcal: number; proteinG: number } {
  const macros = sumMacros(items.map(itemMacros));
  return { kcal: macros.kcal, proteinG: macros.proteinG };
}

function withTotals<T extends Omit<Candidate, 'kcal' | 'proteinG'>>(c: T): T & { kcal: number; proteinG: number } {
  return { ...c, ...totals(c.items) };
}

function emptyStats(): Pick<Candidate, 'slotCount' | 'monthCount' | 'slots' | 'weekdayCounts' | 'usualForSlot'> {
  return { slotCount: 0, monthCount: 0, slots: new Set(), weekdayCounts: [0, 0, 0, 0, 0, 0, 0], usualForSlot: false };
}

function homePlaceIds(places: Place[]): Set<Id> {
  return new Set(places.filter((p) => p.type === 'home').map((p) => p.id));
}

function historyCandidates(input: SuggestionInput): Candidate[] {
  const homes = homePlaceIds(input.places);
  const monthStart = addDays(input.today, -(MONTH_DAYS - 1));
  const groups = new Map<string, MealLog[]>();
  for (const meal of input.history) {
    // Guesses have no food detail; pot servings are logged from the pot itself.
    if (meal.isGuess || meal.method === 'pot' || meal.items.length === 0) continue;
    if (meal.items.some((i) => i.pendingEstimate)) continue;
    const key = dishKey(meal.name, meal.placeId);
    groups.set(key, [...(groups.get(key) ?? []), meal]);
  }
  const candidates: Candidate[] = [];
  for (const [key, meals] of groups) {
    const sorted = [...meals].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt));
    const newest = sorted.at(-1);
    if (!newest) continue;
    const stats = emptyStats();
    const slotDays = new Set<LogicalDay>();
    for (const m of sorted) {
      stats.slots.add(m.slot);
      const recent = compareDays(m.logicalDay, monthStart) >= 0;
      if (recent) stats.monthCount += 1;
      if (recent && m.slot === input.slot) slotDays.add(m.logicalDay);
      stats.weekdayCounts[weekdayIndex(m.logicalDay)] = (stats.weekdayCounts[weekdayIndex(m.logicalDay)] ?? 0) + 1;
    }
    stats.slotCount = slotDays.size;
    const candidate: Omit<Candidate, 'kcal' | 'proteinG'> = {
      key,
      name: newest.name,
      items: newest.items.map((item, i) => cleanItem(item, `${key}#${i}`)),
      source: 'history',
      ...stats,
      lastDay: newest.logicalDay,
      home: newest.placeId !== undefined && homes.has(newest.placeId),
    };
    if (newest.placeId) candidate.placeId = newest.placeId;
    candidates.push(withTotals(candidate));
  }
  return candidates;
}

/** Usuals join their history (same name and Place) or stand on their own. */
function mergeUsuals(input: SuggestionInput, history: Candidate[]): Candidate[] {
  const homes = homePlaceIds(input.places);
  const byKey = new Map(history.map((c) => [c.key, c]));
  const extra: Candidate[] = [];
  for (const usual of input.usuals) {
    if (usual.items.length === 0) continue;
    const key = dishKey(usual.name, usual.placeId);
    const forSlot = usual.slot === undefined || usual.slot === input.slot;
    const existing = byKey.get(key);
    if (existing) {
      existing.usualForSlot = existing.usualForSlot || forSlot;
      continue;
    }
    const candidate: Omit<Candidate, 'kcal' | 'proteinG'> = {
      key,
      name: usual.name,
      items: usual.items.map((item, i) => cleanItem(item, `${key}#${i}`)),
      source: 'usual',
      ...emptyStats(),
      usualForSlot: forSlot,
      home: usual.placeId !== undefined && homes.has(usual.placeId),
    };
    if (usual.slot) candidate.slots.add(usual.slot);
    if (usual.placeId) candidate.placeId = usual.placeId;
    extra.push(withTotals(candidate));
  }
  return [...history, ...extra];
}

function starterCandidate(spec: StarterSpec, slot: MealSlot | undefined, places: Place[]): Candidate | undefined {
  const items: MealItem[] = [];
  for (const [index, [id, label]] of spec.items.entries()) {
    const entry = byId(id);
    if (!entry) return undefined;
    const variant = label === undefined ? undefined : entry.variants.findIndex((v) => v.label === label);
    items.push(itemFromCatalogue(entry, { variant: variant !== undefined && variant >= 0 ? variant : undefined, id: `starter:${normaliseName(spec.name)}#${index}` }));
  }
  const home = spec.home === true ? places.find((p) => p.type === 'home') : undefined;
  const candidate: Omit<Candidate, 'kcal' | 'proteinG'> = {
    key: dishKey(spec.name, home?.id),
    name: spec.name,
    items,
    source: 'starter',
    ...emptyStats(),
    home: spec.home === true,
  };
  if (slot) candidate.slots.add(slot);
  if (home) candidate.placeId = home.id;
  return withTotals(candidate);
}

// ---------------------------------------------------------------------------
// Lighter swaps
// ---------------------------------------------------------------------------

/** The lighter chip worth suggesting: smallest rice or noodles, kurang for drinks, the lightest kuah that isn't none. */
function lighterChoice(item: MealItem): { index: number; saving: number } | undefined {
  const variants = item.variants;
  const selected = item.selectedVariant;
  if (!variants || selected === undefined || variants.length < 2) return undefined;
  const category = itemCategory(item);
  let target: number;
  if (category === 'rice' || category === 'noodles') target = 0;
  else if (category === 'drinks') target = variants.findIndex((v) => v.label.toLowerCase() === 'kurang');
  else if (category === 'gravy') target = variants.findIndex((v) => v.label.toLowerCase() !== 'none');
  else return undefined;
  const lighter = variants[target];
  if (target < 0 || target >= selected || !lighter) return undefined;
  const saving = (item.unitMacros.kcal - lighter.macros.kcal) * item.quantity;
  return saving > 0 ? { index: target, saving } : undefined;
}

function withVariant(item: MealItem, index: number): MealItem {
  const variant = item.variants?.[index];
  if (!variant) return item;
  return { ...item, selectedVariant: index, unitMacros: { ...variant.macros } };
}

/** "half rice", "teh tarik kurang", "kuah sikit", "small mee goreng". */
function portionPhrase(item: MealItem): string {
  const label = (item.variants?.[item.selectedVariant ?? -1]?.label ?? '').toLowerCase();
  const category = itemCategory(item);
  if (category === 'rice') return `${label} rice`;
  if (category === 'noodles') return `${label} ${lowerFirst(item.name)}`;
  // "kuah sikit" reads the way people order it, whatever the kuah.
  if (category === 'gravy' && /^kuah\b/i.test(item.name)) return `kuah ${label}`;
  return `${lowerFirst(item.name)} ${label}`;
}

/** Matches `text` as whole words, case-insensitively. */
function wordPattern(text: string): RegExp {
  return new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/** Writes a portion change into the dish name: "Ayam bakar, rice, ulam" → "Ayam bakar, half rice, ulam". */
function renamed(name: string, changed: MealItem[]): string {
  let next = name;
  const tail: string[] = [];
  for (const item of changed) {
    const phrase = portionPhrase(item);
    const word = itemCategory(item) === 'rice' ? /\brice\b/i : wordPattern(item.name);
    if (word.test(next)) next = next.replace(word, phrase);
    else tail.push(phrase);
  }
  return upperFirst([next, ...tail].join(', '));
}

/** Applies lighter chips, biggest saving first, until the dish fits (or nothing is left to lighten). */
function lightenToFit(items: MealItem[], left: number | null): { items: MealItem[]; changed: MealItem[] } {
  let current = items;
  const changed: MealItem[] = [];
  const options = items
    .map((item, i) => ({ i, choice: lighterChoice(item) }))
    .filter((o): o is { i: number; choice: { index: number; saving: number } } => o.choice !== undefined)
    .sort((a, b) => b.choice.saving - a.choice.saving);
  for (const { i, choice } of options) {
    if (left !== null && left > 0 && totals(current).kcal <= left) break;
    const item = current[i];
    if (!item) continue;
    const lighter = withVariant(item, choice.index);
    current = current.map((it, j) => (j === i ? lighter : it));
    changed.push(lighter);
  }
  return { items: current, changed };
}

function swapCandidates(favourites: Candidate[], input: SuggestionInput): Candidate[] {
  const out: Candidate[] = [];
  const left = input.leftTodayKcal;
  const make = (base: Candidate, name: string, items: MealItem[]): void => {
    const { kcal, proteinG } = totals(items);
    const saving = base.kcal - kcal;
    if (saving < MIN_SWAP_SAVING) return;
    const candidate: Candidate = {
      ...base,
      key: `swap:${dishKey(name, base.placeId)}`,
      name,
      items,
      source: 'swap',
      kcal,
      proteinG,
      base,
      savingKcal: saving,
    };
    out.push(candidate);
  };

  for (const base of favourites) {
    // Lighter portions of the same dish.
    const portions = lightenToFit(base.items, left);
    if (portions.changed.length > 0) make(base, renamed(base.name, portions.changed), portions.items);

    // Catalogue swap links (mee goreng → mee sup ayam), then lighter portions if still needed.
    for (const [index, item] of base.items.entries()) {
      const entry = item.catalogueId ? byId(item.catalogueId) : undefined;
      for (const swapId of entry?.swaps ?? []) {
        const swapEntry = byId(swapId);
        if (!swapEntry) continue;
        const swapItem = itemFromCatalogue(swapEntry, { id: `${base.key}#swap${index}`, quantity: item.quantity });
        if (itemMacros(swapItem).kcal >= itemMacros(item).kcal) continue;
        const swapped = base.items.map((it, j) => (j === index ? swapItem : it));
        const lightened = lightenToFit(swapped, left);
        // "Small bihun sup instead of bihun goreng" when the swap itself got a lighter portion.
        const lighterSwap = lightened.changed.find((c) => c.id === swapItem.id);
        const others = lightened.changed.filter((c) => c.id !== swapItem.id);
        const isMain = itemMacros(item).kcal >= base.kcal * 0.4;
        const swapName = lighterSwap ? portionPhrase(lighterSwap) : swapEntry.name;
        const swapWords = `${swapName} instead of ${lowerFirst(item.name)}`;
        let name: string;
        if (isMain) {
          name = others.length > 0 ? `${swapWords}, ${others.map(portionPhrase).join(', ')}` : swapWords;
        } else {
          // A side swap reads best inside the dish name: "Rice, ikan asam pedas, sup sayur".
          const word = wordPattern(item.name);
          const inName = word.test(base.name) ? base.name.replace(word, lowerFirst(swapName)) : `${base.name}, ${lowerFirst(swapWords)}`;
          name = renamed(inName, others);
        }
        make(base, upperFirst(name), lightened.items);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function daysSince(c: Candidate, today: LogicalDay): number | undefined {
  const last = (c.base ?? c).lastDay;
  return last === undefined ? undefined : daysBetween(last, today);
}

function ignoredCounts(events: readonly SuggestionEvent[], today: LogicalDay): Map<string, number> {
  const since = Date.parse(`${addDays(today, -IGNORED_WINDOW_DAYS)}T00:00:00.000Z`);
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.outcome !== 'ignored' || Date.parse(e.at) < since) continue;
    const key = normaliseName(e.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

interface ScoreContext {
  input: SuggestionInput;
  maxFamiliar: number;
  closesSoon: boolean;
  ignored: Map<string, number>;
  nearby: Set<Id>;
}

function scoreOf(c: Candidate, sc: ScoreContext): number {
  const { input } = sc;
  const w = input.weights;
  const left = input.leftTodayKcal;
  const budget =
    left === null
      ? 0.5
      : left <= 0
        ? clamp01(1 - c.kcal / 800)
        : c.kcal <= left
          ? 0.6 + 0.4 * (c.kcal / left)
          : clamp01(1 - (c.kcal - left) / 250) * 0.5;
  const proteinLeft = input.proteinLeftG;
  const protein = proteinLeft === null || proteinLeft <= 0 ? 0.5 : clamp01(c.proteinG / Math.max(15, proteinLeft * 0.6));
  const source = c.base ?? c;
  const familiar = source.slotCount + (source.usualForSlot ? 2 : 0);
  const familiarity = c.source === 'starter' ? 0 : clamp01(familiar / Math.max(1, sc.maxFamiliar));
  const since = daysSince(c, input.today);
  const variety = since === undefined ? 0.8 : clamp01(since / 14);
  const inSlot = source.slots.has(input.slot) || c.source === 'starter';
  const timing = (inSlot ? 1 : 0.4) * (sc.closesSoon && c.kcal > 500 ? 0.6 : 1);
  const nearby = c.placeId !== undefined && sc.nearby.has(c.placeId) ? 1 : 0;
  const ignored = Math.min(0.3, 0.1 * (sc.ignored.get(normaliseName(c.name)) ?? 0));
  return (
    w.budget * budget + w.protein * protein + w.familiarity * familiarity + w.variety * variety + w.timing * timing + w.nearby * nearby - ignored
  );
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

function favouriteWeekday(c: Candidate): string | undefined {
  const total = c.weekdayCounts.reduce((a, b) => a + b, 0);
  if (total < 2) return undefined;
  const max = Math.max(...c.weekdayCounts);
  const index = c.weekdayCounts.indexOf(max);
  return max / total >= 0.5 ? WEEKDAY_NAMES[index] : undefined;
}

function reasonFor(c: Candidate, role: SuggestionRole, input: SuggestionInput, mode: IdeasMode): string {
  if (c.source === 'swap' && c.base) {
    const saving = fmtInt(roundTo10(c.savingKcal ?? 0));
    const weekday = favouriteWeekday(c.base);
    if (weekday) return `Your ${weekday} favourite, about ${saving} kcal lighter`;
    const usual = c.base.monthCount >= 3 ? 'usual ' : '';
    return `Like your ${usual}${lowerFirst(c.base.name)}, about ${saving} kcal lighter`;
  }
  if (c.source === 'starter') {
    const home = c.home ? '. Easy to make at home' : '';
    if (mode === 'over') return 'One of the lightest options';
    if (mode === 'little') return "Light, and fits what's left";
    if (role === 'usual') return `A common pick for ${SLOT_PHRASE[input.slot]}`;
    if (role === 'lighterSwap') return "Light, and fits what's left";
    return `Something new to try${home}`;
  }
  const since = daysSince(c, input.today);
  if (role === 'different' && since !== undefined && since >= DIFFERENT_MIN_DAYS) {
    return `Not had in ${fmtInt(since)} days${c.home ? '. Easy to make at home' : ''}`;
  }
  if (c.monthCount >= 2) return `You had this ${fmtInt(c.monthCount)} times this month`;
  if (c.source === 'usual' || c.usualForSlot) return 'One of your usuals';
  return since === undefined || since === 0 ? 'You had this recently' : `Last had ${fmtInt(since)} days ago`;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export function ideasMode(leftTodayKcal: number | null): IdeasMode {
  if (leftTodayKcal === null) return 'noBudget';
  if (leftTodayKcal <= 0) return 'over';
  if (leftTodayKcal < LITTLE_BUDGET_KCAL) return 'little';
  return 'normal';
}

function toSuggestion(c: Candidate, role: SuggestionRole, input: SuggestionInput, score: number, mode: IdeasMode): MealSuggestion {
  const kcal = roundTo10(c.kcal);
  const left = input.leftTodayKcal;
  const suggestion: MealSuggestion = {
    key: c.key,
    role,
    name: c.name,
    reason: reasonFor(c, role, input, mode),
    kcal,
    proteinG: Math.round(c.proteinG),
    items: c.items.map((item) => ({ ...item, unitMacros: { ...item.unitMacros } })),
    fit: left === null || kcal <= left ? 'fits' : 'tightFit',
    score,
  };
  if (c.placeId) {
    suggestion.placeId = c.placeId;
    const place = input.places.find((p) => p.id === c.placeId);
    if (place) suggestion.placeName = place.name;
  }
  return suggestion;
}

export function suggestMeals(input: SuggestionInput): SuggestionResult {
  const mode = ideasMode(input.leftTodayKcal);
  const left = input.leftTodayKcal;
  const history = historyCandidates(input);
  const known = mergeUsuals(input, history);
  const family = new Set(SLOT_FAMILY[input.slot]);
  // A drink on its own is a snack, not a meal idea.
  const mealSlot = input.slot !== 'snack';
  const isMeal = (c: Candidate): boolean => !mealSlot || c.items.some((i) => itemCategory(i) !== 'drinks');
  const forSlot = (c: Candidate): boolean => isMeal(c) && (c.usualForSlot || [...c.slots].some((s) => family.has(s)));

  const starters = STARTERS[input.slot]
    .map((s) => starterCandidate(s, input.slot, input.places))
    .filter((c): c is Candidate => c !== undefined);
  const lightStarters = LIGHT_STARTERS.map((s) => starterCandidate(s, undefined, input.places)).filter(
    (c): c is Candidate => c !== undefined && isMeal(c),
  );

  const familiar = known.filter((c) => isMeal(c) && (c.slotCount >= 2 || c.usualForSlot));
  const favourites = known
    .filter(forSlot)
    .sort((a, b) => b.slotCount - a.slotCount || b.monthCount - a.monthCount)
    .slice(0, 8);
  const swaps = swapCandidates(favourites, input);
  const closesAt = input.windowClosesAt ? Date.parse(input.windowClosesAt) : NaN;
  const nowMs = typeof input.now === 'string' ? Date.parse(input.now) : input.now.getTime();
  const sc: ScoreContext = {
    input,
    maxFamiliar: Math.max(1, ...known.map((c) => c.slotCount + (c.usualForSlot ? 2 : 0))),
    closesSoon: Number.isFinite(closesAt) && closesAt - nowMs < 120 * MS_PER_MINUTE,
    ignored: ignoredCounts(input.events ?? [], input.today),
    nearby: new Set(input.nearbyPlaceIds ?? []),
  };
  const score = (c: Candidate): number => scoreOf(c, sc);

  const used = new Set<string>();
  const usedNames = new Set<string>();
  const isFree = (c: Candidate): boolean => !used.has(c.key) && !usedNames.has(normaliseName(c.name));
  const fits = (c: Candidate): boolean => left === null || roundTo10(c.kcal) <= left;
  const best = (pool: Candidate[], bonus: (c: Candidate) => number = () => 0): Candidate | undefined => {
    const free = pool.filter(isFree);
    if (mode === 'over') return [...free].sort((a, b) => a.kcal - b.kcal || score(b) - score(a))[0];
    return free.filter(fits).sort((a, b) => score(b) + bonus(b) - (score(a) + bonus(a)))[0];
  };
  const fallbackPool = mode === 'little' || mode === 'over' ? [...starters, ...lightStarters] : starters;
  const take = (role: SuggestionRole, primary: Candidate[], bonus?: (c: Candidate) => number): MealSuggestion | undefined => {
    const chosen = best(primary, bonus) ?? best(fallbackPool, bonus) ?? best([...known.filter(isMeal), ...lightStarters], bonus);
    if (!chosen) return undefined;
    used.add(chosen.key);
    usedNames.add(normaliseName(chosen.name));
    if (chosen.base) used.add(chosen.base.key);
    return toSuggestion(chosen, role, input, score(chosen), mode);
  };

  const cards: MealSuggestion[] = [];
  const usualPool = familiar.length > 0 ? familiar : known.filter((c) => isMeal(c) && c.source === 'usual');
  const usual = take('usual', usualPool);
  if (usual) cards.push(usual);
  // A lighter take on the dish just picked as the usual would repeat it.
  const lighter = take('lighterSwap', swaps.filter((s) => !used.has(s.base?.key ?? '')));
  if (lighter) cards.push(lighter);
  const notLately = known.filter((c) => forSlot(c) && (daysSince(c, input.today) ?? 0) >= DIFFERENT_MIN_DAYS);
  const different = take('different', [...notLately, ...starters], (c) => (c.home ? 0.1 : 0) + (c.source === 'starter' ? 0.02 : 0));
  if (different) cards.push(different);

  const pool = [...known.filter(forSlot), ...swaps, ...starters]
    .filter((c, i, all) => all.findIndex((o) => o.key === c.key) === i)
    .map((c) => toSuggestion(c, 'surprise', input, score(c), mode));

  return { cards, pool, hasHistory: history.length > 0, mode };
}

/**
 * Surprise me: a random pick from the pool that isn't already on screen, preferring ones that
 * fit. `random` is injectable for tests.
 */
export function surprisePick(
  pool: readonly MealSuggestion[],
  excludeKeys: ReadonlySet<string>,
  random: () => number = Math.random,
): MealSuggestion | undefined {
  const free = pool.filter((s) => !excludeKeys.has(s.key));
  const fitting = free.filter((s) => s.fit === 'fits');
  const from = fitting.length > 0 ? fitting : free;
  if (from.length === 0) return undefined;
  const index = Math.min(from.length - 1, Math.floor(random() * from.length));
  const pick = from[index];
  return pick ? { ...pick, role: 'surprise' } : undefined;
}
