import type { Goal, GoalStatus, GoalTemplate, HeroMetric, Id, Instant, SuggestionWeights, TimingRules } from '@/domain/types';

/** The four templates that ship with the app (plan §6.2). Custom goals start from one of these. */
export type BuiltInTemplate = Exclude<GoalTemplate, 'custom'>;

export interface GoalPreset {
  name: string;
  template: BuiltInTemplate;
  heroMetric: HeroMetric;
  paceKgPerWeek: number;
  rangePct?: number;
  surplusKcal?: number;
  timing: TimingRules;
  suggestionWeights: SuggestionWeights;
}

/** Weights sum to 1. Budget fit first for a cut, protein first for a bulk. */
const BUDGET_FIRST: SuggestionWeights = { budget: 0.35, protein: 0.2, familiarity: 0.2, variety: 0.1, timing: 0.1, nearby: 0.05 };
const BALANCED: SuggestionWeights = { budget: 0.25, protein: 0.15, familiarity: 0.25, variety: 0.15, timing: 0.05, nearby: 0.15 };
const PROTEIN_FIRST: SuggestionWeights = { budget: 0.15, protein: 0.35, familiarity: 0.2, variety: 0.1, timing: 0.1, nearby: 0.1 };
const NO_BUDGET: SuggestionWeights = { budget: 0, protein: 0.2, familiarity: 0.4, variety: 0.2, timing: 0, nearby: 0.2 };

export const GOAL_PRESETS: Record<BuiltInTemplate, GoalPreset> = {
  cut: {
    name: 'Cut',
    template: 'cut',
    heroMetric: 'kcalLeft',
    paceKgPerWeek: 0.5,
    timing: { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 },
    suggestionWeights: BUDGET_FIRST,
  },
  festive: {
    name: 'Festive maintain',
    template: 'festive',
    heroMetric: 'daysInRange',
    paceKgPerWeek: 0,
    rangePct: 0.1,
    // Open-house season: only very long days and heavy grazing are worth a flag.
    timing: { maxWindowHours: 14, maxEatingOccasions: 6 },
    suggestionWeights: BALANCED,
  },
  leanBulk: {
    name: 'Lean bulk',
    template: 'leanBulk',
    heroMetric: 'proteinLeft',
    paceKgPerWeek: -0.25,
    surplusKcal: 200,
    // Protein is spread over 3–5 meals, so more occasions are fine.
    timing: { maxWindowHours: 14, maxEatingOccasions: 6 },
    suggestionWeights: PROTEIN_FIRST,
  },
  pause: {
    name: 'Pause',
    template: 'pause',
    heroMetric: 'none',
    paceKgPerWeek: 0,
    timing: {},
    suggestionWeights: NO_BUDGET,
  },
};

/** Display order in the goal library and in "New goal from template" (S43). */
export const GOAL_PRESET_ORDER: readonly BuiltInTemplate[] = ['cut', 'festive', 'leanBulk', 'pause'];

export interface BuildGoalOptions {
  id: Id;
  createdAt: Instant;
  status?: GoalStatus;
  /** Overrides the template's name, e.g. "Cut for Raya". */
  name?: string;
}

/** A fresh Goal from a template. Nested objects are copied, so presets are never mutated. */
export function buildGoal(template: BuiltInTemplate, options: BuildGoalOptions): Goal {
  const preset = GOAL_PRESETS[template];
  const goal: Goal = {
    id: options.id,
    name: options.name ?? preset.name,
    template: preset.template,
    heroMetric: preset.heroMetric,
    status: options.status ?? 'template',
    paceKgPerWeek: preset.paceKgPerWeek,
    timing: { ...preset.timing },
    suggestionWeights: { ...preset.suggestionWeights },
    createdAt: options.createdAt,
  };
  if (preset.rangePct !== undefined) goal.rangePct = preset.rangePct;
  if (preset.surplusKcal !== undefined) goal.surplusKcal = preset.surplusKcal;
  return goal;
}

/**
 * The goal library for a new user: the chosen template is active, the others are ready to
 * copy. `makeId` lets callers pick the id scheme (random in the app, fixed in tests).
 */
export function buildStarterGoals(
  active: BuiltInTemplate,
  createdAt: Instant,
  makeId: (template: BuiltInTemplate) => Id,
): Goal[] {
  return GOAL_PRESET_ORDER.map((template) =>
    buildGoal(template, { id: makeId(template), createdAt, status: template === active ? 'active' : 'template' }),
  );
}
