/**
 * Kira Makan domain model.
 *
 * This file is the shared contract between the engine (src/domain), the data layer (src/db),
 * the estimator (src/estimate) and the UI. Behaviour rules come from
 * personal_food_tracker_product_plan.md (v2); names match design_handoff.md where they overlap.
 *
 * Conventions
 * - `LogicalDay` is 'YYYY-MM-DD' in the user's time zone, after applying the day rollover
 *   (default 5am), so a 2am supper belongs to the previous day.
 * - `Instant` is a UTC ISO-8601 timestamp string.
 * - All energy is kcal; all macros are grams.
 */

export type Id = string;
export type LogicalDay = string;
export type Instant = string;

// ---------------------------------------------------------------------------
// Nutrition primitives
// ---------------------------------------------------------------------------

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const ZERO_MACROS: Macros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** Inclusive kcal range, rounded to the nearest 10 for display. */
export interface KcalRange {
  low: number;
  high: number;
}

/** Where a nutrition value came from (C24 SourceTag). */
export type SourceTag = 'yourCorrection' | 'catalogue' | 'myfcd' | 'sgfoodid' | 'usda' | 'aiGuess';

export type FoodCategory =
  | 'rice'
  | 'noodles'
  | 'bread'
  | 'drinks'
  | 'kuih'
  | 'protein'
  | 'vegetables'
  | 'tofuEgg'
  | 'gravy'
  | 'soup'
  | 'snack'
  | 'fruit'
  | 'home'
  | 'other';

// ---------------------------------------------------------------------------
// Catalogue (layer 2 of the four food-data layers)
// ---------------------------------------------------------------------------

/**
 * One selectable chip for an item (C22 PortionChips). Macros are absolute for that choice,
 * e.g. Kuah campur › Banjir = 220 kcal, Rice › Mamak big = 430 kcal.
 */
export interface Variant {
  id: string;
  label: string;
  grams?: number;
  macros: Macros;
}

export interface CatalogueItem {
  id: string;
  /** Display name, sentence case, local words as-is ("Kuah campur", "Teh o ais"). */
  name: string;
  /** Other names people type ("teh-o ice", "kopi o peng"). Lowercase. */
  aliases: string[];
  category: FoodCategory;
  /** Unit wording used in captions: "a piece", "a scoop", "a cup", "a plate", "a senduk". */
  unit: string;
  /** Mutually exclusive portion / sugar / gravy choices. At least one. */
  variants: Variant[];
  defaultVariant: number;
  /** Relative uncertainty for the range, e.g. 0.15 = ±15%. Wider for oily/mixed dishes. */
  uncertainty: number;
  source: SourceTag;
  note?: string;
  /** Ids of lighter related items, used for "Lighter swap" suggestions. */
  swaps?: string[];
  /** Economy-rice tray dish shown in the plate builder (S24). */
  plateGroup?: 'protein' | 'vegetables' | 'tofuEgg';
  /** Follow-up question worth asking when this item is uncertain (C25). */
  question?: string;
}

// ---------------------------------------------------------------------------
// Profile and settings
// ---------------------------------------------------------------------------

export type Sex = 'male' | 'female';

/** Activity on a day WITHOUT workouts (workouts are added separately). */
export type ActivityLevel = 'sedentary' | 'light' | 'active';

export type ThemePreference = 'system' | 'light' | 'dark';

export type AiEstimateMode = 'auto' | 'always' | 'off';

