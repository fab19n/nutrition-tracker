/**
 * What the sync card says (Settings › Account and sync). describeSync turns a SyncView (./hooks
 * builds it from the engine, the sync tables and the session) into the card's copy: a tone, a
 * pill, a title, a line of detail, facts and the actions that fit. It's pure, so every phase and
 * count is tested here without a database, an engine or a clock.
 *
 * Actions come back as ids; the screen that shows the card connects each one (Sign in, Sync now…).
 */
import type { SyncErrorKind } from '@/db/syncTypes';
import { fmtAgo, fmtInt } from '@/domain/format';
import type { SyncPhase, SyncProgress } from './engine';
import type { CloudSummary } from './remote';

/** What the card shows about this device's sync, from ./hooks useSyncView. */
export interface SyncView {
  /** The engine's phase, or what this tab knows first: unconfigured, demo, paused, signed out. */
  phase: SyncPhase;
  /** Changes waiting on this device to be sent (failed ones not counted). */
  pending: number;
  /** Changes the account refused; they wait for the next app start. */
  failed: number;
  /** This device has synced with an account (it has a sync link). */
  linked: boolean;
  /** The account the link is with. */
  linkedEmail?: string;
  /** The session reads signed in (with needsSignIn: the account refused its token). */
  signedIn?: boolean;
  /** The signed-in account. */
  sessionEmail?: string;
  /** When a cycle last finished (ms, real clock). */
  lastSyncedAt?: number;
  /** 'uploading' and 'restoring': entries done of about `total`. */
  progress?: SyncProgress;
  /** 'error' and 'offline': when the next automatic try is due (ms, real clock). */
  retryAt?: number;
  /** Why the engine's last attempt failed (EngineState.error); 'error' gives unreachable, unavailable, rejected or failed. */
  error?: SyncErrorKind;
  /** 'choose': what the account holds, and how many meals this device has. */
  choice?: { cloud: CloudSummary; localMeals: number };
  /** The real time when the view was read, again every minute: pass it to describeSync. */
  now: number;
}

/** ok: up to date · busy: working · waiting: it goes by itself · attention: needs the user · off. */
export type SyncTone = 'ok' | 'busy' | 'waiting' | 'attention' | 'off';

export type SyncActionId =
  | 'signIn'
  | 'turnOn'
  | 'syncNow'
  | 'retry'
  | 'choose'
  | 'switchAccount'
  | 'signOut'
  | 'uploadAfterReset'
  | 'turnOff';

export interface SyncAction {
  id: SyncActionId;
  label: string;
  variant: 'primary' | 'secondary' | 'ghost';
}

export interface SyncCopy {
  tone: SyncTone;
  pill: string;
  title: string;
  detail?: string;
  /** Changes the account refused: "1 change couldn't sync. It stays on this device." */
  extra?: string;
  /** "Account" (signed in and linked) and "Last synced" (unless the detail already says it). */
  facts: { label: string; value: string }[];
  /** 'uploading' and 'restoring' once the total is known: the card's progress bar. */
  progress?: SyncProgress;
  actions: SyncAction[];
}

/** From here a retry is "in a few minutes" rather than "in about a minute". */
const FEW_MINUTES_MS = 90_000;

const ACTIONS = {
  signIn: { id: 'signIn', label: 'Sign in', variant: 'primary' },
  turnOn: { id: 'turnOn', label: 'Turn on sync', variant: 'primary' },
  syncNow: { id: 'syncNow', label: 'Sync now', variant: 'secondary' },
  retry: { id: 'retry', label: 'Try again', variant: 'primary' },
  choose: { id: 'choose', label: 'Choose', variant: 'primary' },
  switchAccount: { id: 'switchAccount', label: 'Switch to this account', variant: 'primary' },
  signOut: { id: 'signOut', label: 'Sign out', variant: 'ghost' },
  uploadAfterReset: { id: 'uploadAfterReset', label: "Upload this device's data", variant: 'primary' },
  turnOff: { id: 'turnOff', label: 'Turn off sync', variant: 'ghost' },
} as const satisfies Record<SyncActionId, SyncAction>;

