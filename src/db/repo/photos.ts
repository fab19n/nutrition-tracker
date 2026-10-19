import type { KiraMakanDb, PhotoRecord } from '@/db/db';
import type { Id } from '@/domain/types';

export function getPhoto(db: KiraMakanDb, id: Id): Promise<PhotoRecord | undefined> {
  return db.photos.get(id);
}

export async function putPhoto(db: KiraMakanDb, photo: PhotoRecord): Promise<void> {
  await db.photos.put(photo);
}

export async function deletePhoto(db: KiraMakanDb, id: Id): Promise<void> {
  await db.photos.delete(id);
}

export async function deletePhotos(db: KiraMakanDb, ids: Id[]): Promise<void> {
  await db.photos.bulkDelete(ids);
}

export function listPhotoIds(db: KiraMakanDb): Promise<Id[]> {
  return db.photos.toCollection().primaryKeys();
}
