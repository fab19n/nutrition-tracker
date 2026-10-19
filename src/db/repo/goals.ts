import type { KiraMakanDb } from '@/db/db';
import type { Goal, GoalPeriod, GoalStatus, GoalVersion, Id, LogicalDay } from '@/domain/types';
import { byKeys, type Patch } from './util';

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export function getGoal(db: KiraMakanDb, id: Id): Promise<Goal | undefined> {
  return db.goals.get(id);
}

export function listGoals(db: KiraMakanDb): Promise<Goal[]> {
  return db.goals.toArray().then((goals) => goals.sort(byKeys((g) => g.createdAt, (g) => g.id)));
}

export function listGoalsByStatus(db: KiraMakanDb, status: GoalStatus): Promise<Goal[]> {
  return db.goals
    .where('status')
    .equals(status)
    .toArray()
    .then((goals) => goals.sort(byKeys((g) => g.createdAt, (g) => g.id)));
}

/** The goal marked active. Which goal applied on a given day comes from its periods. */
export function getActiveGoal(db: KiraMakanDb): Promise<Goal | undefined> {
  return db.goals.where('status').equals('active').first();
}

export async function putGoal(db: KiraMakanDb, goal: Goal): Promise<void> {
  await db.goals.put(goal);
}

export async function updateGoal(db: KiraMakanDb, id: Id, patch: Patch<Goal, 'id'>): Promise<boolean> {
  return (await db.goals.update(id, patch)) > 0;
}

/**
 * Removes a goal with its versions and periods. Meant for drafts and templates that never ran;
 * a goal with history should be set to status 'ended' instead, so past days keep their goal.
 */
export async function deleteGoal(db: KiraMakanDb, id: Id): Promise<void> {
  await db.transaction('rw', db.goals, db.goalVersions, db.goalPeriods, async () => {
    await db.goalVersions.where('goalId').equals(id).delete();
    await db.goalPeriods.where('goalId').equals(id).delete();
    await db.goals.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Versions: append-only target history
// ---------------------------------------------------------------------------

export function listGoalVersions(db: KiraMakanDb, goalId: Id): Promise<GoalVersion[]> {
  return db.goalVersions
    .where('goalId')
    .equals(goalId)
    .toArray()
    .then((versions) => versions.sort(byKeys((v) => v.effectiveFrom, (v) => v.createdAt)));
}

export async function addGoalVersion(db: KiraMakanDb, version: GoalVersion): Promise<void> {
  await db.goalVersions.add(version);
}

/** The version in force on `day`: the latest one that started on or before it. */
export async function goalVersionOn(db: KiraMakanDb, goalId: Id, day: LogicalDay): Promise<GoalVersion | undefined> {
  const versions = await listGoalVersions(db, goalId);
  return versions.filter((v) => v.effectiveFrom <= day).at(-1);
}

export async function latestGoalVersion(db: KiraMakanDb, goalId: Id): Promise<GoalVersion | undefined> {
  return (await listGoalVersions(db, goalId)).at(-1);
}

// ---------------------------------------------------------------------------
// Periods: which goal applied when (`to` is exclusive)
// ---------------------------------------------------------------------------

export function listGoalPeriods(db: KiraMakanDb): Promise<GoalPeriod[]> {
  return db.goalPeriods.orderBy('from').toArray();
}

export async function putGoalPeriod(db: KiraMakanDb, period: GoalPeriod): Promise<void> {
  await db.goalPeriods.put(period);
}

export async function updateGoalPeriod(db: KiraMakanDb, id: Id, patch: Patch<GoalPeriod, 'id'>): Promise<boolean> {
  return (await db.goalPeriods.update(id, patch)) > 0;
}

export async function deleteGoalPeriod(db: KiraMakanDb, id: Id): Promise<void> {
  await db.goalPeriods.delete(id);
}

function periodCovers(period: GoalPeriod, day: LogicalDay): boolean {
  return period.from <= day && (period.to === undefined || day < period.to);
}

export async function goalPeriodOn(db: KiraMakanDb, day: LogicalDay): Promise<GoalPeriod | undefined> {
  const candidates = await db.goalPeriods.where('from').belowOrEqual(day).toArray();
  return candidates.filter((p) => periodCovers(p, day)).sort(byKeys((p) => p.from)).at(-1);
}

/** Periods that touch any day in [from, to] (both inclusive), oldest first. */
export async function goalPeriodsInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<GoalPeriod[]> {
  const started = await db.goalPeriods.where('from').belowOrEqual(to).sortBy('from');
  return started.filter((p) => p.to === undefined || p.to > from);
}
