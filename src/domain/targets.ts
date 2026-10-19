/**
 * Starting targets (plan §6.4): Mifflin–St Jeor BMR × activity for a day without workouts,
 * a pace-based deficit, and default macro splits.
 */
import { roundTo10, roundTo5 } from './format';
import type { ActivityLevel, Goal, GoalTemplate, Sex } from './types';

/** Multipliers for a day WITHOUT workouts; workouts are added to the budget separately. */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = { sedentary: 1.2, light: 1.375, active: 1.55 };

export const KCAL_PER_KG = 7700;

/** Lean bulk surplus when the goal doesn't set one. */
export const DEFAULT_SURPLUS_KCAL = 200;

const PROTEIN_G_PER_KG = 1.4;
const PROTEIN_G_PER_KG_BULK = 1.65;
const FAT_SHARE_OF_KCAL = 0.3;
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

export function bmrMifflinStJeor(p: { sex: Sex; weightKg: number; heightCm: number; age: number }): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

/** BMR × activity factor, rounded to 10. */
export function startingMaintenance(p: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activity: ActivityLevel;
}): number {
  return roundTo10(bmrMifflinStJeor(p) * ACTIVITY_FACTOR[p.activity]);
}

/** Daily deficit for a pace in kg/week (0.5 → 550). Negative pace (gain) gives a negative deficit. */
export function deficitForPace(paceKgPerWeek: number): number {
  return Math.round((paceKgPerWeek * KCAL_PER_KG) / 7);
}

/**
 * Daily target for a goal. Never below the daily minimum.
 * Not rounded to 10, so "0.25 kg/week → ~1,825" matches the target-suggestion copy (S37).
 */
export function dailyTargetFor(
  goal: Pick<Goal, 'template' | 'paceKgPerWeek' | 'surplusKcal'>,
  maintenanceKcal: number,
  dailyMinimumKcal: number,
): number {
  let target: number;
  switch (goal.template) {
    case 'festive':
      target = maintenanceKcal;
      break;
    case 'leanBulk':
      target = maintenanceKcal + (goal.surplusKcal ?? DEFAULT_SURPLUS_KCAL);
      break;
    case 'cut':
    case 'pause':
    case 'custom':
      target = maintenanceKcal - deficitForPace(goal.paceKgPerWeek);
      break;
  }
  return Math.max(dailyMinimumKcal, Math.round(target));
}

/** Protein 1.4 g/kg (lean bulk 1.65), fat 30% of kcal, carbs the remainder; all rounded to 5. */
export function defaultMacroTargets(
  dailyKcal: number,
  weightKg: number,
  template: GoalTemplate,
): { proteinG: number; carbsG: number; fatG: number } {
  const proteinG = roundTo5(weightKg * (template === 'leanBulk' ? PROTEIN_G_PER_KG_BULK : PROTEIN_G_PER_KG));
  const fatG = roundTo5((dailyKcal * FAT_SHARE_OF_KCAL) / KCAL_PER_G_FAT);
  const remainder = dailyKcal - proteinG * KCAL_PER_G_PROTEIN - fatG * KCAL_PER_G_FAT;
  const carbsG = Math.max(0, roundTo5(remainder / KCAL_PER_G_CARBS));
  return { proteinG, carbsG, fatG };
}
