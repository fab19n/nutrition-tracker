/**
 * Live data and browser state for the logging screens. Reads go through src/db/logging.ts,
 * wrapped in useLiveQuery so the screens follow the database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { getPlateHistory, listPlaceOrders, listPlacesByRecent, type LatLng, type OrderOption, type PlateHistory, type RecentPlaces } from '@/db/logging';
import { getPhoto } from '@/db/repo';
import type { Id } from '@/domain/types';

export function useRecentPlaces(): RecentPlaces | undefined {
  return useLiveQuery(() => listPlacesByRecent(db), []);
}

export function usePlaceOrders(placeId: Id | undefined): OrderOption[] | undefined {
  return useLiveQuery(() => (placeId ? listPlaceOrders(db, placeId) : Promise.resolve([])), [placeId]);
}

export function usePlateHistory(placeId: Id | undefined): PlateHistory | undefined {
  return useLiveQuery(() => (placeId ? getPlateHistory(db, placeId) : Promise.resolve({ often: [], plates: 0 })), [placeId]);
}

/** An object URL for a stored photo (or its thumbnail), revoked when no longer shown. */
export function usePhotoUrl(photoId: Id | undefined, which: 'blob' | 'thumb' = 'thumb'): string | undefined {
  const photo = useLiveQuery(() => (photoId ? getPhoto(db, photoId) : undefined), [photoId]);
  return useBlobUrl(photo ? photo[which] : undefined);
}

/** An object URL for a Blob, revoked on change and unmount. Undefined where URLs can't be made (tests). */
export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** The app's one connection hook (src/app/network.ts), kept here for the logging screens' imports. */
export { useOnline } from '@/app/network';

export function geolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && navigator.geolocation !== undefined;
}

/**
 * The current position, asked for once when `enabled` turns true (the Log sheet opening).
 * Never stored: only a new Place keeps its own spot. A denied permission is not asked again.
 */
export function useCurrentPosition(enabled: boolean): LatLng | undefined {
  const [position, setPosition] = useState<LatLng | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !geolocationAvailable()) return;
    let cancelled = false;
    const ask = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!cancelled) setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {},
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
      );
    const permissions = navigator.permissions;
    if (permissions?.query) {
      permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (!cancelled && status.state !== 'denied') ask();
        })
        .catch(() => {
          if (!cancelled) ask();
        });
    } else {
      ask();
    }
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return position;
}

const PRIMER_KEY = 'kira-makan:location-primer-seen';

/** Whether the location primer was already shown on this device (a per-device convenience). */
export function readPrimerSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(PRIMER_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPrimerSeen(): void {
  try {
    globalThis.localStorage?.setItem(PRIMER_KEY, '1');
  } catch {
    // Storage blocked: the primer may show again next time, which is harmless.
  }
}
