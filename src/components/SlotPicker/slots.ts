import type { MealSlot } from '@/domain/types';

/** Meal slots in the order they appear in pickers. */
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supper'];

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  supper: 'Supper',
};
