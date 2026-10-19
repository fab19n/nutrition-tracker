import type { KiraMakanDb } from '@/db/db';
import type { Id, LogicalDay, WeightLog } from '@/domain/types';
import type { Patch } from './util';

export function getWeight(db: KiraMakanDb, id: Id): Promise<WeightLog | undefined> {
  return db.weights.get(id);
}

export async function putWeight(db: KiraMakanDb, weight: WeightLog): Promise<void> {
  await db.weights.put(weight);
}

export async function updateWeight(db: KiraMakanDb, id: Id, patch: Patch<WeightLog, 'id'>): Promise<boolean> {
  return (await db.weights.update(id, patch)) > 0;
}

export async function deleteWeight(db: KiraMakanDb, id: Id): Promise<void> {
  await db.weights.delete(id);
}

/** Every weigh-in, oldest first. */
export function listWeights(db: KiraMakanDb): Promise<WeightLog[]> {
  return db.weights.orderBy('measuredAt').toArray();
}

export function listWeightsInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<WeightLog[]> {
  return db.weights.where('logicalDay').between(from, to, true, true).sortBy('measuredAt');
}

export function latestWeight(db: KiraMakanDb): Promise<WeightLog | undefined> {
  return db.weights.orderBy('measuredAt').last();
}
