import { useEffect, useState } from 'react';
import { syncDemoClock } from '@/db/actions';
import { useHasProfile } from '@/db/hooks';
import { requestPersistentStorage } from './storage';

/**
 * True once start-up work is done: the clock is pinned (or unpinned) to match the stored
 * profile, so demo mode never shows the real date for a frame (ARCHITECTURE §6.0, §9).
 * A failed read still lets the app render; the screens show their own loading or empty states.
 *
 * Once a profile exists (right after setup or the demo load, and on every later start) it also
 * asks the browser to keep the local data (./storage). That never blocks or delays start-up.
 */
export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  const hasProfile = useHasProfile();

  useEffect(() => {
    let alive = true;
    syncDemoClock()
      .catch(() => false)
      .then(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hasProfile === true) void requestPersistentStorage();
  }, [hasProfile]);

  return ready;
}
