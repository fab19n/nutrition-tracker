import type { KiraMakanDb } from '@/db/db';
import type { Id, PersonalItem } from '@/domain/types';
import type { Patch } from './util';

export function getPersonalItem(db: KiraMakanDb, id: Id): Promise<PersonalItem | undefined> {
  return db.personalItems.get(id);
}

export function listPersonalItems(db: KiraMakanDb): Promise<PersonalItem[]> {
  return db.personalItems.toArray();
}

/** Corrections that only apply at this Place. */
export function listPersonalItemsForPlace(db: KiraMakanDb, placeId: Id): Promise<PersonalItem[]> {
  return db.personalItems.where('placeId').equals(placeId).toArray();
}

export function listPersonalItemsForCatalogue(db: KiraMakanDb, catalogueId: string): Promise<PersonalItem[]> {
  return db.personalItems.where('catalogueId').equals(catalogueId).toArray();
}

/**
 * The correction that applies to a catalogue item: one saved for this Place wins over one saved
 * for the dish everywhere (food-data layer 1).
 */
export async function findPersonalItem(
  db: KiraMakanDb,
  catalogueId: string,
  placeId?: Id,
): Promise<PersonalItem | undefined> {
  const matches = await listPersonalItemsForCatalogue(db, catalogueId);
  const atPlace = placeId ? matches.find((p) => p.scope === 'place' && p.placeId === placeId) : undefined;
  return atPlace ?? matches.find((p) => p.scope === 'dish');
}

export async function putPersonalItem(db: KiraMakanDb, item: PersonalItem): Promise<void> {
  await db.personalItems.put(item);
}

export async function updatePersonalItem(
  db: KiraMakanDb,
  id: Id,
  patch: Patch<PersonalItem, 'id'>,
): Promise<boolean> {
  return (await db.personalItems.update(id, patch)) > 0;
}

export async function deletePersonalItem(db: KiraMakanDb, id: Id): Promise<void> {
  await db.personalItems.delete(id);
}
