/**
 * What S38's device card says (decision §10.19): the copy for each phase of this device's reminders,
 * written for SyncStatus. Pure, so every phase is tested here without a browser or an engine.
 * Actions come back as ids; the screen connects each one.
 */
import { fmtAgo } from '@/domain/format';
import type { SyncTone } from '@/sync/status';
import type { PushEngineState } from './engine';

/** The engine's state with the real time it was read at (again every minute), and whether sends keep failing. */
export interface PushView extends PushEngineState {
  now: number;
  /** 'on', but the last few couldn't be delivered (3 failures in a row). */
  failing: boolean;
}

export type PushActionId = 'signIn' | 'turnOn' | 'turnOff' | 'test' | 'retry' | 'repair';

export interface PushAction {
  id: PushActionId;
  label: string;
  variant: 'primary' | 'secondary' | 'ghost';
}

export interface PushCopy {
  tone: SyncTone;
  pill: string;
  title: string;
  detail?: string;
  /** The amber line: sync is off on this device. */
  extra?: string;
  actions: PushAction[];
}

/** Sends that failed in a row before the card says reminders aren't arriving. */
export const FAILING_AFTER = 3;

export const SYNC_OFF_LINE = 'Sync is off on this device, so reminders go by what your account last had.';

const ACTIONS = {
  signIn: { id: 'signIn', label: 'Sign in', variant: 'primary' },
  turnOn: { id: 'turnOn', label: 'Turn on', variant: 'primary' },
  turnOff: { id: 'turnOff', label: 'Turn off', variant: 'ghost' },
  test: { id: 'test', label: 'Send a test notification', variant: 'secondary' },
  retry: { id: 'retry', label: 'Try again', variant: 'primary' },
  retryQuiet: { id: 'retry', label: 'Try again', variant: 'secondary' },
  repair: { id: 'repair', label: 'Set up again', variant: 'primary' },
} as const satisfies Record<string, PushAction>;

function bodyFor(view: PushView, tz: string): PushCopy {
  switch (view.phase) {
    case 'unconfigured':
      return {
        tone: 'off',
        pill: 'Off',
        title: "Reminders aren't set up in this version",
        detail: 'This copy of the app has no reminder service, so nothing is sent.',
        actions: [],
      };
    case 'devServer':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Reminders work in the built app',
        detail: 'The dev server has no service worker. Try them with npm run build and npm run preview, or on your phone.',
        actions: [],
      };
    case 'unsupported':
      return {
        tone: 'off',
        pill: 'Off',
        title: "This browser can't show reminders",
        detail: 'Open Kira Makan in Chrome on your phone, installed from the browser menu.',
        actions: [],
      };
    case 'iosNeedsInstall':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Add Kira Makan to your Home Screen first',
        detail: 'On iPhone, reminders only reach the app opened from the Home Screen.',
        actions: [],
      };
    case 'demo':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Off in demo mode',
        detail: 'The sample week never sends reminders. Leave demo and set up to use them.',
        actions: [],
      };
    case 'starting':
    case 'checking':
      return { tone: 'busy', pill: 'Checking', title: 'Checking this device…', actions: [] };
    case 'signedOut':
      return view.hasRecord
        ? {
            tone: 'attention',
            pill: 'Needs you',
            title: 'Sign in to manage reminders',
            detail: 'Reminders can still arrive on this device. Sign in again to check them or turn them off.',
            actions: [ACTIONS.signIn],
          }
        : {
            tone: 'off',
            pill: 'Off',
            title: 'Sign in to get reminders',
            detail: 'Reminders come from your account, so this device needs to be signed in.',
            actions: [ACTIONS.signIn],
          };
    case 'denied':
      return {
        tone: 'attention',
        pill: 'Blocked',
        title: 'Notifications are blocked',
        detail: "Allow them for Kira Makan in your phone's settings: long-press the app icon › App info › Notifications. Then come back here.",
        actions: [],
      };
    case 'off':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Off on this device',
        detail: 'Turn on to get the reminders below here. Each device is turned on separately.',
        actions: [ACTIONS.turnOn],
      };
    case 'turningOn':
      return { tone: 'busy', pill: 'Turning on', title: 'Turning on…', actions: [] };
    case 'on': {
      if (view.failing) {
        return {
          tone: 'attention',
          pill: 'Needs a look',
          title: "Reminders aren't reaching this device",
          detail: "The last few couldn't be delivered. Setting it up again usually fixes it.",
          actions: [ACTIONS.repair, ACTIONS.turnOff],
        };
      }
      const lastOk = view.device?.lastOkAt === undefined ? NaN : Date.parse(view.device.lastOkAt);
      const copy: PushCopy = { tone: 'ok', pill: 'On', title: 'On for this device', actions: [ACTIONS.test, ACTIONS.turnOff] };
      // Until the account has answered there is nothing to say about the last one.
      if (Number.isFinite(lastOk)) copy.detail = `Last reminder sent ${fmtAgo(lastOk, view.now, tz)}`;
      else if (view.device) copy.detail = 'Nothing sent yet. Send a test to see how they look.';
      return copy;
    }
    case 'problem':
      switch (view.error) {
        case 'notSetUp':
          return {
            tone: 'attention',
            pill: 'Needs setup',
            title: "Reminders aren't set up on the server",
            detail: 'Your diary is fine. Once the reminder setup is done in Supabase, tap Try again.',
            actions: [ACTIONS.retry, ACTIONS.turnOff],
          };
        case 'offline':
          return {
            tone: 'waiting',
            pill: 'Waiting',
            title: 'Waiting for a connection',
            detail: "It finishes turning on when you're back online.",
            actions: [ACTIONS.retryQuiet],
          };
        case 'unreachable':
        case 'unavailable':
          return {
            tone: 'waiting',
            pill: 'Waiting',
            title: "Can't reach your account",
            detail: 'It finishes turning on once your account can be reached.',
            actions: [ACTIONS.retryQuiet],
          };
        case 'needsSignIn':
          return {
            tone: 'attention',
            pill: 'Needs you',
            title: 'Sign in again to get reminders',
            detail: "Your account didn't accept this device's sign-in.",
            actions: [ACTIONS.signIn],
          };
        case 'noWorker':
          return {
            tone: 'attention',
            pill: 'Needs a look',
            title: "The app isn't ready yet",
            detail: 'Close Kira Makan fully and open it again, then try again.',
            actions: [ACTIONS.retry],
          };
        default:
          return {
            tone: 'attention',
            pill: 'Needs a look',
            title: "Couldn't turn on reminders",
            detail: 'Something went wrong on the way. Try again in a moment.',
            actions: [ACTIONS.retry, ACTIONS.turnOff],
          };
      }
  }
}

/** The device card's copy for `view` (usePushView). `tz` is the profile's zone, for "Last reminder sent at 9:40pm". */
export function describePush(view: PushView, tz: string, opts: { syncOff?: boolean } = {}): PushCopy {
  const copy = bodyFor(view, tz);
  if (opts.syncOff && view.phase === 'on') copy.extra = SYNC_OFF_LINE;
  if (view.busy === 'test') copy.actions = copy.actions.map((a) => (a.id === 'test' ? { ...a, label: 'Sending…' } : a));
  return copy;
}
