import type { KiraMakanDb } from '@/db/db';
import type { LogicalDay, WeekPlan } from '@/domain/types';

export function getWeekPlan(db: KiraMakanDb, weekStart: LogicalDay): Promise<WeekPlan | undefined> {
  return db.weekPlans.get(weekStart);
}

export async function putWeekPlan(db: KiraMakanDb, plan: WeekPlan): Promise<void> {
  await db.weekPlans.put(plan);
}

export async function deleteWeekPlan(db: KiraMakanDb, weekStart: LogicalDay): Promise<void> {
  await db.weekPlans.delete(weekStart);
}

export function listWeekPlansInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<WeekPlan[]> {
  return db.weekPlans.where('weekStart').between(from, to, true, true).toArray();
}

/** Fields to change on a week's plan; `null` clears a field, a missing key leaves it as is. */
export interface WeekPlanChange {
  makanDay?: LogicalDay | null;
  focus?: NonNullable<WeekPlan['focus']> | null;
}

/** Creates the week's plan if needed and applies the change. Returns the stored plan. */
export async function upsertWeekPlan(db: KiraMakanDb, weekStart: LogicalDay, change: WeekPlanChange): Promise<WeekPlan> {
  return db.transaction('rw', db.weekPlans, async () => {
    const plan: WeekPlan = { ...(await db.weekPlans.get(weekStart)), weekStart };
    if (change.makanDay === null) delete plan.makanDay;
    else if (change.makanDay !== undefined) plan.makanDay = change.makanDay;
    if (change.focus === null) delete plan.focus;
    else if (change.focus !== undefined) plan.focus = { ...change.focus };
    await db.weekPlans.put(plan);
    return plan;
  });
}
