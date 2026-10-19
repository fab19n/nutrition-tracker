import type { KiraMakanDb } from '@/db/db';
import type { Id, LogicalDay, Pot } from '@/domain/types';
import { byKeys, type Patch } from './util';

export function getPot(db: KiraMakanDb, id: Id): Promise<Pot | undefined> {
  return db.pots.get(id);
}

/** Newest cooking first. */
export async function listPots(db: KiraMakanDb): Promise<Pot[]> {
  return (await db.pots.toArray()).sort(byKeys((p) => p.cookedOn, (p) => p.createdAt)).reverse();
}

/** Pots still in the fridge on `today`: not expired and not finished. Soonest to clear first. */
export async function listActivePots(db: KiraMakanDb, today: LogicalDay): Promise<Pot[]> {
  const pots = await db.pots.where('expiresOn').aboveOrEqual(today).sortBy('expiresOn');
  return pots.filter((p) => p.servingsLeft > 0 && p.cookedOn <= today);
}

export async function putPot(db: KiraMakanDb, pot: Pot): Promise<void> {
  await db.pots.put(pot);
}

export async function updatePot(db: KiraMakanDb, id: Id, patch: Patch<Pot, 'id'>): Promise<boolean> {
  return (await db.pots.update(id, patch)) > 0;
}

export async function deletePot(db: KiraMakanDb, id: Id): Promise<void> {
  await db.pots.delete(id);
}

/**
 * Takes servings out of a pot (½ is allowed), never below zero. A negative amount puts servings
 * back (undo), never above the pot's total. Returns the updated pot, or undefined if it's gone.
 */
export async function takePotServings(db: KiraMakanDb, id: Id, servings: number): Promise<Pot | undefined> {
  return db.transaction('rw', db.pots, async () => {
    const pot = await db.pots.get(id);
    if (!pot) return undefined;
    const servingsLeft = Math.min(pot.servings, Math.max(0, pot.servingsLeft - servings));
    const updated: Pot = { ...pot, servingsLeft };
    await db.pots.put(updated);
    return updated;
  });
}