/** '1 change', '12 changes', '1,240 changes'. */
function changes(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'change' : 'changes'}`;
}

/** The verb after changes(n): verb('wait', 'waits', 1) → 'waits'. */
function verb(plural: string, singular: string, n: number): string {
  return n === 1 ? singular : plural;
}

interface Body {
  tone: SyncTone;
  pill: string;
  title: string;
  detail?: string;
  progress?: SyncProgress;
  actions?: SyncAction[];
  /** The detail already says when it last synced, so the fact would repeat it. */
  saysLastSynced?: boolean;
}

function knownProgress(progress: SyncProgress | undefined): SyncProgress | undefined {
  return progress && progress.total > 0 ? { done: Math.min(Math.max(progress.done, 0), progress.total), total: progress.total } : undefined;
}

function otherAccountDetail(view: SyncView): string | undefined {
  const synced = view.linkedEmail ? `Synced with ${view.linkedEmail}.` : undefined;
  const signedIn = view.sessionEmail ? `You're signed in as ${view.sessionEmail}.` : undefined;
  return [synced, signedIn].filter(Boolean).join(' ') || undefined;
}

function bodyFor(view: SyncView, n: number, ago: string | undefined, nowMs: number): Body {
  switch (view.phase) {
    case 'unconfigured':
      return { tone: 'off', pill: 'Off', title: 'Sync is off', detail: "Sync isn't set up in this version of the app." };
    case 'noProfile':
      return { tone: 'off', pill: 'Off', title: 'Sync is off', detail: 'Sync starts once the app is set up.' };
    case 'starting':
      return { tone: 'busy', pill: 'Syncing', title: 'Checking your account…' };
    case 'signedOut':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Sync is off',
        detail: 'Sign in to keep a copy of your diary in your account and use it on another device.',
      };
    case 'needsSignIn':
      if (view.signedIn) {
        // Still signed in here, but the account refused the token: a new one, or another sign-in, fixes it.
        return {
          tone: 'attention',
          pill: 'Needs you',
          title: 'Sign in again to keep syncing',
          detail: "Your account didn't accept this sign-in. Try again, or sign out and in.",
          actions: [ACTIONS.retry, ACTIONS.signOut],
        };
      }
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: 'Sign in to keep syncing',
        detail:
          n > 0
            ? `${changes(n)} ${verb('wait', 'waits', n)} on this device until you sign in.`
            : 'New entries wait on this device until you sign in.',
        actions: [ACTIONS.signIn],
      };
    case 'demo':
      return { tone: 'off', pill: 'Off', title: 'Sync is off in demo mode', detail: 'Sample data never leaves this device.' };
    case 'paused':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Sync is off on this device',
        detail: 'Your data stays here until you turn it back on.',
        actions: [ACTIONS.turnOn],
      };
    case 'uploading': {
      const progress = knownProgress(view.progress);
      return {
        tone: 'busy',
        pill: 'Syncing',
        title: 'Backing up',
        detail: progress ? `${fmtInt(progress.done)} of ${fmtInt(progress.total)} entries` : undefined,
        progress,
      };
    }
    case 'restoring': {
      // "Use the account's data": the account's diary is downloading to replace this one.
      const progress = knownProgress(view.progress);
      return {
        tone: 'busy',
        pill: 'Syncing',
        title: "Getting your account's data",
        detail: progress
          ? `${fmtInt(progress.done)} of about ${fmtInt(progress.total)} entries. Keep the app open.`
          : 'Keep the app open.',
        progress,
      };
    }
    case 'syncing':
      return { tone: 'busy', pill: 'Syncing', title: 'Syncing…' };
    case 'idle':
      return n === 0
        ? {
            tone: 'ok',
            pill: 'Up to date',
            title: 'Up to date',
            detail: ago ? `Last synced ${ago}` : undefined,
            actions: [ACTIONS.syncNow],
            saysLastSynced: true,
          }
        : {
            tone: 'waiting',
            pill: 'Waiting',
            title: `${changes(n)} waiting`,
            detail: n === 1 ? 'It syncs in a moment.' : 'They sync in a moment.',
            actions: [ACTIONS.syncNow],
          };
    case 'offline':
      return n > 0
        ? {
            tone: 'waiting',
            pill: 'Offline',
            title: 'Offline',
            detail: `${changes(n)} ${verb('wait', 'waits', n)} on this device and ${verb('sync', 'syncs', n)} when you're back online.`,
          }
        : {
            tone: 'waiting',
            pill: 'Offline',
            title: 'Offline',
            detail: ago ? `Everything is saved on this device. Last synced ${ago}.` : 'Everything is saved on this device.',
            saysLastSynced: true,
          };
    case 'error': {
      if (view.error === 'rejected') {
        // The account answered and said no: waiting alone won't fix that, so say where to look.
        return {
          tone: 'waiting',
          pill: 'Waiting',
          title: 'Your account refused the last sync',
          detail: 'Your entries are safe on this device. It keeps trying; if this stays, check Supabase › Logs (DEPLOY.md).',
          actions: [ACTIONS.retry],
        };
      }
      if (view.error === 'failed') {
        // Anything else, on this device or on the way (another device linking at the same time
        // included): nothing says the account refused it.
        return {
          tone: 'waiting',
          pill: 'Waiting',
          title: 'Sync stopped on a problem',
          detail: 'Your entries are safe on this device. It keeps trying.',
          actions: [ACTIONS.retry],
        };
      }
      const retry =
        view.retryAt === undefined
          ? ''
          : view.retryAt - nowMs >= FEW_MINUTES_MS
            ? ' Trying again in a few minutes.'
            : ' Trying again in about a minute.';
      return {
        tone: 'waiting',
        pill: 'Waiting',
        title: "Can't reach your account",
        detail: `Your entries are safe on this device.${retry}`,
        actions: [ACTIONS.retry],
      };
    }
    case 'notSetUp':
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: "Sync isn't set up on the server",
        detail: 'Run supabase/sync.sql in the Supabase SQL Editor (see DEPLOY.md).',
        actions: [ACTIONS.retry],
      };
    case 'choose':
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: 'Your account already has a diary',
        detail: 'It came from another device. Choose which copy to keep.',
        actions: [ACTIONS.choose],
      };
    case 'otherAccount':
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: 'This device syncs with another account',
        detail: otherAccountDetail(view),
        actions: [ACTIONS.switchAccount, ACTIONS.signOut],
      };
    case 'cloudReset':
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: 'The copy in your account was deleted',
        detail: 'This device still has all its data.',
        actions: [ACTIONS.uploadAfterReset, ACTIONS.turnOff],
      };
  }
}

