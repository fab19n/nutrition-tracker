import { DEFAULT_TZ } from '@/domain/day';
import type { SyncPhase } from './engine';
import { describeSync, type SyncCopy, type SyncView } from './status';

/** Fri 16 Oct 2026, 7:10pm in Kuala Lumpur. */
const NOW = Date.parse('2026-10-16T11:10:00.000Z');
const MINUTE = 60_000;

function view(over: Partial<SyncView> = {}): SyncView {
  return {
    phase: 'idle',
    pending: 0,
    failed: 0,
    linked: true,
    linkedEmail: 'you@example.com',
    sessionEmail: 'you@example.com',
    lastSyncedAt: NOW - 5 * MINUTE,
    now: NOW,
    ...over,
  };
}

function copyFor(over: Partial<SyncView> = {}): SyncCopy {
  return describeSync(view(over), NOW, DEFAULT_TZ);
}

function actionLabels(copy: SyncCopy): string[] {
  return copy.actions.map((a) => a.label);
}

describe('describeSync', () => {
  it.each<{ phase: SyncPhase; over?: Partial<SyncView>; tone: SyncCopy['tone']; pill: string; title: string; detail?: string; actions: string[] }>([
    { phase: 'starting', tone: 'busy', pill: 'Syncing', title: 'Checking your account…', actions: [] },
    {
      phase: 'signedOut',
      over: { linked: false, sessionEmail: undefined },
      tone: 'off',
      pill: 'Off',
      title: 'Sync is off',
      detail: 'Sign in to keep a copy of your diary in your account and use it on another device.',
      actions: [],
    },
    {
      phase: 'demo',
      over: { linked: false },
      tone: 'off',
      pill: 'Off',
      title: 'Sync is off in demo mode',
      detail: 'Sample data never leaves this device.',
      actions: [],
    },
    {
      phase: 'paused',
      over: { linked: false },
      tone: 'off',
      pill: 'Off',
      title: 'Sync is off on this device',
      detail: 'Your data stays here until you turn it back on.',
      actions: ['Turn on sync'],
    },
    { phase: 'syncing', tone: 'busy', pill: 'Syncing', title: 'Syncing…', actions: [] },
    {
      phase: 'notSetUp',
      tone: 'attention',
      pill: 'Needs you',
      title: "Sync isn't set up on the server",
      detail: 'Run supabase/sync.sql in the Supabase SQL Editor (see DEPLOY.md).',
      actions: ['Try again'],
    },
    {
      phase: 'choose',
      over: { linked: false },
      tone: 'attention',
      pill: 'Needs you',
      title: 'Your account already has a diary',
      detail: 'It came from another device. Choose which copy to keep.',
      actions: ['Choose'],
    },
    {
      phase: 'otherAccount',
      over: { sessionEmail: 'other@example.com' },
      tone: 'attention',
      pill: 'Needs you',
      title: 'This device syncs with another account',
      detail: "Synced with you@example.com. You're signed in as other@example.com.",
      actions: ['Switch to this account', 'Sign out'],
    },
    {
      phase: 'cloudReset',
      tone: 'attention',
      pill: 'Needs you',
      title: 'The copy in your account was deleted',
      detail: 'This device still has all its data.',
      actions: ["Upload this device's data", 'Turn off sync'],
    },
    {
      phase: 'unconfigured',
      over: { linked: false },
      tone: 'off',
      pill: 'Off',
      title: 'Sync is off',
      detail: "Sync isn't set up in this version of the app.",
      actions: [],
    },
    {
      phase: 'noProfile',
      over: { linked: false },
      tone: 'off',
      pill: 'Off',
      title: 'Sync is off',
      detail: 'Sync starts once the app is set up.',
      actions: [],
    },
  ])('$phase: $title', ({ phase, over, tone, pill, title, detail, actions }) => {
    const copy = copyFor({ phase, ...over });
    expect(copy).toMatchObject({ tone, pill, title });
    expect(copy.detail).toBe(detail);
    expect(actionLabels(copy)).toEqual(actions);
    expect(copy.extra).toBeUndefined();
    expect(copy.progress).toBeUndefined();
  });

  it('gives each action an id and a variant', () => {
    expect(copyFor({ phase: 'otherAccount' }).actions).toEqual([
      { id: 'switchAccount', label: 'Switch to this account', variant: 'primary' },
      { id: 'signOut', label: 'Sign out', variant: 'ghost' },
    ]);
    expect(copyFor({ phase: 'cloudReset' }).actions.map((a) => a.id)).toEqual(['uploadAfterReset', 'turnOff']);
    expect(copyFor({ phase: 'idle' }).actions).toEqual([{ id: 'syncNow', label: 'Sync now', variant: 'secondary' }]);
    expect(copyFor({ phase: 'needsSignIn' }).actions).toEqual([{ id: 'signIn', label: 'Sign in', variant: 'primary' }]);
    expect(copyFor({ phase: 'paused' }).actions.map((a) => a.id)).toEqual(['turnOn']);
    expect(copyFor({ phase: 'error' }).actions.map((a) => a.id)).toEqual(['retry']);
    expect(copyFor({ phase: 'notSetUp' }).actions.map((a) => a.id)).toEqual(['retry']);
    expect(copyFor({ phase: 'choose' }).actions.map((a) => a.id)).toEqual(['choose']);
  });

  describe('idle', () => {
    it('0 pending: up to date, with when it last synced', () => {
      const copy = copyFor({ phase: 'idle', pending: 0 });
      expect(copy).toMatchObject({ tone: 'ok', pill: 'Up to date', title: 'Up to date', detail: 'Last synced 5 min ago' });
      expect(actionLabels(copy)).toEqual(['Sync now']);
      // The detail says when, so the facts don't repeat it.
      expect(copy.facts).toEqual([{ label: 'Account', value: 'you@example.com' }]);
    });

    it('1 pending: one change waiting', () => {
      const copy = copyFor({ phase: 'idle', pending: 1 });
      expect(copy).toMatchObject({ tone: 'waiting', pill: 'Waiting', title: '1 change waiting', detail: 'It syncs in a moment.' });
      expect(actionLabels(copy)).toEqual(['Sync now']);
      expect(copy.facts).toEqual([
        { label: 'Account', value: 'you@example.com' },
        { label: 'Last synced', value: '5 min ago' },
      ]);
    });

    it('n pending: the count, grouped', () => {
      expect(copyFor({ phase: 'idle', pending: 3 })).toMatchObject({ title: '3 changes waiting', detail: 'They sync in a moment.' });
      expect(copyFor({ phase: 'idle', pending: 1240 }).title).toBe('1,240 changes waiting');
    });

    it('never synced yet: no detail', () => {
      const copy = copyFor({ phase: 'idle', lastSyncedAt: undefined });
      expect(copy.title).toBe('Up to date');
      expect(copy.detail).toBeUndefined();
      expect(copy.facts.map((f) => f.label)).toEqual(['Account']);
    });
  });

  describe('needsSignIn', () => {
    it.each([
      { pending: 0, detail: 'New entries wait on this device until you sign in.' },
      { pending: 1, detail: '1 change waits on this device until you sign in.' },
      { pending: 12, detail: '12 changes wait on this device until you sign in.' },
    ])('$pending pending', ({ pending, detail }) => {
      const copy = copyFor({ phase: 'needsSignIn', pending, sessionEmail: undefined });
      expect(copy).toMatchObject({ tone: 'attention', pill: 'Needs you', title: 'Sign in to keep syncing', detail });
      expect(actionLabels(copy)).toEqual(['Sign in']);
      // Signed out: no Account fact, but when it last synced.
      expect(copy.facts).toEqual([{ label: 'Last synced', value: '5 min ago' }]);
    });

    it('signed in, but the account refused the token: try again or sign out, not sign in', () => {
      const copy = copyFor({ phase: 'needsSignIn', signedIn: true, pending: 2 });
      expect(copy).toMatchObject({
        tone: 'attention',
        pill: 'Needs you',
        title: 'Sign in again to keep syncing',
        detail: "Your account didn't accept this sign-in. Try again, or sign out and in.",
      });
      expect(copy.actions).toEqual([
        { id: 'retry', label: 'Try again', variant: 'primary' },
        { id: 'signOut', label: 'Sign out', variant: 'ghost' },
      ]);
      expect(copy.facts.map((f) => f.label)).toEqual(['Account', 'Last synced']);
    });
  });

  describe('offline', () => {
    it.each([
      { pending: 1, detail: "1 change waits on this device and syncs when you're back online." },
      { pending: 7, detail: "7 changes wait on this device and sync when you're back online." },
    ])('$pending pending', ({ pending, detail }) => {
      const copy = copyFor({ phase: 'offline', pending });
      expect(copy).toMatchObject({ tone: 'waiting', pill: 'Offline', title: 'Offline', detail });
      expect(copy.actions).toEqual([]);
      expect(copy.facts.map((f) => f.label)).toEqual(['Account', 'Last synced']);
    });

    it('0 pending: everything is saved here, and when it last synced', () => {
      const copy = copyFor({ phase: 'offline', pending: 0, lastSyncedAt: NOW - 2 * 60 * MINUTE });
      expect(copy.detail).toBe('Everything is saved on this device. Last synced at 5:10pm.');
      expect(copy.facts.map((f) => f.label)).toEqual(['Account']);
    });

    it('0 pending, never synced', () => {
      expect(copyFor({ phase: 'offline', lastSyncedAt: undefined }).detail).toBe('Everything is saved on this device.');
    });

    it("an unlinked device's queue isn't counted: linking queues everything anyway", () => {
      const copy = copyFor({ phase: 'offline', pending: 40, linked: false, lastSyncedAt: undefined });
      expect(copy.detail).toBe('Everything is saved on this device.');
      expect(copy.facts).toEqual([]);
    });
  });

  describe('error', () => {
    it('retrying within 90 s: about a minute', () => {
      const copy = copyFor({ phase: 'error', retryAt: NOW + 30_000 });
      expect(copy).toMatchObject({
        tone: 'waiting',
        pill: 'Waiting',
        title: "Can't reach your account",
        detail: 'Your entries are safe on this device. Trying again in about a minute.',
      });
      expect(actionLabels(copy)).toEqual(['Try again']);
      expect(copyFor({ phase: 'error', retryAt: NOW + 89_999 }).detail).toContain('in about a minute.');
    });

    it('retrying in 90 s or more: a few minutes', () => {
      expect(copyFor({ phase: 'error', retryAt: NOW + 90_000 }).detail).toBe(
        'Your entries are safe on this device. Trying again in a few minutes.',
      );
      expect(copyFor({ phase: 'error', retryAt: NOW + 15 * MINUTE }).detail).toContain('in a few minutes.');
    });

    it('no retry due: just that the entries are safe', () => {
      expect(copyFor({ phase: 'error', retryAt: undefined }).detail).toBe('Your entries are safe on this device.');
    });

    it.each(['unreachable', 'unavailable'] as const)("%s: can't reach the account", (error) => {
      expect(copyFor({ phase: 'error', error, retryAt: NOW + 30_000 })).toMatchObject({
        title: "Can't reach your account",
        detail: 'Your entries are safe on this device. Trying again in about a minute.',
      });
    });

    it('rejected: the account refused it, and where to look', () => {
      const copy = copyFor({ phase: 'error', error: 'rejected', retryAt: NOW + 30_000 });
      expect(copy).toMatchObject({
        tone: 'waiting',
        pill: 'Waiting',
        title: 'Your account refused the last sync',
        detail: 'Your entries are safe on this device. It keeps trying; if this stays, check Supabase › Logs (DEPLOY.md).',
      });
      expect(actionLabels(copy)).toEqual(['Try again']);
    });

    it("failed: a problem that isn't the account's, so it blames nobody", () => {
      const copy = copyFor({ phase: 'error', error: 'failed', retryAt: NOW + 30_000 });
      expect(copy).toMatchObject({
        tone: 'waiting',
        pill: 'Waiting',
        title: 'Sync stopped on a problem',
        detail: 'Your entries are safe on this device. It keeps trying.',
      });
      expect(actionLabels(copy)).toEqual(['Try again']);
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/account|refused/i);
    });
  });

  describe('uploading', () => {
    it('shows done of total with the progress bar', () => {
      const copy = copyFor({ phase: 'uploading', pending: 1500, progress: { done: 340, total: 1840 }, lastSyncedAt: undefined });
      expect(copy).toMatchObject({ tone: 'busy', pill: 'Syncing', title: 'Backing up', detail: '340 of 1,840 entries' });
      expect(copy.progress).toEqual({ done: 340, total: 1840 });
      expect(copy.actions).toEqual([]);
    });

    it('clamps done to the total, and shows no bar before the total is known', () => {
      expect(copyFor({ phase: 'uploading', progress: { done: 1900, total: 1840 } })).toMatchObject({
        detail: '1,840 of 1,840 entries',
        progress: { done: 1840, total: 1840 },
      });
      const unknown = copyFor({ phase: 'uploading', progress: { done: 0, total: 0 } });
      expect(unknown.detail).toBeUndefined();
      expect(unknown.progress).toBeUndefined();
    });
  });

  describe("restoring (Use the account's data)", () => {
    it('shows about how many entries, with the progress bar', () => {
      const copy = copyFor({ phase: 'restoring', linked: false, progress: { done: 600, total: 1840 } });
      expect(copy).toMatchObject({
        tone: 'busy',
        pill: 'Syncing',
        title: "Getting your account's data",
        detail: '600 of about 1,840 entries. Keep the app open.',
        progress: { done: 600, total: 1840 },
      });
    });

    it('before the total is known', () => {
      const copy = copyFor({ phase: 'restoring', linked: false, progress: { done: 0, total: 0 } });
      expect(copy.detail).toBe('Keep the app open.');
      expect(copy.progress).toBeUndefined();
    });
  });

  describe('otherAccount', () => {
    it('names whichever accounts are known, and shows no Account fact', () => {
      expect(copyFor({ phase: 'otherAccount', linkedEmail: undefined, sessionEmail: 'b@example.com' }).detail).toBe(
        "You're signed in as b@example.com.",
      );
      expect(copyFor({ phase: 'otherAccount', sessionEmail: undefined }).detail).toBe('Synced with you@example.com.');
      expect(copyFor({ phase: 'otherAccount', linkedEmail: undefined, sessionEmail: undefined }).detail).toBeUndefined();
      expect(copyFor({ phase: 'otherAccount', sessionEmail: 'b@example.com' }).facts.map((f) => f.label)).toEqual(['Last synced']);
    });
  });

  describe('extra', () => {
    it.each([
      { failed: 1, extra: "1 change couldn't sync. It stays on this device." },
      { failed: 3, extra: "3 changes couldn't sync. They stay on this device." },
    ])('$failed failed', ({ failed, extra }) => {
      expect(copyFor({ phase: 'idle', failed }).extra).toBe(extra);
      expect(copyFor({ phase: 'error', failed }).extra).toBe(extra);
    });

    it('is left out with nothing failed', () => {
      expect(copyFor({ phase: 'idle', failed: 0 }).extra).toBeUndefined();
    });
  });

  describe('facts', () => {
    it('Account only when signed in and linked', () => {
      expect(copyFor({ phase: 'syncing' }).facts).toEqual([
        { label: 'Account', value: 'you@example.com' },
        { label: 'Last synced', value: '5 min ago' },
      ]);
      expect(copyFor({ phase: 'syncing', sessionEmail: undefined }).facts.map((f) => f.label)).toEqual(['Last synced']);
      expect(copyFor({ phase: 'signedOut', linked: false, sessionEmail: undefined }).facts).toEqual([]);
      expect(copyFor({ phase: 'choose', linked: false }).facts).toEqual([]);
    });

    it('Last synced reads on from its label', () => {
      const lastSynced = (at: number) => copyFor({ phase: 'syncing', lastSyncedAt: at }).facts.find((f) => f.label === 'Last synced')?.value;
      expect(lastSynced(NOW - 20_000)).toBe('just now');
      expect(lastSynced(NOW - 3 * 60 * MINUTE)).toBe('at 4:10pm');
      expect(lastSynced(Date.parse('2026-10-15T13:40:00.000Z'))).toBe('yesterday at 9:40pm');
      expect(lastSynced(Date.parse('2026-10-12T13:40:00.000Z'))).toBe('on Mon 12 Oct');
    });
  });
});
