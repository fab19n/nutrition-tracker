import type { KiraMakanDb } from '@/db/db';
import type { Id, Place } from '@/domain/types';
import type { Patch } from './util';

export function getPlace(db: KiraMakanDb, id: Id): Promise<Place | undefined> {
  return db.places.get(id);
}

/** Alphabetical by name. */
export async function listPlaces(db: KiraMakanDb): Promise<Place[]> {
  const places = await db.places.toArray();
  return places.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Case- and spacing-insensitive name match, for "Where?" typed by hand. */
export async function findPlaceByName(db: KiraMakanDb, name: string): Promise<Place | undefined> {
  const wanted = normaliseName(name);
  if (!wanted) return undefined;
  return db.places.filter((p) => normaliseName(p.name) === wanted).first();
}

export async function putPlace(db: KiraMakanDb, place: Place): Promise<void> {
  await db.places.put(place);
}

export async function updatePlace(db: KiraMakanDb, id: Id, patch: Patch<Place, 'id'>): Promise<boolean> {
  return (await db.places.update(id, patch)) > 0;
}

/** Removes the Place only; meals keep their `placeId` and show it as an unknown Place. */
export async function deletePlace(db: KiraMakanDb, id: Id): Promise<void> {
  await db.places.delete(id);
}

/** Learns (or forgets, with `null`) a Place's default portion for a catalogue item. */
export async function setPlaceDefaultVariant(
  db: KiraMakanDb,
  placeId: Id,
  catalogueId: string,
  variantIndex: number | null,
): Promise<boolean> {
  const updated = await db.places
    .where('id')
    .equals(placeId)
    .modify((place) => {
      const defaults = { ...place.defaultVariants };
      if (variantIndex === null) delete defaults[catalogueId];
      else defaults[catalogueId] = variantIndex;
      place.defaultVariants = defaults;
    });
  return updated > 0;
}
