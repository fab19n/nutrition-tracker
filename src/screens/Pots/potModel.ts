/**
 * Copy and edit rules shared by the Pots screens (S26–S28). Pure, so they're tested on their own.
 */
import { PATHS } from '@/app/paths';
import type { IngredientEdit } from '@/components/IngredientRow/IngredientRow';
import { servingsText } from '@/components/PotCard/PotCard';
import type { PotState } from '@/db/pots';
import { daysBetween, weekdayIndex } from '@/domain/day';
import { fmtApprox, fmtDayShort, fmtRelativeDay, roundTo10 } from '@/domain/format';
import type { LogicalDay, PotIngredient } from '@/domain/types';
import { ingredientFromText, oilIngredient, reestimateIngredient, withIngredientKcal } from '@/estimate/recipe';

export const RECIPE_PLACEHOLDER = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak…';
/** The splitter is instant; a short skeleton shows the recipe being read (S27 "splitting"). */
export const SPLIT_DELAY_MS = 450;

/** "?recipe=<potId>": New pot opens pre-filled from that recipe (Cook again). */
export function cookAgainPath(potId: string): string {
  return `${PATHS.potNew}?${new URLSearchParams({ recipe: potId }).toString()}`;
}

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** "~500": estimates are rounded to 10. */
export function kcalText(kcal: number): string {
  return fmtApprox(roundTo10(kcal));
}

/** "Clears Sunday", "Clears tomorrow", "Clears today", "Cleared"; further out, "Clears Fri 23 Oct". */
export function clearsText(state: PotState, expiresOn: LogicalDay, today: LogicalDay): string {
  if (state === 'cleared') return 'Cleared';
  if (state === 'clearsToday') return 'Clears today';
  const offset = daysBetween(today, expiresOn);
  if (offset === 1) return 'Clears tomorrow';
  if (offset > 1 && offset < 7) return `Clears ${WEEKDAY_LONG[weekdayIndex(expiresOn)] ?? fmtDayShort(expiresOn)}`;
  return `Clears ${fmtDayShort(expiresOn)}`;
}

/** "cooked today", "cooked Wed", "cooked Thu 1 Oct". */
export function cookedText(cookedOn: LogicalDay, today: LogicalDay): string {
  const day = fmtRelativeDay(cookedOn, today);
  return `cooked ${day === 'Today' || day === 'Yesterday' || day === 'Tomorrow' ? day.toLowerCase() : day}`;
}

/** The toast after logging from a pot: "Saved · ~500 kcal · 2 left". */
export function servingToast(kcal: number, servingsLeft: number): string {
  const left = servingsLeft > 0 ? `${servingsText(servingsLeft)} left` : 'none left';
  return `Saved · ${kcalText(kcal)} kcal · ${left}`;
}

/** "Log 1 serving", "Log ½ serving", "Log 2 servings". */
export function logLabel(servings: number): string {
  return `Log ${servingsText(servings)} ${servings > 1 ? 'servings' : 'serving'}`;
}

/** A blank row for "+ Add ingredient". */
export function blankIngredient(id: string): PotIngredient {
  return { id, name: '', amount: '', macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, source: 'aiGuess' };
}

/**
 * Applies what the row editor handed back. A new row (or a renamed guess) is read again from
 * its name and amount; a changed amount re-scales a known ingredient; a typed kcal wins over
 * both. Returns null for a new row left without a name.
 */
export function applyIngredientEdit(ingredient: PotIngredient, edit: IngredientEdit, isNew: boolean): PotIngredient | null {
  const name = edit.name.trim() || ingredient.name.trim();
  if (!name) return null;
  const amount = edit.amount.trim();
  const renamed = name !== ingredient.name;

  let next: PotIngredient;
  if (isNew || (renamed && ingredient.source === 'aiGuess')) {
    const read = ingredientFromText(`${amount} ${name}`, ingredient.id);
    if (read) {
      next = { ...read, name, amount: read.isOil || !amount ? read.amount : amount };
    } else {
      next = { ...ingredient, name, amount };
    }
  } else {
    next = { ...ingredient, name };
    if (amount !== ingredient.amount) next = reestimateIngredient(next, amount);
  }
  if (edit.kcal !== undefined) next = withIngredientKcal(next, edit.kcal);
  return next;
}

/** The oil row after a spoon chip: same id and name, that many tablespoons. */
export function withOilTbsp(ingredient: PotIngredient, tbsp: number): PotIngredient {
  return { ...oilIngredient(tbsp, ingredient.id), name: ingredient.name || 'Cooking oil' };
}
