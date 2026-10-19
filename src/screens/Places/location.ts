/**
 * "Use where I am now" / "I'm here now" (S21, S22): one position, asked for only when tapped,
 * with the location primer (C58) the first time. Nothing here is stored; the screen saves the
 * spot on the Place itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@/db/db';
import { useProfile } from '@/db/hooks';
import { setUseLocation, type LatLng } from '@/db/logging';
import { geolocationAvailable, markPrimerSeen, readPrimerSeen } from '@/screens/Log/hooks';

export const LOCATION_PRIMER = {
  title: "Save this Place's spot?",
  body: "Kira Makan keeps only this Place's own spot, never where you've been. Log uses it to pick this Place when you're within about 150 m.",
  allowLabel: 'Allow location',
} as const;

export const LOCATION_FAILED = "Couldn't get your location. Try again in a moment.";

/** One reading of where the phone is now. */
export function getPositionOnce(timeoutMs = 10_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!geolocationAvailable()) {
      reject(new Error('Location is not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (error) => reject(new Error(error.message || 'Location failed')),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: timeoutMs },
    );
  });
}

export type HereState = 'idle' | 'primer' | 'locating';

export interface HereNow {
  /** False on a device without location: hide the control. */
  available: boolean;
  state: HereState;
  /** Tapped "I'm here now": shows the primer the first time, else asks for the position. */
  ask: () => void;
  /** The primer's Allow: remembers it was shown, turns location on, then asks. */
  allow: () => void;
  /** The primer's Not now. */
  notNow: () => void;
}

/**
 * The tap-to-locate flow. `onFound` gets the position once; `onFailed` runs when it can't be read
 * (denied, timed out). The primer shows when location is off in Settings and it hasn't been seen.
 */
export function useHereNow(onFound: (at: LatLng) => void, onFailed: () => void): HereNow {
  const profile = useProfile();
  const [state, setState] = useState<HereState>('idle');
  const handlers = useRef({ onFound, onFailed });
  useEffect(() => {
    handlers.current = { onFound, onFailed };
  });
  const available = geolocationAvailable();

  const locate = useCallback(() => {
    setState('locating');
    getPositionOnce().then(
      (at) => {
        setState('idle');
        handlers.current.onFound(at);
      },
      () => {
        setState('idle');
        handlers.current.onFailed();
      },
    );
  }, []);

  const ask = useCallback(() => {
    if (!geolocationAvailable()) return;
    if (profile && !profile.useLocation && !readPrimerSeen()) {
      setState('primer');
      return;
    }
    locate();
  }, [locate, profile]);

  const allow = useCallback(() => {
    markPrimerSeen();
    void setUseLocation(db, true);
    locate();
  }, [locate]);

  const notNow = useCallback(() => {
    markPrimerSeen();
    setState('idle');
  }, []);

  return { available, state, ask, allow, notNow };
}
