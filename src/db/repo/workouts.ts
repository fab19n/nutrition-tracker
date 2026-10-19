import type { KiraMakanDb } from '@/db/db';
import type { Id, LogicalDay, Workout } from '@/domain/types';
import { byKeys, type Patch } from './util';

export function getWorkout(db: KiraMakanDb, id: Id): Promise<Workout | undefined> {
  return db.workouts.get(id);
}

export async function putWorkout(db: KiraMakanDb, workout: Workout): Promise<void> {
  await db.workouts.put(workout);
}

export async function updateWorkout(db: KiraMakanDb, id: Id, patch: Patch<Workout, 'id'>): Promise<boolean> {
  return (await db.workouts.update(id, patch)) > 0;
}

export async function deleteWorkout(db: KiraMakanDb, id: Id): Promise<void> {
  await db.workouts.delete(id);
}

/** Workouts with a logical day in [from, to] (both inclusive), by day then creation. */
export async function listWorkoutsInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<Workout[]> {
  const rows = await db.workouts.where('logicalDay').between(from, to, true, true).toArray();
  return rows.sort(byKeys((w) => w.logicalDay, (w) => w.createdAt));
}

export function listWorkoutsForDay(db: KiraMakanDb, day: LogicalDay): Promise<Workout[]> {
  return listWorkoutsInRange(db, day, day);
}

/** Newest first. */
export async function listWorkouts(db: KiraMakanDb): Promise<Workout[]> {
  const rows = await db.workouts.toArray();
  return rows.sort(byKeys((w) => w.logicalDay, (w) => w.createdAt)).reverse();
}
