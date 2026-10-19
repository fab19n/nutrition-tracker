import type { KiraMakanDb } from '@/db/db';
import type { Id, LogicalDay, OneOffBonus } from '@/domain/types';
import { byKeys, type Patch } from './util';

export function getBonus(db: KiraMakanDb, id: Id): Promise<OneOffBonus | undefined> {
  return db.bonuses.get(id);
}

export async function putBonus(db: KiraMakanDb, bonus: OneOffBonus): Promise<void> {
  await db.bonuses.put(bonus);
}

export async function updateBonus(db: KiraMakanDb, id: Id, patch: Patch<OneOffBonus, 'id'>): Promise<boolean> {
  return (await db.bonuses.update(id, patch)) > 0;
}

export async function deleteBonus(db: KiraMakanDb, id: Id): Promise<void> {
  await db.bonuses.delete(id);
}

/** One-off bonuses with a logical day in [from, to] (both inclusive), by day then creation. */
export async function listBonusesInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<OneOffBonus[]> {
  const rows = await db.bonuses.where('logicalDay').between(from, to, true, true).toArray();
  return rows.sort(byKeys((b) => b.logicalDay, (b) => b.createdAt));
}
