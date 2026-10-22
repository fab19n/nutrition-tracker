/**
 * S38 Reminders copy (decision §10.19): times, the quiet hours row, gap nudges' lock, the Settings
 * row's sub-line and the toasts. Pure, so every case is tested without a screen.
 */
import { fmtClock } from '@/domain/format';
import type { QuietWindow, ResolvedReminderPrefs } from '@/domain/reminders';
import type { TestOutcome } from '@/push/remote';
import type { PushView } from '@/push/status';

/** 600 → '10am', 420 → '7am', 720 → '12pm'. */
export function checkInLabel(min: number): string {
  return fmtClock(min, { compact: true });
}

/** '11pm–8am' or '11pm to 8am'. */
export function quietRange(w: { fromMin: number; untilMin: number }, sep: '–' | ' to '): string {
  return `${fmtClock(w.fromMin, { compact: true })}${sep}${fmtClock(w.untilMin, { compact: true })}`;
}

const QUIET_SUB: Record<QuietWindow['source'], string> = {
  custom: 'Your own hours',
  sleepTaps: 'From your sleep taps',
  meals: 'From when you usually eat, until you tap Going to sleep a few times',
  default: 'For now. Tap Going to sleep in the evening and these follow your nights.',
};

/** The Quiet hours row: the window and where it comes from. */
export function quietRow(w: QuietWindow): { value: string; sub: string } {
  return { value: quietRange(w, '–'), sub: QUIET_SUB[w.source] };
}

/** "Follow my sleep taps" sub-line: what auto gives right now. */
export function quietAutoSub(w: QuietWindow): string {
  return `Right now ${quietRange(w, ' to ')}`;
}

/** Gap nudges' row: locked with progress until 14 complete days, then a switch. */
export function gapRow(gap: { unlocked: boolean; have: number; need: number }): { sub: string; value?: string } {
  if (gap.unlocked) return { sub: 'When about 6 hours go by without a log and you usually eat by then. One a day at most.' };
  return { sub: `Switches on once the app knows your pattern (${Math.min(gap.have, gap.need)} of ${gap.need} days)`, value: 'Locked' };
}

/** Settings › Reminders' sub-line (S19). */
export function remindersRowSub(view: PushView, prefs: ResolvedReminderPrefs | undefined): string {
  switch (view.phase) {
    case 'unconfigured':
      return 'Not available in this version';
    case 'demo':
      return 'Off in demo mode';
    case 'problem':
      return 'Needs a look';
    case 'on':
      if (view.failing) return 'Needs a look';
      return prefs?.checkIn ? `On · check-in at ${checkInLabel(prefs.checkInAtMin)}` : 'On for this device';
    case 'starting':
    case 'checking':
    case 'turningOn':
      return 'Checking this device…';
    case 'signedOut':
      return view.hasRecord ? 'Sign in to manage reminders' : 'Off on this device';
    default:
      return 'Off on this device';
  }
}

/** S38's toasts, and the Turn on reminders sheet's. */
export const REMINDER_TOASTS = {
  on: 'Reminders on for this device',
  off: 'Reminders off for this device',
  blocked: 'Chrome blocked notifications for Kira Makan',
  saveFailed: "Couldn't save that. Try again.",
  quietFromTaps: 'Quiet hours follow your sleep taps',
} as const;

/** After the check-in time sheet: 'Morning check-in at 9am'. */
export function checkInToast(min: number): string {
  return `Morning check-in at ${checkInLabel(min)}`;
}

/** After the quiet hours sheet: 'Quiet hours 11pm to 8am', or back to the sleep taps. */
export function quietToast(w: { fromMin: number; untilMin: number } | null): string {
  return w ? `Quiet hours ${quietRange(w, ' to ')}` : REMINDER_TOASTS.quietFromTaps;
}

/** The toast after Send a test notification. */
export function testToast(outcome: TestOutcome): string {
  if (outcome.ok) return 'Test sent. It should arrive in a few seconds.';
  switch (outcome.kind) {
    case 'offline':
      return "You're offline. Try again when you're back online.";
    case 'unreachable':
    case 'unavailable':
      return "Couldn't reach your account. Try again in a moment.";
    case 'notSetUp':
      return "Reminders aren't set up on the server yet.";
    case 'needsSignIn':
      return 'Sign in again, then send a test.';
    case 'rateLimited':
      return "That's a few tests already. Try again in a few minutes.";
    case 'keyMismatch':
      return 'This app and the server use different reminder keys. See DEPLOY.md part 10.';
    default:
      return "Couldn't send a test. Try again.";
  }
}
