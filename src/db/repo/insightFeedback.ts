import type { KiraMakanDb } from '@/db/db';
import type { InsightFeedback, LogicalDay } from '@/domain/types';

export function getInsightFeedback(db: KiraMakanDb, ruleId: string): Promise<InsightFeedback | undefined> {
  return db.insightFeedback.get(ruleId);
}

export function listInsightFeedback(db: KiraMakanDb): Promise<InsightFeedback[]> {
  return db.insightFeedback.toArray();
}

/** One row per rule: the latest answer replaces the previous one. */
export async function putInsightFeedback(db: KiraMakanDb, feedback: InsightFeedback): Promise<void> {
  await db.insightFeedback.put(feedback);
}

export async function deleteInsightFeedback(db: KiraMakanDb, ruleId: string): Promise<void> {
  await db.insightFeedback.delete(ruleId);
}

/** Rules the user paused with "Not for me" that are still paused on `today`. */
export async function listPausedRuleIds(db: KiraMakanDb, today: LogicalDay): Promise<string[]> {
  const rows = await db.insightFeedback.toArray();
  return rows.filter((f) => f.pausedUntil !== undefined && today < f.pausedUntil).map((f) => f.ruleId);
}
