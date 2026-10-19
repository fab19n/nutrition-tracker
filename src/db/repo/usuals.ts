import type { KiraMakanDb } from '@/db/db';
import type { Id, Usual } from '@/domain/types';
import type { Patch } from './util';

/**
 * The one order Usuals are offered in everywhere (S23, the Log sheet, the Usuals sheet, Place
 * orders): your manual order from S23 first (lower `sortIndex` first; unset after set), then most
 * used, then by name.
 */
export function compareUsualOrder(a: Usual, b: Usual): number {
  const sa = a.sortIndex;
  const sb = b.sortIndex;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  return b.useCount - a.useCount || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

export function getUsual(db: KiraMakanDb, id: Id): Promise<Usual | undefined> {
  return db.usuals.get(id);
}

/** In your order (see `compareUsualOrder`): manual order first, then most used. */
export async function listUsuals(db: KiraMakanDb): Promise<Usual[]> {
  return (await db.usuals.toArray()).sort(compareUsualOrder);
}

/** A Place's Usuals, in your order. */
export async function listUsualsAtPlace(db: KiraMakanDb, placeId: Id): Promise<Usual[]> {
  return (await db.usuals.where('placeId').equals(placeId).toArray()).sort(compareUsualOrder);
}

export async function putUsual(db: KiraMakanDb, usual: Usual): Promise<void> {
  await db.usuals.put(usual);
}

export async function updateUsual(db: KiraMakanDb, id: Id, patch: Patch<Usual, 'id'>): Promise<boolean> {
  return (await db.usuals.update(id, patch)) > 0;
}

export async function deleteUsual(db: KiraMakanDb, id: Id): Promise<void> {
  await db.usuals.delete(id);
}

/** Counts one more use (the most used come first among Usuals you haven't put in order). */
export async function recordUsualUse(db: KiraMakanDb, id: Id): Promise<boolean> {
  const updated = await db.usuals
    .where('id')
    .equals(id)
    .modify((usual) => {
      usual.useCount += 1;
    });
  return updated > 0;
}
