import type { KiraMakanDb } from '@/db/db';
import type { Id, Instant, LogicalDay, MealLog } from '@/domain/types';
import type { Patch } from './util';

export function getMeal(db: KiraMakanDb, id: Id): Promise<MealLog | undefined> {
  return db.meals.get(id);
}

export async function putMeal(db: KiraMakanDb, meal: MealLog): Promise<void> {
  await db.meals.put(meal);
}

export async function bulkPutMeals(db: KiraMakanDb, meals: MealLog[]): Promise<void> {
  await db.meals.bulkPut(meals);
}

/** Plain field update; callers set `updatedAt` and `syncState`. */
export async function updateMeal(db: KiraMakanDb, id: Id, patch: Patch<MealLog, 'id'>): Promise<boolean> {
  return (await db.meals.update(id, patch)) > 0;
}

/** Deletes and returns the row, so the caller can offer undo by putting it back. */
export async function deleteMeal(db: KiraMakanDb, id: Id): Promise<MealLog | undefined> {
  return db.transaction('rw', db.meals, async () => {
    const meal = await db.meals.get(id);
    if (meal) await db.meals.delete(id);
    return meal;
  });
}

/** Meals of one logical day, in the order they were eaten. */
export function listMealsForDay(db: KiraMakanDb, day: LogicalDay): Promise<MealLog[]> {
  return db.meals.where('logicalDay').equals(day).sortBy('eatenAt');
}

/** Meals with a logical day in [from, to] (both inclusive), in the order they were eaten. */
export function listMealsInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<MealLog[]> {
  return db.meals.where('logicalDay').between(from, to, true, true).sortBy('eatenAt');
}

export function listMealsAtPlace(db: KiraMakanDb, placeId: Id): Promise<MealLog[]> {
  return db.meals.where('placeId').equals(placeId).sortBy('eatenAt');
}

/** Meals eaten at or after `since`, oldest first. */
export function listMealsSince(db: KiraMakanDb, since: Instant): Promise<MealLog[]> {
  return db.meals.where('eatenAt').aboveOrEqual(since).toArray();
}

/** Newest first. */
export function listRecentMeals(db: KiraMakanDb, limit: number): Promise<MealLog[]> {
  return db.meals.orderBy('eatenAt').reverse().limit(limit).toArray();
}

export function countMeals(db: KiraMakanDb): Promise<number> {
  return db.meals.count();
}
