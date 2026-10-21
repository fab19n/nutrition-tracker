/**
 * Runs the insight rules and ranks what they found (plan §13.2): kcal a week × confidence,
 * one insight per topic, top 3. Rules the user paused with "Not for me" stay quiet for about
 * 4 weeks; rules not yet unlocked (day 1 / 7 / 14 / 21 of use) don't run.
 */
import { addDays, compareDays } from '@/domain/day';
import { fmtInt } from '@/domain/format';
import { MIN_COMPLETE_DAYS } from '@/domain/maintenance';
import type { InsightFeedback, LogicalDay } from '@/domain/types';
import { defaultFocusSub, focusLabel, FOCUS_RULE_IDS, type WeeklyFocus } from './focusRules';
import { rulesOffFor } from './groups';
import { INSIGHT_RULES } from './rules';
import type { FocusRuleId, InsightContext, InsightRule, InsightRuleId, RankedInsight } from './types';

/** "Not for me" pauses a rule for about 4 weeks. */
export const NOT_FOR_ME_PAUSE_DAYS = 28;
export const TOP_INSIGHTS = 3;

export function pausedUntilFrom(today: LogicalDay): LogicalDay {
  return addDays(today, NOT_FOR_ME_PAUSE_DAYS);
}

/** Rules paused on `today` by a "Not for me". */
export function pausedRuleIds(feedback: readonly InsightFeedback[], today: LogicalDay): Set<string> {
  return new Set(
    feedback
      .filter((f) => f.feedback === 'notForMe' && f.pausedUntil !== undefined && compareDays(today, f.pausedUntil) < 0)
      .map((f) => f.ruleId),
  );
}

export function isUnlocked(rule: Pick<InsightRule, 'unlockDay'>, ctx: Pick<InsightContext, 'dayNumber'>): boolean {
  return ctx.dayNumber >= rule.unlockDay;
}

function metaOf(basis: string, earlyRead: boolean): string {
  return earlyRead ? `Early read · based on ${basis}` : `Based on ${basis}`;
}

export interface InsightEvaluation {
  /** Every unlocked rule that found something, paused ones included (the evidence sheet reads these), best first. */
  all: RankedInsight[];
  /** What the feed shows: not paused, not turned off by the goal (C48), one per topic, best first. */
  ranked: RankedInsight[];
  /** The top 3 of `ranked`. */
  top: RankedInsight[];
  paused: Set<string>;
}

export function evaluateInsights(
  ctx: InsightContext,
  opts: { feedback?: readonly InsightFeedback[]; rules?: readonly InsightRule[]; limit?: number } = {},
): InsightEvaluation {
  const rules = opts.rules ?? INSIGHT_RULES;
  const paused = pausedRuleIds(opts.feedback ?? [], ctx.today);
  // Groups the goal turned off (C48) leave the feed like a paused rule; `all` still holds them.
  const off = rulesOffFor(ctx.goal);
  const all: RankedInsight[] = [];
  for (const rule of rules) {
    if (!isUnlocked(rule, ctx)) continue;
    const finding = rule.compute(ctx);
    if (!finding) continue;
    const basis = finding.basisLabel ?? `${fmtInt(finding.basisDays)} ${finding.basisDays === 1 ? 'day' : 'days'}`;
    all.push({
      ...finding,
      ruleId: rule.id,
      score: Math.max(0, finding.impactKcalPerWeek) * Math.min(1, Math.max(0, finding.confidence)),
      meta: metaOf(basis, finding.earlyRead),
    });
  }
  all.sort((a, b) => b.score - a.score || rules.findIndex((r) => r.id === a.ruleId) - rules.findIndex((r) => r.id === b.ruleId));

  const topics = new Set<string>();
  const ranked: RankedInsight[] = [];
  for (const insight of all) {
    if (paused.has(insight.ruleId) || off.has(insight.ruleId) || topics.has(insight.topic)) continue;
    topics.add(insight.topic);
    ranked.push(insight);
  }
  return { all, ranked, top: ranked.slice(0, opts.limit ?? TOP_INSIGHTS), paused };
}

export function findInsight(evaluation: InsightEvaluation, ruleId: string): RankedInsight | undefined {
  return evaluation.all.find((i) => i.ruleId === (ruleId as InsightRuleId));
}

// ---------------------------------------------------------------------------
// Unlock progress (C15) and weekly focus options (S33 step 3)
// ---------------------------------------------------------------------------

export interface UnlockItem {
  label: string;
  /** Complete days so far (or weigh-ins, per `unit`). */
  have: number;
  need: number;
  /** What `have` counts: "days" when absent. */
  unit?: string;
}

/**
 * "Your real maintenance" as the target check (S37, C45) sees it, so the list never contradicts
 * the card: the complete days in its window, the weigh-ins it still needs in its place, or
 * unlocked once there is an estimate. Without a check (no goal, paused), by complete days.
 */
function maintenanceUnlock(ctx: Pick<InsightContext, 'completeDays' | 'maintenance'>): UnlockItem {
  const label = 'Your real maintenance';
  const check = ctx.maintenance;
  switch (check?.kind) {
    case 'tooEarly':
      return { label, have: check.completeDays, need: check.needDays };
    case 'needWeighIns':
      return check.weighIns < check.needWeighIns
        ? { label: 'Weigh-ins for your maintenance', have: check.weighIns, need: check.needWeighIns, unit: 'weigh-ins' }
        : { label: 'Weigh-ins for your maintenance', have: check.spanDays, need: check.needSpanDays, unit: 'days' };
    case 'onTrack':
    case 'suggestion':
    case 'kept':
      return { label, have: check.estimate.daysUsed, need: MIN_COMPLETE_DAYS };
    default:
      return { label, have: ctx.completeDays, need: MIN_COMPLETE_DAYS };
  }
}

/** "Timing patterns 9 of 14 days · Your real maintenance 9 of 21" (plan §13.3), by complete days. */
export function unlockProgress(ctx: Pick<InsightContext, 'completeDays' | 'dayNumber' | 'maintenance'>): UnlockItem[] {
  const items: UnlockItem[] = [];
  if (ctx.dayNumber < 7) items.push({ label: 'Weekly review and patterns', have: ctx.completeDays, need: 7 });
  items.push({ label: 'Timing patterns', have: ctx.completeDays, need: 14 });
  items.push(maintenanceUnlock(ctx));
  return items;
}

export interface FocusOption extends WeeklyFocus {
  ruleId: FocusRuleId;
}

/**
 * Three things to try next week, from the insights (their order and their numbers), topped up
 * with the other focus rules so there is always a choice.
 */
export function focusOptions(insights: readonly RankedInsight[]): FocusOption[] {
  const options: FocusOption[] = [];
  const seen = new Set<FocusRuleId>();
  for (const insight of insights) {
    if (!insight.focus || seen.has(insight.focus)) continue;
    seen.add(insight.focus);
    options.push({
      ruleId: insight.focus,
      label: focusLabel(insight.focus),
      sub: insight.focusSub ?? defaultFocusSub(insight.focus),
    });
  }
  for (const id of FOCUS_RULE_IDS) {
    if (seen.has(id)) continue;
    options.push({ ruleId: id, label: focusLabel(id), sub: defaultFocusSub(id) });
  }
  return options.slice(0, 3);
}
