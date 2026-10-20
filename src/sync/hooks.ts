/**
 * Sync state for screens.
 *
 * - useSyncView(): what the Settings card shows (./status describeSync turns it into copy). It
 *   reads the engine, the sync tables, the session and the clock, and settles unconfigured, demo,
 *   paused and signed out itself, so it's right before the engine has started.
 * - usePendingMealIds(): the meals still queued here, for the "Waiting to sync" badge. It's empty
 *   unless this device is linked and sync is stuck (offline, failing, signed out, waiting for the
 *   user), so the badge never flickers while changes go out normally.
 *
 * useSyncView starts the session (it loads supabase-js); usePendingMealIds never does, so Today
 * and the Diary stay as light as before.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSession, type SessionState } from '@/auth/session';
import { hasStoredSession } from '@/auth/supabase';
import { db } from '@/db/db';
import type { EngineState, SyncPhase } from './engine';
import { getEngineState, subscribeEngine } from './index';
import { pendingSummary, readMeta } from './local';
import type { SyncView } from './status';

/** "Last synced 5 min ago" moves on this often. */
const TICK_MS = 60_000;

/** Sync can't send what's queued until something changes: the badge shows only in these. */
const STUCK: ReadonlySet<SyncPhase> = new Set<SyncPhase>([
  'offline',
  'error',
  'needsSignIn',
  'notSetUp',
  'paused',
  'choose',
  'otherAccount',
  'cloudReset',
]);

const NO_MEALS: ReadonlySet<string> = new Set();

/** What the sync tables and the profile say. */
interface LocalSync {
  linked: boolean;
  linkedEmail?: string;
  lastSyncedAt?: number;
  paused: boolean;
  demo: boolean;
  pending: number;
  failed: number;
}

function useEngineState(): EngineState {
  return useSyncExternalStore(subscribeEngine, getEngineState, getEngineState);
}

function useTick(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}

async function readLocalSync(): Promise<LocalSync> {
  const [meta, summary, profile] = await Promise.all([readMeta(db), pendingSummary(db), db.profile.get('me')]);
  return {
    linked: meta.link !== undefined,
    linkedEmail: meta.link?.email,
    lastSyncedAt: meta.lastSyncedAt,
    paused: meta.paused === true,
    demo: profile?.demoMode === true,
    pending: summary.pending,
    failed: summary.failed,
  };
}

/**
 * The engine's phase, after what this tab already knows, in the engine's gate order: Supabase not
 * configured, demo mode, sync off here, signed out (needsSignIn once linked). The engine reaches
 * the same answer on its next look; this is it before the engine starts and right after a change.
 * Signed out with a session still stored is a refresh that failed on a bad connection: only the
 * engine can tell (offline, error or needsSignIn), so its phase stands.
 */
function viewPhase(engine: SyncPhase, session: SessionState, local: LocalSync | undefined): SyncPhase {
  if (engine === 'unconfigured' || session.status === 'unconfigured') return 'unconfigured';
  if (!local) return engine;
  if (local.demo) return 'demo';
  if (local.paused) return 'paused';
  if (session.status === 'signedOut' && !hasStoredSession()) return local.linked ? 'needsSignIn' : 'signedOut';
  return engine;
}

/** The Settings card's view of sync. Re-renders on every engine, table and session change, and each minute. */
export function useSyncView(): SyncView {
  const engine = useEngineState();
  const session = useSession();
  const local = useLiveQuery(readLocalSync, []);
  const tick = useTick(TICK_MS);
  // The tick and each change are the reasons to read the clock again (the real one: never demo time).
  const now = useMemo(() => Date.now(), [tick, engine, session, local]);

  const phase = viewPhase(engine.phase, session, local);
  // Progress, retries, the error and the choice belong to the engine's phase, not to one settled here.
  const own = phase === engine.phase;
  return {
    phase,
    pending: local?.pending ?? 0,
    failed: local?.failed ?? 0,
    linked: local?.linked ?? false,
    linkedEmail: local?.linkedEmail,
    signedIn: session.status === 'signedIn',
    sessionEmail: session.status === 'signedIn' ? session.email : undefined,
    lastSyncedAt: local?.lastSyncedAt,
    progress: own ? engine.progress : undefined,
    retryAt: own ? engine.retryAt : undefined,
    error: own ? engine.error : undefined,
    choice: own ? engine.choice : undefined,
    now,
  };
}

/** Ids of the meals queued on this device while sync is stuck (see STUCK); empty otherwise. */
export function usePendingMealIds(): ReadonlySet<string> {
  const stuck = STUCK.has(useEngineState().phase);
  return useLiveQuery(
    async (): Promise<ReadonlySet<string>> => {
      if (!stuck) return NO_MEALS;
      const [meta, summary] = await Promise.all([readMeta(db), pendingSummary(db)]);
      return meta.link && summary.mealKeys.length > 0 ? new Set(summary.mealKeys) : NO_MEALS;
    },
    [stuck],
    NO_MEALS,
  );
}
