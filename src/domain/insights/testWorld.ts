/**
 * Test helper: an insight context built from the demo world's plain rows (no database).
 * Only imported by tests.
 */
import { buildDemoWorld, DEMO_EXPECTED } from '@/db/seed/demo';
import { computeWeekBudget, type BudgetDayInput } from '@/domain/budget';
import { DEMO_NOW_ISO } from '@/domain/clock';
import { compareDays, instantAt, weekDays } from '@/domain/day';
import { checkTarget, type KeptTarget, type TargetCheck } from '@/domain/maintenance';
import { mealMacros } from '@/domain/meal';
import type { InsightFeedback, LogicalDay } from '@/domain/types';
import { buildMaintenanceWorld, MAINTENANCE_WORLD, targetCheckInput, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';
import { buildInsightContext, insightPeriodFor, reviewWeekStart, weekPeriod } from './context';
import type { InsightContext, InsightPeriod } from './types';

export function demoWorldContext(opts: { today?: LogicalDay; period?: InsightPeriod } = {}): InsightContext {
  const world = buildDemoWorld();
  const today = opts.today ?? DEMO_EXPECTED.today.day;
  const startedOn = world.profile.startedOn;
  const period =
    opts.period ??
    insightPeriodFor(today, startedOn, reviewWeekStart(today, opts.today ? instantAt(today, 12, 0) : DEMO_NOW_ISO));
  const goal = world.goals.find((g) => g.status === 'active');
  const version = world.goalVersions.find((v) => v.goalId === goal?.id);
  const weekStart = period.kind === 'week' ? period.from : undefined;
  const budget = weekStart
    ? computeWeekBudget({
        days: weekDays(weekStart).map((day): BudgetDayInput => ({
          day,
          targetKcal: compareDays(day, startedOn) >= 0 ? (version?.dailyKcal ?? 1800) : null,
          eatenKcal: Math.round(world.meals.filter((m) => m.logicalDay === day).reduce((s, m) => s + mealMacros(m).kcal, 0)),
          workoutKcal: world.workouts.filter((w) => w.logicalDay === day).reduce((s, w) => s + w.netKcal, 0),
          bonusKcal: 0,
          status: world.days.find((d) => d.logicalDay === day)?.status ?? null,
        })),
        today,
        dailyMinimumKcal: world.profile.dailyMinimumKcal,
      })
    : undefined;
  const meals = world.meals.filter((m) => compareDays(m.logicalDay, today) <= 0);
  return buildInsightContext({
    today,
    profile: world.profile,
    period,
    meals,
    records: world.days.filter((d) => compareDays(d.logicalDay, today) < 0),
    workouts: world.workouts,
    weights: world.weights.filter((w) => compareDays(w.logicalDay, today) <= 0),
    places: world.places,
    ...(goal ? { goal } : {}),
    ...(version ? { version } : {}),
    ...(budget ? { budget } : {}),
  });
}

export function demoWeekContext(weekStart: LogicalDay): InsightContext {
  return demoWorldContext({ period: weekPeriod(weekStart, DEMO_EXPECTED.today.day) });
}

export function notForMe(ruleId: string, pausedUntil: LogicalDay): InsightFeedback {
  return { ruleId, feedback: 'notForMe', at: DEMO_NOW_ISO, pausedUntil };
}

/**
 * The maintenance world (src/test/maintenanceWorld.ts) on Fri 30 Oct as the insights see it:
 * last week (19–25 Oct) as the period, the Cut and its setup version, and the target check for
 * the same rows (a suggestion of 1,550 unless `opts` or `kept` say otherwise).
 */
export function maintenanceWorldContext(opts: MaintenanceWorldOptions = {}, extra: { kept?: KeptTarget; maintenance?: TargetCheck | null } = {}): InsightContext {
  const world = buildMaintenanceWorld(opts);
  const today = MAINTENANCE_WORLD.today;
  const goal = world.goals.find((g) => g.status === 'active');
  const version = world.goalVersions.find((v) => v.goalId === goal?.id);
  const maintenance =
    extra.maintenance === null ? undefined : (extra.maintenance ?? checkTarget({ ...targetCheckInput(world, today), ...(extra.kept ? { kept: extra.kept } : {}) }));
  return buildInsightContext({
    today,
    profile: world.profile,
    period: { from: '2026-10-19', to: '2026-10-25', kind: 'week' },
    meals: world.meals,
    records: world.days.filter((d) => compareDays(d.logicalDay, today) < 0),
    workouts: world.workouts,
    weights: world.weights,
    places: [],
    ...(goal ? { goal } : {}),
    ...(version ? { version } : {}),
    ...(maintenance ? { maintenance } : {}),
  });
}
