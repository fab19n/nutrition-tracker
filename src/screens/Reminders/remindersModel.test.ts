import { resolveReminderPrefs } from '@/domain/reminders';
import type { TestOutcome } from '@/push/remote';
import type { PushView } from '@/push/status';
import { checkInLabel, checkInToast, gapRow, quietAutoSub, quietRange, quietRow, quietToast, REMINDER_TOASTS, remindersRowSub, testToast } from './remindersModel';

const view = (patch: Partial<PushView>): PushView => ({ phase: 'off', permission: 'default', hasRecord: false, now: 0, failing: false, ...patch });
const PREFS = resolveReminderPrefs(undefined);

describe('times', () => {
  it('labels check-in times', () => {
    expect([420, 480, 540, 600, 660, 720].map(checkInLabel)).toEqual(['7am', '8am', '9am', '10am', '11am', '12pm']);
  });

  it('writes a quiet window both ways', () => {
    expect(quietRange({ fromMin: 1380, untilMin: 480 }, '–')).toBe('11pm–8am');
    expect(quietRange({ fromMin: 60, untilMin: 585 }, ' to ')).toBe('1am to 9:45am');
    expect(quietRange({ fromMin: 0, untilMin: 360 }, '–')).toBe('12am–6am');
  });
});

describe('quietRow', () => {
  it.each([
    [{ fromMin: 1380, untilMin: 480, source: 'custom' as const }, '11pm–8am', 'Your own hours'],
    [{ fromMin: 60, untilMin: 585, source: 'sleepTaps' as const }, '1am–9:45am', 'From your sleep taps'],
    [{ fromMin: 30, untilMin: 570, source: 'meals' as const }, '12:30am–9:30am', 'From when you usually eat, until you tap Going to sleep a few times'],
    [{ fromMin: 1380, untilMin: 480, source: 'default' as const }, '11pm–8am', 'For now. Tap Going to sleep in the evening and these follow your nights.'],
  ])('%o', (window, value, sub) => {
    expect(quietRow(window)).toEqual({ value, sub });
  });

  it('says what auto gives right now', () => {
    expect(quietAutoSub({ fromMin: 60, untilMin: 585, source: 'sleepTaps' })).toBe('Right now 1am to 9:45am');
    expect(quietAutoSub({ fromMin: 1380, untilMin: 480, source: 'default' })).toBe('Right now 11pm to 8am');
  });
});

describe('gapRow', () => {
  it('is locked with progress until 14 complete days', () => {
    expect(gapRow({ unlocked: false, have: 5, need: 14 })).toEqual({ sub: 'Switches on once the app knows your pattern (5 of 14 days)', value: 'Locked' });
    expect(gapRow({ unlocked: true, have: 17, need: 14 })).toEqual({ sub: 'When about 6 hours go by without a log and you usually eat by then. One a day at most.' });
  });
});

describe('remindersRowSub', () => {
  it.each<[string, Partial<PushView>, string]>([
    ['unconfigured', { phase: 'unconfigured' }, 'Not available in this version'],
    ['devServer', { phase: 'devServer' }, 'Off on this device'],
    ['unsupported', { phase: 'unsupported' }, 'Off on this device'],
    ['iosNeedsInstall', { phase: 'iosNeedsInstall' }, 'Off on this device'],
    ['demo', { phase: 'demo' }, 'Off in demo mode'],
    ['starting', { phase: 'starting' }, 'Checking this device…'],
    ['checking', { phase: 'checking' }, 'Checking this device…'],
    ['turningOn', { phase: 'turningOn' }, 'Checking this device…'],
    ['signedOut', { phase: 'signedOut' }, 'Off on this device'],
    ['signedOut with a record', { phase: 'signedOut', hasRecord: true }, 'Sign in to manage reminders'],
    ['denied', { phase: 'denied' }, 'Off on this device'],
    ['off', { phase: 'off' }, 'Off on this device'],
    ['on', { phase: 'on' }, 'On · check-in at 10am'],
    ['on, failing', { phase: 'on', failing: true }, 'Needs a look'],
    ['problem', { phase: 'problem', error: 'notSetUp' }, 'Needs a look'],
  ])('%s', (_name, patch, sub) => {
    expect(remindersRowSub(view(patch), PREFS)).toBe(sub);
  });

  it('follows the check-in setting', () => {
    expect(remindersRowSub(view({ phase: 'on' }), resolveReminderPrefs({ checkInAtMin: 540 }))).toBe('On · check-in at 9am');
    expect(remindersRowSub(view({ phase: 'on' }), resolveReminderPrefs({ checkIn: false }))).toBe('On for this device');
    expect(remindersRowSub(view({ phase: 'on' }), undefined)).toBe('On for this device');
  });
});