/** The sync card's copy for `view`. `nowMs` is the real clock (view.now); `tz` the profile's zone. */
export function describeSync(view: SyncView, nowMs: number, tz: string): SyncCopy {
  // Only a linked device's queue is going anywhere; before the link, linking queues everything anyway.
  const n = view.linked ? view.pending : 0;
  const failed = view.linked ? view.failed : 0;
  const ago = view.lastSyncedAt !== undefined ? fmtAgo(view.lastSyncedAt, nowMs, tz) : undefined;
  const body = bodyFor(view, n, ago, nowMs);

  const facts: SyncCopy['facts'] = [];
  // otherAccount names both accounts in its detail.
  if (view.linked && view.sessionEmail && view.phase !== 'otherAccount') facts.push({ label: 'Account', value: view.sessionEmail });
  if (view.linked && ago && !body.saysLastSynced) facts.push({ label: 'Last synced', value: ago });

  const copy: SyncCopy = { tone: body.tone, pill: body.pill, title: body.title, facts, actions: body.actions ?? [] };
  if (body.detail) copy.detail = body.detail;
  if (body.progress) copy.progress = body.progress;
  if (failed > 0) copy.extra = `${changes(failed)} couldn't sync. ${failed === 1 ? 'It stays' : 'They stay'} on this device.`;
  return copy;
}
