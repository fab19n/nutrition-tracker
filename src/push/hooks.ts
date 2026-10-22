/**
 * usePushView(): what S38's device card and the Settings row show (./status turns it into copy): the
 * engine's state, re-read on every change and each minute on the real clock (like useSyncView), with
 * `failing` once 3 sends in a row couldn't be delivered.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getPushState, subscribePush } from './index';
import { FAILING_AFTER, type PushView } from './status';

/** "Last reminder sent 5 min ago" moves on this often. */
const TICK_MS = 60_000;

function useTick(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}

export function usePushView(): PushView {
  const state = useSyncExternalStore(subscribePush, getPushState, getPushState);
  const tick = useTick(TICK_MS);
  // The tick and each change are the reasons to read the clock again (the real one: never demo time).
  const now = useMemo(() => Date.now(), [tick, state]);
  return useMemo(
    () => ({ ...state, now, failing: state.phase === 'on' && (state.device?.failures ?? 0) >= FAILING_AFTER }),
    [state, now],
  );
}