describe('testToast', () => {
  it.each<[TestOutcome, string]>([
    [{ ok: true }, 'Test sent. It should arrive in a few seconds.'],
    [{ ok: false, kind: 'offline' }, "You're offline. Try again when you're back online."],
    [{ ok: false, kind: 'unreachable' }, "Couldn't reach your account. Try again in a moment."],
    [{ ok: false, kind: 'unavailable' }, "Couldn't reach your account. Try again in a moment."],
    [{ ok: false, kind: 'notSetUp' }, "Reminders aren't set up on the server yet."],
    [{ ok: false, kind: 'needsSignIn' }, 'Sign in again, then send a test.'],
    [{ ok: false, kind: 'rateLimited' }, "That's a few tests already. Try again in a few minutes."],
    [{ ok: false, kind: 'keyMismatch' }, 'This app and the server use different reminder keys. See DEPLOY.md part 10.'],
    [{ ok: false, kind: 'gone' }, "Couldn't send a test. Try again."],
    [{ ok: false, kind: 'notSubscribed' }, "Couldn't send a test. Try again."],
    [{ ok: false, kind: 'pushFailed' }, "Couldn't send a test. Try again."],
    [{ ok: false, kind: 'failed' }, "Couldn't send a test. Try again."],
  ])('%o', (outcome, toast) => {
    expect(testToast(outcome)).toBe(toast);
  });
});

describe('sheet toasts', () => {
  it('say what was saved', () => {
    expect(checkInToast(540)).toBe('Morning check-in at 9am');
    expect(checkInToast(720)).toBe('Morning check-in at 12pm');
    expect(quietToast({ fromMin: 1380, untilMin: 480 })).toBe('Quiet hours 11pm to 8am');
    expect(quietToast({ fromMin: 0, untilMin: 420 })).toBe('Quiet hours 12am to 7am');
    expect(quietToast(null)).toBe('Quiet hours follow your sleep taps');
  });
});

describe('copy rules', () => {
  it('holds for every line', () => {
    const lines = [
      ...(['custom', 'sleepTaps', 'meals', 'default'] as const).flatMap((source) => Object.values(quietRow({ fromMin: 1380, untilMin: 480, source }))),
      ...Object.values(gapRow({ unlocked: false, have: 3, need: 14 })),
      ...Object.values(gapRow({ unlocked: true, have: 14, need: 14 })),
      ...(['unconfigured', 'demo', 'on', 'starting', 'off', 'problem'] as const).map((phase) => remindersRowSub(view({ phase }), PREFS)),
      ...(['offline', 'unreachable', 'notSetUp', 'needsSignIn', 'rateLimited', 'keyMismatch', 'failed'] as const).map((kind) => testToast({ ok: false, kind })),
      testToast({ ok: true }),
      ...Object.values(REMINDER_TOASTS),
      checkInToast(540),
      quietToast({ fromMin: 1380, untilMin: 480 }),
      quietToast(null),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!|please|successfully/i);
      expect(line.charAt(0)).toBe(line.charAt(0).toUpperCase());
    }
  });
});
