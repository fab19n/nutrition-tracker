import { useEffect, useState } from 'react';
import { syncDemoClock } from '@/db/actions';

/**
 * True once start-up work is done: the clock is pinned (or unpinned) to match the stored
 * profile, so demo mode never shows the real date for a frame (ARCHITECTURE §6.0, §9).
 * A failed read still lets the app render; the screens show their own loading or empty states.
 */
export function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);

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

  return ready;
}
