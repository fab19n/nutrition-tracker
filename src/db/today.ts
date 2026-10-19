/**
 * Reads the Today screen (S08) needs that the shared data layer doesn't have:
 *
 * - Your usual "Going to sleep" time, so the SleepTap (C61) shows up near it.
 * - Whether anything was ever logged, for the first-day state.
 * - Object URLs for meal photo thumbnails (MealRow).
 *
 * Plain async functions take the database first, like the repo and selectors; the hooks use
 * the app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { getPhoto, getProfile, listDayRecordsInRange } from '@/db/repo';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, minutesIntoLogicalDay } from '@/domain/day';
import type { Id, LogicalDay } from '@/domain/types';

/** Sleep taps are looked at over the same 28 days as timing baselines. */
export const SLEEP_HISTORY_DAYS = 28;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * Median "Going to sleep" time over the 28 days before `today`, in minutes since the day's
 * rollover (so 1:30am sits after 11pm). Null when you've never tapped it.
 */
export async function getUsualSleepMinutes(db: KiraMakanDb, today: LogicalDay): Promise<number | null> {
  const [profile, records] = await Promise.all([
    getProfile(db),
    listDayRecordsInRange(db, addDays(today, -SLEEP_HISTORY_DAYS), addDays(today, -1)),
  ]);
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const rolloverHour = profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const minutes = records.flatMap((r) => (r.sleepAt ? [minutesIntoLogicalDay(r.sleepAt, tz, rolloverHour)] : []));
  return minutes.length === 0 ? null : Math.round(median(minutes));
}

/** Undefined while loading; null without any sleep taps. */
export function useUsualSleepMinutes(today: LogicalDay): number | null | undefined {
  return useLiveQuery(() => getUsualSleepMinutes(appDb, today), [today]);
}

/** True once any meal has been logged (guesses included). */
export async function hasAnyMeal(db: KiraMakanDb): Promise<boolean> {
  return (await db.meals.limit(1).count()) > 0;
}

/** Undefined while loading. */
export function useHasAnyMeal(): boolean | undefined {
  return useLiveQuery(() => hasAnyMeal(appDb), []);
}

/**
 * An object URL for a meal photo's thumbnail, revoked when the photo or the component goes
 * away. Undefined while loading, without a photo, or where object URLs aren't available.
 */
export function usePhotoThumbUrl(photoId: Id | undefined): string | undefined {
  const record = useLiveQuery(() => (photoId ? getPhoto(appDb, photoId) : undefined), [photoId]);
  const blob = record?.thumb;
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(undefined);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}
