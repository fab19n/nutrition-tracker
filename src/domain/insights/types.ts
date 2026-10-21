/**
 * Insight engine contracts (plan §13, handoff S31–S33).
 *
 * Insights are written by fixed rules, never by AI: each rule has a minimum amount of data,
 * a calculation, a kcal-per-week impact, a confidence and a sentence template, and points at
 * the meals behind it (the evidence sheet, S32).
 */
import type { WeekBudget } from '@/domain/budget';
import type { FocusRuleId } from '@/domain/focus';
import type { TargetCheck } from '@/domain/maintenance';
import type { SlotBaselines } from '@/domain/timing';
import type { TrendPoint } from '@/domain/trend';
import type { DayStatusKind, Goal, GoalVersion, Id, Instant, LogicalDay, MealLog, Place } from '@/domain/types';

/** Weekly focus rules shared by Today (C44) and the weekly review (S33). WeekPlan.focus.ruleId is one of these. */
export type { FocusRuleId };

export type InsightRuleId =
  | 'categoryShare'
  | 'placeComparison'
  | 'recurringCalories'
  | 'weekdayWeekend'
  | 'proteinGaps'
  | 'budgetResult'
  | 'windowVsCalories'
  | 'firstMealDrift'
  | 'grazing'
  | 'lateEating'
  | 'weightTrendVsPlan'
  | 'maintenanceEstimate';

/** "Where it came from" groups (S31). */
export type CategoryGroupId = 'rice' | 'home' | 'drinks' | 'noodles' | 'snacks' | 'other';

/** One logical day as the rules see it. */
export interface InsightDay {
  day: LogicalDay;
  /** null = no record yet. */
  status: DayStatusKind | null;
  /** Every meal that day, in the order eaten (guesses included; rules skip them where it matters). */
  meals: MealLog[];
  eatenKcal: number;
  workoutKcal: number;
  sleepAt?: Instant;
}

/** Which stretch of days the insights describe. */
export type InsightPeriodKind =
  /** The last complete budget week (Mon–Sun), the normal case. */
  | 'week'
  /** The 7 days up to yesterday, when last week was mostly before the app was in use. */
  | 'last7'
  /** Days 1–6: everything so far, today included. */
  | 'soFar';

export interface InsightPeriod {
  from: LogicalDay;
  to: LogicalDay;
  kind: InsightPeriodKind;
}

export interface InsightContext {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  startedOn: LogicalDay;
  /** Day of use, 1 on startedOn ("Week 3 · day 19"). */
  dayNumber: number;
  /** Days marked complete since startedOn, before today. Drives "Early read" and unlock progress. */
  completeDays: number;
  period: InsightPeriod;
  /** Days of the period that are in use (on or after startedOn), oldest first. */
  periodDays: InsightDay[];
  /** The 28 days before today that are in use, oldest first. */
  historyDays: InsightDay[];
  places: Place[];
  goal?: Goal;
  version?: GoalVersion;
  /** Budget of the period's week (kind 'week'), for the budget result. */
  budget?: WeekBudget;
  /** Every weigh-in with its trend, oldest first. */
  trend: TrendPoint[];
  /** Your own meal times, from complete days before today. */
  baselines: SlotBaselines;
  /** The target check as of today (src/db/targetSuggestion), so the rule and the card agree. */
  maintenance?: TargetCheck;
}

/** One meal behind an insight, with the part of it the insight is about. */
export interface EvidenceEntry {
  mealId: Id;
  /** kcal of the part that counts (the drink in "roti canai + teh tarik"); the whole meal for visits. */
  kcal: number;
  /** Row name override, e.g. "Teh tarik · Kurang"; the meal name when absent. */
  label?: string;
}

/** What a rule's calculation returns. */
export interface InsightFinding {
  /** "Drinks were 17% of your calories". */
  headline: string;
  /** "Teh tarik 8 times, milo ais 3 times, ~2,170 kcal." */
  evidence: string;
  /** "See 11 drinks". */
  linkLabel: string;
  evidenceMealIds: Id[];
  evidenceEntries: EvidenceEntry[];
  /** Evidence sheet summary: "11 drinks last week · ~2,170 kcal". */
  summary: string;
  /** Without the "Try:" prefix: "kurang manis for half of them, about 240 kcal a week less". */
  tryText: string;
  /** The weekly focus this insight maps to, when there is one. */
  focus?: FocusRuleId;
  /** Sub-line for the focus option in the weekly review: "About 240 kcal a week less". */
  focusSub?: string;
  /** What following the "Try" would change, kcal a week (ranking only). */
  impactKcalPerWeek: number;
  /** 0–1: how sure the rule is, from the amount of data behind it. */
  confidence: number;
  /** Based on thin data: labelled "Early read". */
  earlyRead: boolean;
  /** Days of data behind it (the "based on 9 days" meta). */
  basisDays: number;
  /** Overrides "N days" in the meta, e.g. "4 visits". */
  basisLabel?: string;
  /** Highlights this group in "Where it came from". */
  category?: CategoryGroupId;
  /** Insights about the same thing (drinks share, teh tarik recurring) share a topic; only the best one is shown. */
  topic: string;
}

export interface InsightRule {
  id: InsightRuleId;
  /** Day of use when the rule can first appear (plan §13.3: day 1 / 7 / 14 / 21). */
  unlockDay: 1 | 7 | 14 | 21;
  /** Complete days needed before the read is solid; fewer → "Early read". */
  solidDays: number;
  /** Plain-words minimum data (plan §13.4). */
  minimumData: string;
  compute(ctx: InsightContext): InsightFinding | null;
}

export interface RankedInsight extends InsightFinding {
  ruleId: InsightRuleId;
  /** impactKcalPerWeek × confidence. */
  score: number;
  /** Footer meta: "Early read · based on 9 days" or "Based on 7 days". */
  meta: string;
}
