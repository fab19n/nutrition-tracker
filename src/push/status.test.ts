import { describePush, SYNC_OFF_LINE, type PushView } from './status';

const NOW = Date.parse('2026-10-16T11:10:00.000Z');
const TZ = 'Asia/Kuala_Lumpur';

function view(patch: Partial<PushView>): PushView {
  return { phase: 'off', permission: 'default', hasRecord: false, now: NOW, failing: false, ...patch };
}

const actions = (v: PushView) => describePush(v, TZ).actions.map((a) => `${a.label} · ${a.variant}`);

describe('describePush', () => {
  it.each<[string, Partial<PushView>, { tone: string; pill: string; title: string; detail?: string; actions: string[] }]>([
    [
      'unconfigured',
      { phase: 'unconfigured' },
      { tone: 'off', pill: 'Off', title: "Reminders aren't set up in this version", detail: 'This copy of the app has no reminder service, so nothing is sent.', actions: [] },
    ],
    [
      'devServer',
      { phase: 'devServer' },
      {
        tone: 'off',
        pill: 'Off',
        title: 'Reminders work in the built app',
        detail: 'The dev server has no service worker. Try them with npm run build and npm run preview, or on your phone.',
        actions: [],
      },
    ],
    [
      'unsupported',
      { phase: 'unsupported' },
      { tone: 'off', pill: 'Off', title: "This browser can't show reminders", detail: 'Open Kira Makan in Chrome on your phone, installed from the browser menu.', actions: [] },
    ],
    [
      'iosNeedsInstall',
      { phase: 'iosNeedsInstall' },
      { tone: 'off', pill: 'Off', title: 'Add Kira Makan to your Home Screen first', detail: 'On iPhone, reminders only reach the app opened from the Home Screen.', actions: [] },
    ],
    [
      'demo',
      { phase: 'demo' },
      { tone: 'off', pill: 'Off', title: 'Off in demo mode', detail: 'The sample week never sends reminders. Leave demo and set up to use them.', actions: [] },
    ],
    ['starting', { phase: 'starting' }, { tone: 'busy', pill: 'Checking', title: 'Checking this device…', actions: [] }],
    ['checking', { phase: 'checking' }, { tone: 'busy', pill: 'Checking', title: 'Checking this device…', actions: [] }],
    [
      'signedOut',
      { phase: 'signedOut' },
      {
        tone: 'off',
        pill: 'Off',
        title: 'Sign in to get reminders',
        detail: 'Reminders come from your account, so this device needs to be signed in.',
        actions: ['Sign in · primary'],
      },
    ],
    [
      'signedOut with a record',
      { phase: 'signedOut', hasRecord: true },
      {
        tone: 'attention',
        pill: 'Needs you',
        title: 'Sign in to manage reminders',
        detail: 'Reminders can still arrive on this device. Sign in again to check them or turn them off.',
        actions: ['Sign in · primary'],
      },
    ],
    [
      'denied',
      { phase: 'denied', permission: 'denied' },
      {
        tone: 'attention',
        pill: 'Blocked',
        title: 'Notifications are blocked',
        detail: "Allow them for Kira Makan in your phone's settings: long-press the app icon › App info › Notifications. Then come back here.",
        actions: [],
      },
    ],
    [
      'off',
      { phase: 'off' },
      {
        tone: 'off',
        pill: 'Off',
        title: 'Off on this device',
        detail: 'Turn on to get the reminders below here. Each device is turned on separately.',
        actions: ['Turn on · primary'],
      },
    ],
    ['turningOn', { phase: 'turningOn', busy: 'on' }, { tone: 'busy', pill: 'Turning on', title: 'Turning on…', actions: [] }],
    [
      'on, nothing sent yet',
      { phase: 'on', hasRecord: true, device: { failures: 0 } },
      {
        tone: 'ok',
        pill: 'On',
        title: 'On for this device',
        detail: 'Nothing sent yet. Send a test to see how they look.',
        actions: ['Send a test notification · secondary', 'Turn off · ghost'],
      },
    ],
    [
      'on, failing',
      { phase: 'on', hasRecord: true, device: { failures: 3 }, failing: true },
      {
        tone: 'attention',
        pill: 'Needs a look',
        title: "Reminders aren't reaching this device",
        detail: "The last few couldn't be delivered. Setting it up again usually fixes it.",
        actions: ['Set up again · primary', 'Turn off · ghost'],
      },
    ],
    [
      'problem notSetUp',
      { phase: 'problem', error: 'notSetUp' },
      {
        tone: 'attention',
        pill: 'Needs setup',
        title: "Reminders aren't set up on the server",
        detail: 'Your diary is fine. Once the reminder setup is done in Supabase, tap Try again.',
        actions: ['Try again · primary', 'Turn off · ghost'],
      },
    ],
    [
      'problem offline',
      { phase: 'problem', error: 'offline' },
      { tone: 'waiting', pill: 'Waiting', title: 'Waiting for a connection', detail: "It finishes turning on when you're back online.", actions: ['Try again · secondary'] },
    ],
    [
      'problem unreachable',
      { phase: 'problem', error: 'unreachable' },
      { tone: 'waiting', pill: 'Waiting', title: "Can't reach your account", detail: 'It finishes turning on once your account can be reached.', actions: ['Try again · secondary'] },
    ],
    [
      'problem unavailable',
      { phase: 'problem', error: 'unavailable' },
      { tone: 'waiting', pill: 'Waiting', title: "Can't reach your account", detail: 'It finishes turning on once your account can be reached.', actions: ['Try again · secondary'] },
    ],
    [
      'problem needsSignIn',
      { phase: 'problem', error: 'needsSignIn' },
      { tone: 'attention', pill: 'Needs you', title: 'Sign in again to get reminders', detail: "Your account didn't accept this device's sign-in.", actions: ['Sign in · primary'] },
    ],
    [
      'problem noWorker',
      { phase: 'problem', error: 'noWorker' },
      { tone: 'attention', pill: 'Needs a look', title: "The app isn't ready yet", detail: 'Close Kira Makan fully and open it again, then try again.', actions: ['Try again · primary'] },
    ],
    [
      'problem rejected',
      { phase: 'problem', error: 'rejected' },
      {
        tone: 'attention',
        pill: 'Needs a look',
        title: "Couldn't turn on reminders",
        detail: 'Something went wrong on the way. Try again in a moment.',
        actions: ['Try again · primary', 'Turn off · ghost'],
      },
    ],
    [
      'problem failed',
      { phase: 'problem', error: 'failed' },
      {
        tone: 'attention',
        pill: 'Needs a look',
        title: "Couldn't turn on reminders",
        detail: 'Something went wrong on the way. Try again in a moment.',
        actions: ['Try again · primary', 'Turn off · ghost'],
      },
    ],
  ])('%s', (_name, patch, expected) => {
    const v = view(patch);
    const copy = describePush(v, TZ);
    expect({ tone: copy.tone, pill: copy.pill, title: copy.title, detail: copy.detail, actions: actions(v) }).toEqual({ detail: undefined, ...expected });
    expect(copy.extra).toBeUndefined();
  });

  it('says when the last reminder went, on the real clock in the profile zone', () => {
    const at = (ms: number) => describePush(view({ phase: 'on', device: { failures: 0, lastOkAt: new Date(ms).toISOString() } }), TZ).detail;
    expect(at(NOW - 5 * 60_000)).toBe('Last reminder sent 5 min ago');
    // 10:00am MYT the same day.
    expect(at(Date.parse('2026-10-16T02:00:00.000Z'))).toBe('Last reminder sent at 10:00am');
    expect(at(Date.parse('2026-10-15T13:40:00.000Z'))).toBe('Last reminder sent yesterday at 9:40pm');
  });

  it("says nothing about the last one until the account has answered", () => {
    expect(describePush(view({ phase: 'on' }), TZ).detail).toBeUndefined();
  });

  it('adds the sync line only when on and sync is off here', () => {
    const on = view({ phase: 'on', device: { failures: 0 } });
    expect(describePush(on, TZ, { syncOff: true }).extra).toBe(SYNC_OFF_LINE);
    expect(SYNC_OFF_LINE).toBe('Sync is off on this device, so reminders go by what your account last had.');
    expect(describePush(view({ phase: 'off' }), TZ, { syncOff: true }).extra).toBeUndefined();
  });

  it('says Sending… on the test button while a test goes', () => {
    const copy = describePush(view({ phase: 'on', device: { failures: 0 }, busy: 'test' }), TZ);
    expect(copy.actions.map((a) => a.label)).toEqual(['Sending…', 'Turn off']);
  });

  it('follows the copy rules everywhere', () => {
    const phases: Partial<PushView>[] = [
      { phase: 'unconfigured' },
      { phase: 'devServer' },
      { phase: 'unsupported' },
      { phase: 'iosNeedsInstall' },
      { phase: 'demo' },
      { phase: 'signedOut', hasRecord: true },
      { phase: 'denied' },
      { phase: 'off' },
      { phase: 'on', device: { failures: 0 } },
      { phase: 'on', failing: true },
      ...(['notSetUp', 'offline', 'unreachable', 'needsSignIn', 'noWorker', 'failed'] as const).map((error) => ({ phase: 'problem' as const, error })),
    ];
    for (const patch of phases) {
      const copy = describePush(view(patch), TZ, { syncOff: true });
      for (const text of [copy.title, copy.detail ?? '', copy.extra ?? '', ...copy.actions.map((a) => a.label)]) {
        expect(text).not.toMatch(/!|please|successfully/i);
      }
    }
  });
});
