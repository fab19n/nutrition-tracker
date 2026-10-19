/**
 * Diary and weight reads and writes the shared data layer doesn't have (S12–S16).
 *
 * - A meal lookup that tells "missing" apart from "still loading" (S14's friendly empty state).
 * - Object URLs for stored photos (MealRow thumbs, the entry photo).
 * - Save as Usual from a diary entry (plan §9.5).
 * - The week re-budgeted under another target ("View under: Current goal", S45).
 * - The goal in force on each day of a week (marker on a goal-switch day, S13).
 * - A weigh-in that hands back the trend after saving ("Saved · trend 77.9 kg", S16).
 *
 * Plain async functions take the database first, like the repo and selectors; the bound
 * versions and hooks use the app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { normaliseName } from '@/data/catalogue';
import { createActions, type Undo } from '@/db/actions';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { deleteUsual, getMeal, getPhoto, listUsuals, putUsual } from '@/db/repo';
import { getActiveGoal, getWeightTrend, todayFor, type WeekBudgetView } from '@/db/selectors';
import { computeWeekBudget, type WeekBudget } from '@/domain/budget';
import { now } from '@/domain/clock';
import { weekDays } from '@/domain/day';
import type { Goal, Id, Instant, LogicalDay, MealItem, MealLog, Usual, WeightLog } from '@/domain/types';

// ---------------------------------------------------------------------------
// Meal lookup
// ---------------------------------------------------------------------------

/** `meal` is null when there is no meal with that id (deleted, or a stale link). */
export interface MealLookup {
  meal: MealLog | null;
}

export async function lookupMeal(db: KiraMakanDb, id: Id): Promise<MealLookup> {
  return { meal: (await getMeal(db, id)) ?? null };
}

/** Undefined while loading; `{ meal: null }` once it's clear the meal isn't there. */
export function useMealLookup(id: Id | undefined): MealLookup | undefined {
  return useLiveQuery(() => (id ? lookupMeal(appDb, id) : { meal: null }), [id]);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type PhotoSize = 'thumb' | 'full';

/**
 * An object URL for a stored photo (its thumbnail by default), revoked when the photo or the
 * component goes away. Undefined while loading, without a photo, or where the browser can't
 * make object URLs.
 */
export function usePhotoUrl(photoId: Id | undefined, size: PhotoSize = 'thumb'): string | undefined {
  const record = useLiveQuery(() => (photoId ? getPhoto(appDb, photoId) : undefined), [photoId]);
  const blob = record ? (size === 'thumb' ? record.thumb : record.blob) : undefined;
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(undefined);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}

// ---------------------------------------------------------------------------
// Save as Usual
// ---------------------------------------------------------------------------

/** A Usual's lines are what you'd order again: no correction history or open questions. */
function usualItem(item: MealItem): MealItem {
  const { original: _original, edited: _edited, question: _question, ...rest } = item;
  return { ...rest, id: newId() };
}

/** A new Usual with the meal's name, Place, slot and items. It counts the meal as its first use. */
export function usualFromMeal(meal: MealLog, createdAt: Instant, id: Id = newId()): Usual {
  const usual: Usual = {
    id,
    name: meal.name,
    slot: meal.slot,
    items: meal.items.map(usualItem),
    useCount: 1,
    createdAt,
  };
  if (meal.placeId) usual.placeId = meal.placeId;
  return usual;
}

/** The Usual this meal already is: same name (ignoring case and punctuation) at the same Place. */
export function findMatchingUsual(usuals: readonly Usual[], meal: Pick<MealLog, 'name' | 'placeId'>): Usual | undefined {
  const name = normaliseName(meal.name);
  return usuals.find((u) => normaliseName(u.name) === name && (u.placeId ?? null) === (meal.placeId ?? null));
}

export interface SavedUsual {
  usual: Usual;
  /** False when the meal was already one of your Usuals (nothing was written). */
  created: boolean;
  /** Removes the Usual this call created. */
  undo: Undo;
}

export async function saveMealAsUsualIn(db: KiraMakanDb, mealId: Id): Promise<SavedUsual> {
  return db.transaction('rw', [db.meals, db.usuals], async () => {
    const meal = await getMeal(db, mealId);
    if (!meal) throw new RangeError(`No meal ${mealId}`);
    const existing = findMatchingUsual(await listUsuals(db), meal);
    if (existing) return { usual: existing, created: false, undo: async () => {} };
    const usual = usualFromMeal(meal, now().toISOString());
    await putUsual(db, usual);
    return { usual, created: true, undo: () => deleteUsual(db, usual.id) };
  });
}

/** "Save as Usual" on S14. */
export function saveMealAsUsual(mealId: Id): Promise<SavedUsual> {
  return saveMealAsUsualIn(appDb, mealId);
}

// ---------------------------------------------------------------------------
// The week under another goal (S45)
// ---------------------------------------------------------------------------

/**
 * The same week re-budgeted with one daily target on every day (null = paused all week):
 * meals, workouts, bonuses, statuses and the makan day stay as they were.
 */
export function budgetUnderTarget(view: Pick<WeekBudgetView, 'budget' | 'days' | 'dailyMinimumKcal'>, targetKcal: number | null): WeekBudget {
  const { budget } = view;
  return computeWeekBudget({
    days: view.days.map((d) => ({ ...d, targetKcal })),
    today: budget.today,
    dailyMinimumKcal: view.dailyMinimumKcal,
    ...(budget.makanDay ? { makanDay: budget.makanDay } : {}),
  });
}

export interface DayGoal {
  day: LogicalDay;
  goal?: Pick<Goal, 'id' | 'name' | 'template'>;
  /** The goal changed from the day before (inside the week). */
  switched: boolean;
}

/** The goal in force on each day Mon–Sun, flagging the day a switch took effect. */
export async function getWeekGoals(db: KiraMakanDb, weekStart: LogicalDay): Promise<DayGoal[]> {
  const days = weekDays(weekStart);
  const goals = await Promise.all(days.map((day) => getActiveGoal(db, day)));
  return days.map((day, i) => {
    const active = goals[i];
    const previous = i > 0 ? goals[i - 1] : undefined;
    const entry: DayGoal = { day, switched: i > 0 && active !== undefined && previous !== undefined && active.goal.id !== previous.goal.id };
    if (active) entry.goal = { id: active.goal.id, name: active.goal.name, template: active.goal.template };
    return entry;
  });
}

export function useWeekGoals(weekStart: LogicalDay): DayGoal[] | undefined {
  return useLiveQuery(() => getWeekGoals(appDb, weekStart), [weekStart]);
}

// ---------------------------------------------------------------------------
// Weigh-in with the new trend
// ---------------------------------------------------------------------------

export interface SavedWeighIn {
  weight: WeightLog;
  /** The latest trend once this reading is in. */
  trendKg: number;
}

export async function saveWeighInIn(db: KiraMakanDb, kg: number, at?: Instant): Promise<SavedWeighIn> {
  const weight = await createActions(db).addWeight(kg, at);
  const profile = await db.profile.get('me');
  const view = await getWeightTrend(db, { today: todayFor(profile) });
  return { weight, trendKg: view.latest?.trendKg ?? weight.kg };
}

/** S16 Save weigh-in. Throws a RangeError for a weight outside 20–400 kg. */
export function saveWeighIn(kg: number, at?: Instant): Promise<SavedWeighIn> {
  return saveWeighInIn(appDb, kg, at);
}