export interface Profile {
  id: 'me';
  name?: string;
  age: number;
  sex: Sex;
  /** An estimate is fine (5 cm error ≈ 30 kcal/day). */
  heightCm: number;
  weightKgAtSetup: number;
  activity: ActivityLevel;
  /** IANA zone, default 'Asia/Kuala_Lumpur'. */
  timeZone: string;
  /** Hour (0–23) when the logical day rolls over. Default 5. */
  rolloverHour: number;
  /** 1 = Monday. The budget week always starts on this weekday. */
  weekStartsOn: 1;
  /** No day's allowance goes below this. */
  dailyMinimumKcal: number;
  theme: ThemePreference;
  /**
   * When typed or photographed meals go to the AI estimator (undefined = 'auto').
   * auto: only when the offline estimator can't match everything · always · off (offline only).
   */
  aiEstimates?: AiEstimateMode;
  keepPhotos: boolean;
  useLocation: boolean;
  /** First logical day the app was used (drives "day N" and unlock progress). */
  startedOn: LogicalDay;
  setupCompletedAt?: Instant;
  /** When true, the clock is pinned and sample data is shown (see src/domain/clock.ts). */
  demoMode?: boolean;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type GoalTemplate = 'cut' | 'festive' | 'leanBulk' | 'pause' | 'custom';

/** What the Today hero shows (C07). */
export type HeroMetric = 'kcalLeft' | 'proteinLeft' | 'daysInRange' | 'none';

export type GoalStatus = 'active' | 'saved' | 'draft' | 'template' | 'ended';

export interface TimingRules {
  /** Eating window length cap in hours (Cut default 12). */
  maxWindowHours?: number;
  /** Last meal at least this many hours before a tapped sleep time (Cut default 2). */
  minHoursBeforeSleep?: number;
  /** Flag days with more eating occasions than this (Cut default 5). */
  maxEatingOccasions?: number;
  /** Optional fixed window in minutes after midnight, for custom goals. */
  fixedWindow?: { startMin: number; endMin: number };
}

/** C48 insight toggles: groups of insight rules a goal can turn off. */
export type InsightGroup = 'food' | 'protein' | 'timing' | 'weight';

export interface SuggestionWeights {
  budget: number;
  protein: number;
  familiarity: number;
  variety: number;
  timing: number;
  nearby: number;
}

export interface Goal {
  id: Id;
  name: string;
  template: GoalTemplate;
  heroMetric: HeroMetric;
  status: GoalStatus;
  /** kg per week; positive = lose (cut), negative = gain (bulk), 0 = maintain. */
  paceKgPerWeek: number;
  /** Festive maintain: allowed band around maintenance, e.g. 0.1 = ±10%. */
  rangePct?: number;
  /** Lean bulk: surplus over maintenance in kcal/day. */
  surplusKcal?: number;
  timing: TimingRules;
  suggestionWeights: SuggestionWeights;
  endCondition?: { date?: LogicalDay; weightKg?: number };
  /** Insight groups turned off for this goal (C48). Missing = all on. */
  insightsOff?: InsightGroup[];
  createdAt: Instant;
}

/** Target values over time. A new row for every approved change (never edited in place). */
export interface GoalVersion {
  id: Id;
  goalId: Id;
  effectiveFrom: LogicalDay;
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  maintenanceKcal: number;
  /** kg a week the target was set at (new versions only); see paceOf(). */
  paceKgPerWeek?: number;
  reason: 'setup' | 'approvedSuggestion' | 'manualEdit';
  createdAt: Instant;
}

/** Which goal was active, from when. A switch starts at the next rollover. */
export interface GoalPeriod {
  id: Id;
  goalId: Id;
  from: LogicalDay;
  /** Exclusive end; undefined = still active. */
  to?: LogicalDay;
  /** When the switch that made it was booked; breaks ties between periods starting the same day (later wins). Missing on older rows. */
  createdAt?: Instant;
}

// ---------------------------------------------------------------------------
// Places, usuals, pots
// ---------------------------------------------------------------------------

export type PlaceType = 'mamak' | 'economyRice' | 'kopitiam' | 'hawker' | 'home' | 'other';
export type OilLevel = 'low' | 'medium' | 'high';

export interface Place {
  id: Id;
  name: string;
  type: PlaceType;
  /** Saved once, when the Place is created on-site. Never a location history. */
  coords?: { lat: number; lng: number };
  /** Learned defaults: catalogue item id → variant index (e.g. rice → Mamak big). */
  defaultVariants: Record<string, number>;
  oilLevel?: OilLevel;
  typicalPriceRm?: number;
  /** Economy-rice Places: catalogue ids of the trays this stall usually has. */
  trays?: string[];
  createdAt: Instant;
}

export interface Usual {
  id: Id;
  name: string;
  placeId?: Id;
  slot?: MealSlot;
  items: MealItem[];
  useCount: number;
  /** Manual order on the Usuals screen (S23); lower first. Unset sorts after set, by use count. */
  sortIndex?: number;
  createdAt: Instant;
}

export interface PotIngredient {
  id: Id;
  name: string;
  amount: string;
  macros: Macros;
  source: SourceTag;
  /** Oil gets its own chips (2 / 4 / 6 tbsp). */
  isOil?: boolean;
}

export interface Pot {
  id: Id;
  name: string;
  recipeText: string;
  ingredients: PotIngredient[];
  servings: number;
  servingsLeft: number;
  cookedOn: LogicalDay;
  /** Clears itself after 4 days. */
  expiresOn: LogicalDay;
  createdAt: Instant;
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supper';

export type LogMethod = 'text' | 'photo' | 'plate' | 'usual' | 'placeOrder' | 'pot' | 'idea' | 'manual' | 'guess';

export type Finished = 'all' | 'most' | 'half';

/** One line on the review screen (C21) and one row of meal_log_items. */
export interface MealItem {
  id: Id;
  name: string;
  catalogueId?: string;
  /** Snapshot of the chip options at log time (so old meals never change). */
  variants?: Variant[];
  selectedVariant?: number;
  /** Macros for ONE unit of the selected variant (or the fixed item). */
  unitMacros: Macros;
  /** e.g. 2 for "Ayam goreng ×2" in the plate builder. */
  quantity: number;
  /** Relative uncertainty, e.g. 0.15. */
  uncertainty: number;
  source: SourceTag;
  /** Follow-up question still open on the review screen (C25). */
  question?: string;
  /** The estimate before any user correction (kept for audit). */
  original?: { selectedVariant?: number; quantity: number; unitMacros: Macros };
  edited?: boolean;
  /** Offline: the AI estimate hasn't run yet. */
  pendingEstimate?: boolean;
}

export type SyncState = 'local' | 'pending' | 'synced';

export interface MealLog {
  id: Id;
  /** When it was eaten (UTC). */
  eatenAt: Instant;
  logicalDay: LogicalDay;
  slot: MealSlot;
  /** Short display name for the ledger row ("Economy rice", "Roti canai + teh tarik"). */
  name: string;
  items: MealItem[];
  method: LogMethod;
  placeId?: Id;
  priceRm?: number;
  photoId?: Id;
  /** Original typed text (text and photo-caption flows). */
  text?: string;
  finished: Finished;
  /** Filled in by the check-in ("Fill in a typical one"). */
  isGuess?: boolean;
  /**
   * A pot serving (method 'pot'): the pot it came out of and how many servings it took, so
   * deleting the meal puts them back and logging it again takes more. Unset for older pot meals.
   */
  fromPot?: { potId: Id; servings: number };
  createdAt: Instant;
  updatedAt: Instant;
  /**
   * @deprecated Still written, but nothing reads it: sync keeps its own queue (the syncOutbox
   * table), and the "Waiting to sync" badge comes from there (usePendingMealIds in
   * src/sync/hooks.ts). Sync never sends this field, so each device keeps its own value.
   */
  syncState: SyncState;
}

/**
 * Layer 1 of the food data: your corrections, saved with a scope.
 * Created when the user accepts "Make this the default here?" (C28) or saves a home version.
 */
export interface PersonalItem {
  id: Id;
  name: string;
  catalogueId?: string;
  /** 'place' = only at placeId; 'dish' = everywhere. */
  scope: 'place' | 'dish';
  placeId?: Id;
  variants?: Variant[];
  selectedVariant?: number;
  unitMacros: Macros;
  uncertainty: number;
  /** How many times the user has made this correction. */
  corrections: number;
  createdAt: Instant;
  updatedAt: Instant;
}

// ---------------------------------------------------------------------------
// Weight, workouts, bonuses
// ---------------------------------------------------------------------------

export interface WeightLog {
  id: Id;
  measuredAt: Instant;
  logicalDay: LogicalDay;
  kg: number;
}

export type WorkoutType =
  | 'walking'
  | 'futsal'
  | 'badminton'
  | 'gym'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'other';

export type Intensity = 'easy' | 'moderate' | 'hard';

export interface Workout {
  id: Id;
  logicalDay: LogicalDay;
  type: WorkoutType;
  minutes: number;
  intensity: Intensity;
  /** Net kcal = (MET − 1) × kg × hours. Added to the week's budget. */
  netKcal: number;
  createdAt: Instant;
}

export interface OneOffBonus {
  id: Id;
  logicalDay: LogicalDay;
  kcal: number;
  reason: string;
  createdAt: Instant;
}

// ---------------------------------------------------------------------------
// Day status (plan §10.1) and week planning
// ---------------------------------------------------------------------------

export type DayStatusKind = 'complete' | 'guess' | 'notCounted' | 'paused' | 'unconfirmed';

export interface DayRecord {
  logicalDay: LogicalDay;
  status: DayStatusKind;
  confirmedAt?: Instant;
  /** Optional "Going to sleep" tap (C61). */
  sleepAt?: Instant;
}

export interface WeekPlan {
  /** Monday of the budget week. */
  weekStart: LogicalDay;
  /** Day the user is saving for (S18), if any. */
  makanDay?: LogicalDay;
  /** This week's focus picked in the weekly review (C44). */
  focus?: { label: string; sub: string; ruleId?: string };
}

// ---------------------------------------------------------------------------
// Insights and suggestions
// ---------------------------------------------------------------------------

export interface InsightFeedback {
  ruleId: string;
  /** 'keepCurrent' is "Keep current" on the target suggestion (ruleId 'targetSuggestion'). */
  feedback: 'useful' | 'notForMe' | 'keepCurrent';
  at: Instant;
  /** "Not for me" pauses the rule for about 4 weeks; "Keep current" hides the suggestion as long. */
  pausedUntil?: LogicalDay;
  /** "Keep current" on the target suggestion (ruleId 'targetSuggestion'): the day, the estimate and the version it answered. */
  keptTarget?: { keptOn: LogicalDay; maintenanceKcal: number; versionId: Id };
}

export interface SuggestionEvent {
  id: Id;
  at: Instant;
  role: 'usual' | 'lighterSwap' | 'different' | 'surprise';
  name: string;
  outcome: 'shown' | 'taken' | 'ignored';
}
