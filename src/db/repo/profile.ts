import type { KiraMakanDb } from '@/db/db';
import type { Profile } from '@/domain/types';
import type { Patch } from './util';

export const PROFILE_ID: Profile['id'] = 'me';

export function getProfile(db: KiraMakanDb): Promise<Profile | undefined> {
  return db.profile.get(PROFILE_ID);
}

export async function saveProfile(db: KiraMakanDb, profile: Profile): Promise<void> {
  await db.profile.put(profile);
}

/** Returns false when there is no profile yet (setup not done). */
export async function updateProfile(db: KiraMakanDb, patch: Patch<Profile, 'id'>): Promise<boolean> {
  return (await db.profile.update(PROFILE_ID, patch)) > 0;
}

export async function deleteProfile(db: KiraMakanDb): Promise<void> {
  await db.profile.delete(PROFILE_ID);
}
