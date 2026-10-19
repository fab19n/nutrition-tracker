/**
 * Workout calories added back to the budget (plan §8.2).
 * Net kcal = (MET − 1) × kg × hours: the resting burn is already part of maintenance.
 */
import { roundTo10 } from './format';
import type { Intensity, WorkoutType } from './types';

/** Compendium of Physical Activities style values; futsal moderate = 7 (casual soccer). */
export const MET_TABLE: Record<WorkoutType, Record<Intensity, number>> = {
  walking: { easy: 2.8, moderate: 3.5, hard: 5.0 },
  futsal: { easy: 5.0, moderate: 7.0, hard: 10.0 },
  badminton: { easy: 4.5, moderate: 5.5, hard: 7.0 },
  gym: { easy: 3.5, moderate: 5.0, hard: 6.0 },
  running: { easy: 8.0, moderate: 9.8, hard: 11.5 },
  cycling: { easy: 4.0, moderate: 6.8, hard: 10.0 },
  swimming: { easy: 6.0, moderate: 8.3, hard: 10.0 },
  other: { easy: 3.0, moderate: 4.5, hard: 6.5 },
};

/** Futsal, moderate, 60 min, 78 kg → 470. Invalid inputs give 0. */
export function netWorkoutKcal(type: WorkoutType, intensity: Intensity, minutes: number, weightKg: number): number {
  if (!Number.isFinite(minutes) || !Number.isFinite(weightKg) || minutes <= 0 || weightKg <= 0) return 0;
  const met = MET_TABLE[type][intensity];
  return roundTo10((met - 1) * weightKg * (minutes / 60));
}
