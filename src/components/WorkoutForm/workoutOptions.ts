/**
 * WorkoutForm (C51) options and logic: the type and intensity lists, the duration stepper's bounds and
 * rounding, and the grid's arrow-key movement. Pure, so the form stays presentational.
 */
import { fmtInt } from '@/domain/format';
import type { Intensity, WorkoutType } from '@/domain/types';

/** Picker order (design_handoff C51). */
export const WORKOUT_TYPES: readonly WorkoutType[] = ['walking', 'futsal', 'badminton', 'gym', 'running', 'cycling', 'swimming', 'other'];

/** Picker labels. */
export const WORKOUT_TYPE_LABEL: Record<WorkoutType, string> = {
  walking: 'Walking',
  futsal: 'Futsal',
  badminton: 'Badminton',
  gym: 'Gym',
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  other: 'Other',
};

/** A logged workout's name in lists and toasts ("Other" reads as "Workout" there). */
export function workoutName(type: WorkoutType): string {
  return type === 'other' ? 'Workout' : WORKOUT_TYPE_LABEL[type];
}

export const INTENSITIES: readonly Intensity[] = ['easy', 'moderate', 'hard'];

export const INTENSITY_LABEL: Record<Intensity, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard' };

/** Duration stepper: ±5 minutes within 5–300 (5 hours). */
export const MINUTES = { min: 5, max: 300, step: 5 } as const;

/** The type grid's columns (two rows of four). */
export const TYPE_COLUMNS = 4;

export interface WorkoutFormValue {
  type: WorkoutType;
  intensity: Intensity;
  /** What's in the minutes field, as typed ("60"). */
  minutesText: string;
}

/** A fresh form: the last workout's settings when there is one (most people repeat their session). */
export function initialWorkoutValue(last?: { type: WorkoutType; intensity: Intensity; minutes: number }): WorkoutFormValue {
  if (!last) return { type: 'walking', intensity: 'moderate', minutesText: '30' };
  const minutes = Math.min(MINUTES.max, Math.max(MINUTES.min, Math.round(last.minutes)));
  return { type: last.type, intensity: last.intensity, minutesText: String(minutes) };
}

const DIGITS = /^\d+$/;

/** Whole minutes within 5–300, else null. */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!DIGITS.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= MINUTES.min && n <= MINUTES.max ? n : null;
}

/** The message under the minutes field, or null when it's fine. */
export function minutesError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'Enter how many minutes.';
  if (!DIGITS.test(trimmed)) return 'Use whole minutes, like 45.';
  const n = Number(trimmed);
  if (n < MINUTES.min) return `At least ${fmtInt(MINUTES.min)} minutes.`;
  if (n > MINUTES.max) return `Up to ${fmtInt(MINUTES.max)} minutes (5 hours).`;
  return null;
}

/**
 * One step of the stepper: ±5, snapping an odd typed value to the next multiple of 5 in that
 * direction (47 → 50 up, 45 down). Unreadable text starts from the minimum. Always in bounds.
 */
export function stepMinutes(text: string, direction: 1 | -1): number {
  const trimmed = text.trim();
  const current = DIGITS.test(trimmed) ? Number(trimmed) : Number.NaN;
  let next: number;
  if (Number.isNaN(current)) next = MINUTES.min;
  else if (current % MINUTES.step !== 0) {
    next = (direction > 0 ? Math.ceil(current / MINUTES.step) : Math.floor(current / MINUTES.step)) * MINUTES.step;
  } else next = current + direction * MINUTES.step;
  return Math.min(MINUTES.max, Math.max(MINUTES.min, next));
}

/**
 * Arrow-key movement in a one-row radio group (the intensity chips): Right/Down step forward,
 * Left/Up step back, both wrapping; Home/End jump to the ends. Null for other keys.
 */
export function lineMove(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Arrow-key movement in the type grid (a radio group laid out in rows): Left/Right step and wrap,
 * Up/Down move a row and wrap within the column, Home/End jump to the ends. Null for other keys.
 */
export function gridMove(index: number, key: string, count: number, columns: number = TYPE_COLUMNS): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowDown': {
      const below = index + columns;
      return below < count ? below : index % columns;
    }
    case 'ArrowUp': {
      const above = index - columns;
      if (above >= 0) return above;
      const column = index % columns;
      const lastRowStart = Math.floor((count - 1) / columns) * columns;
      const target = lastRowStart + column;
      return target < count ? target : target - columns;
    }
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
