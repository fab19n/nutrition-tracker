// @vitest-environment node
// One run of the reminder job (runTick) with a fake store and a fake push sender.
import { describe, expect, it, vi } from 'vitest';
import { deliverTest, parseReminderContext, runTick, type ReminderStore } from '../supabase/functions/send-reminders/core';
import type { DeliveryReport, PushSender, PushTarget, SendOptions, VapidConfig } from '../supabase/functions/send-reminders/webpush';

const VAPID: VapidConfig = { publicKey: 'B-current-key', privateKey: 'private', subject: 'https://kira-makan.vercel.app' };
/** Thu 22 Oct 2026, 10:00am in Kuala Lumpur. */
const NOW = Date.parse('2026-10-22T02:00:00.000Z');
const TODAY = '2026-10-22';

const PHONE = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: 'p1', auth: 'a1', vapidKey: VAPID.publicKey };
const LAPTOP = { endpoint: 'https://fcm.googleapis.com/fcm/send/laptop', p256dh: 'p2', auth: 'a2', vapidKey: VAPID.publicKey };
const OLD = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', p256dh: 'p3', auth: 'a3', vapidKey: 'B-old-key' };

/** push_context for a user whose yesterday isn't confirmed, who logged lunch two days ago. */
function context(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: { timeZone: 'Asia/Kuala_Lumpur', rolloverHour: 5, startedOn: '2026-09-01', reminders: null, demoMode: null },
    days: [],
    meals: [{ d: '2026-10-20', at: '2026-10-20T05:00:00.000Z', sl: 'lunch', g: false }],
    completeDays: 0,
    periods: [],
    goals: [],
    targetNotice: null,
    subscriptions: [PHONE, LAPTOP],
    sent: [],
    ...patch,
  };
}

function fakeStore(contexts: Record<string, unknown>, opts: { claim?: boolean; failFor?: string } = {}) {
  const calls: string[] = [];
  const store = {
    dueUsers: vi.fn(async () => Object.keys(contexts)),
    context: vi.fn(async (userId: string, fromDay: string) => {
      calls.push(`context ${userId} ${fromDay}`);
      if (userId === opts.failFor) throw Object.assign(new Error('push_context failed'), { code: '57014' });
      return contexts[userId];
    }),
    claim: vi.fn(async (userId: string, kind: string, date: string) => {
      calls.push(`claim ${userId} ${kind} ${date}`);
      return opts.claim ?? true;
    }),
    release: vi.fn(async (userId: string, kind: string, date: string) => {
      calls.push(`release ${userId} ${kind} ${date}`);
    }),
    report: vi.fn(async (userId: string, kind: string | null, date: string | null, results: DeliveryReport[]) => {
      calls.push(`report ${userId} ${kind} ${date} ${results.map((r) => r.outcome).join(',')}`);
    }),
  } satisfies ReminderStore;
  return { store, calls };
}

function fakeSender(answer: (target: PushTarget) => Partial<DeliveryReport> = () => ({ outcome: 'ok' }), calls?: string[]) {
  const sent: { target: PushTarget; payload: string; opts: SendOptions }[] = [];
  const sender: PushSender = {
    send: vi.fn(async (target: PushTarget, payload: string, opts: SendOptions) => {
      calls?.push(`send ${target.endpoint}`);
      sent.push({ target, payload, opts });
      return { endpoint: target.endpoint, outcome: 'ok', ...answer(target) } as DeliveryReport;
    }),
  };
  return { sender, sent };
}

describe('runTick', () => {
  it('does nothing without users', async () => {
    const { store } = fakeStore({});
    const { sender } = fakeSender();
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toEqual({ users: 0, sent: 0, skipped: {} });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('claims a due check-in, then sends it to every device with this key and reports', async () => {
    const { store, calls } = fakeStore({ u1: context() });
    const { sender, sent } = fakeSender(undefined, calls);
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 1, skipped: {} });
    expect(calls).toEqual([
      'context u1 2026-09-16',
      `claim u1 checkIn ${TODAY}`,
      `send ${PHONE.endpoint}`,
      `send ${LAPTOP.endpoint}`,
      `report u1 checkIn ${TODAY} ok,ok`,
    ]);
    expect(sent.map((s) => s.opts)).toEqual([
      { ttl: 14400, topic: 'km-checkIn', urgency: 'high' },
      { ttl: 14400, topic: 'km-checkIn', urgency: 'high' },
    ]);
    expect(JSON.parse(sent[0]?.payload ?? '')).toEqual({
      v: 1,
      kind: 'checkIn',
      title: 'Quick check',
      body: "Was yesterday's log complete?",
      url: '/?sheet=checkin',
    });
    expect(store.release).not.toHaveBeenCalled();
  });

  it('sends nothing when another run claimed it first', async () => {
    const { store } = fakeStore({ u1: context() }, { claim: false });
    const { sender } = fakeSender();
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 0, skipped: { claimed: 1 } });
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.report).not.toHaveBeenCalled();
  });

  it('releases the claim when no device took it and it may work later', async () => {
    const { store, calls } = fakeStore({ u1: context() });
    const { sender } = fakeSender((t) => (t.endpoint === PHONE.endpoint ? { outcome: 'failed', error: 'http 503', transient: true } : { outcome: 'gone' }));
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 0, skipped: {} });
    expect(calls.slice(-2)).toEqual([`report u1 checkIn ${TODAY} failed,gone`, `release u1 checkIn ${TODAY}`]);
  });

  it('keeps the claim when a device is gone (the row goes) and none is worth retrying', async () => {
    const { store } = fakeStore({ u1: context({ subscriptions: [PHONE] }) });
    const { sender } = fakeSender(() => ({ outcome: 'gone', status: 410 }));
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toMatchObject({ sent: 1 });
    expect(store.report).toHaveBeenCalledWith('u1', 'checkIn', TODAY, [{ endpoint: PHONE.endpoint, outcome: 'gone', status: 410 }]);
    expect(store.release).not.toHaveBeenCalled();
  });

  it('skips devices subscribed with an old key, and claims nothing when none is left', async () => {
    const mixed = fakeStore({ u1: context({ subscriptions: [PHONE, OLD] }) });
    const one = fakeSender();
    await runTick({ store: mixed.store, sender: one.sender, vapid: VAPID }, NOW);
    expect(one.sent.map((s) => s.target.endpoint)).toEqual([PHONE.endpoint]);
    expect(mixed.store.report).toHaveBeenCalledWith('u1', 'checkIn', TODAY, [
      { endpoint: PHONE.endpoint, outcome: 'ok' },
      { endpoint: OLD.endpoint, outcome: 'skipped', error: 'oldKey' },
    ]);

    const stale = fakeStore({ u1: context({ subscriptions: [OLD] }) });
    const none = fakeSender();
    expect(await runTick({ store: stale.store, sender: none.sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 0, skipped: { noDevice: 1 } });
    expect(stale.store.claim).not.toHaveBeenCalled();
    expect(stale.store.report).toHaveBeenCalledWith('u1', null, null, [{ endpoint: OLD.endpoint, outcome: 'skipped', error: 'oldKey' }]);
  });

  it('counts why a user got nothing', async () => {
    const { store } = fakeStore({
      bad: 'not json',
      none: context({ profile: null }),
      demo: context({ profile: { timeZone: 'Asia/Kuala_Lumpur', rolloverHour: 5, startedOn: '2026-09-01', demoMode: true } }),
      done: context({ days: [{ d: '2026-10-21', s: 'complete', sl: null }] }),
    });
    const { sender } = fakeSender();
    expect(await runTick({ store, sender, vapid: VAPID }, NOW)).toEqual({
      users: 4,
      sent: 0,
      skipped: { badContext: 1, noProfile: 1, demo: 1, nothingDue: 1 },
    });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("doesn't let one user's failure stop the next", async () => {
    const { store } = fakeStore({ u1: context(), u2: context() }, { failFor: 'u1' });
    const { sender, sent } = fakeSender();
    const log = vi.fn();
    expect(await runTick({ store, sender, vapid: VAPID, log }, NOW)).toEqual({ users: 2, sent: 1, skipped: { error: 1 } });
    expect(sent).toHaveLength(2);
    expect(log).toHaveBeenCalledWith('a user failed: 57014');
    // Logs carry codes only.
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/u1|fcm/);
  });

  it('never pushes a target suggestion some device has seen, even if a later mark lost its seenAt', async () => {
    const targetNotice = { key: 'v1:2026-10-19', weekStart: '2026-10-19', weeks: 4, markedAt: '2026-10-21T23:00:00.000Z' };
    // Yesterday confirmed, so the check-in isn't due: only the target suggestion could be.
    const days = [{ d: '2026-10-21', s: 'complete', sl: null }];
    const unseen = fakeStore({ u1: context({ days, targetNotice, subscriptions: [PHONE] }) });
    const first = fakeSender();
    expect(await runTick({ store: unseen.store, sender: first.sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 1, skipped: {} });
    expect(JSON.parse(first.sent[0]?.payload ?? '')).toMatchObject({ kind: 'targetSuggestion' });

    const seen = fakeStore({ u1: context({ days, targetNotice, targetNoticeSeen: { key: targetNotice.key, seenAt: '2026-10-21T23:30:00.000Z' }, subscriptions: [PHONE] }) });
    const second = fakeSender();
    expect(await runTick({ store: seen.store, sender: second.sender, vapid: VAPID }, NOW)).toEqual({ users: 1, sent: 0, skipped: { nothingDue: 1 } });
    expect(second.sent).toHaveLength(0);
    expect(seen.store.claim).not.toHaveBeenCalled();
  });

  it('sends one reminder per user per run, the most important first', async () => {
    const targetNotice = { key: 'v1:2026-10-19', weekStart: '2026-10-19', weeks: 4, markedAt: '2026-10-21T23:00:00.000Z' };
    const { store } = fakeStore({ u1: context({ targetNotice, subscriptions: [PHONE] }) });
    const { sender, sent } = fakeSender();
    await runTick({ store, sender, vapid: VAPID }, NOW);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ kind: 'checkIn' });
  });
});

describe('parseReminderContext', () => {
  it('reads push_context and drops what has the wrong shape', () => {
    const parsed = parseReminderContext(
      context({
        days: [{ d: '2026-10-21', s: 'complete', sl: '2026-10-21T16:00:00.000Z' }, { s: 'complete' }, 'x', { d: '2026-10-20', s: null, sl: null }],
        meals: [{ d: '2026-10-20', at: '2026-10-20T05:00:00.000Z', sl: 'lunch', g: false }, { d: '2026-10-20' }, { d: '2026-10-19', at: 'x', g: true, sl: null }],
        completeDays: 'many',
        periods: [{ id: 'p1', g: 'cut', f: '2026-09-01', t: null, c: '2026-09-01T00:00:00.000Z' }, { id: 'p2', g: 'pause' }],
        goals: [{ id: 'cut', tp: 'cut' }, { tp: 'pause' }, { id: 'pause', tp: null }],
        targetNotice: { key: 'k', weekStart: '2026-10-19', weeks: 4, markedAt: '2026-10-21T23:00:00.000Z', seenAt: null },
        targetNoticeSeen: { key: 'k', seenAt: '2026-10-22T00:00:00.000Z' },
        subscriptions: [PHONE, { endpoint: 'https://x', p256dh: 'p' }],
        sent: [{ kind: 'gap', date: '2026-10-21', at: '2026-10-21T12:00:00+00:00' }, { kind: 'gap' }],
      }),
    );
    expect(parsed).toEqual({
      input: {
        profile: { timeZone: 'Asia/Kuala_Lumpur', rolloverHour: 5, startedOn: '2026-09-01' },
        days: [{ day: '2026-10-21', status: 'complete', sleepAt: '2026-10-21T16:00:00.000Z' }, { day: '2026-10-20' }],
        meals: [
          { day: '2026-10-20', at: '2026-10-20T05:00:00.000Z', slot: 'lunch', guess: false },
          { day: '2026-10-19', at: 'x', guess: true },
        ],
        completeDays: 0,
        periods: [{ id: 'p1', goalId: 'cut', from: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' }],
        goals: [{ id: 'cut', template: 'cut' }, { id: 'pause' }],
        targetNotice: { key: 'k', weekStart: '2026-10-19', weeks: 4, markedAt: '2026-10-21T23:00:00.000Z' },
        targetNoticeSeen: { key: 'k', seenAt: '2026-10-22T00:00:00.000Z' },
        sent: [{ kind: 'gap', date: '2026-10-21', at: '2026-10-21T12:00:00+00:00' }],
      },
      targets: [PHONE],
    });
  });

  it('drops a seen row without a key', () => {
    for (const targetNoticeSeen of [null, 'k', { seenAt: '2026-10-22T00:00:00.000Z' }, { key: '' }]) {
      expect(parseReminderContext(context({ targetNoticeSeen }))?.input.targetNoticeSeen).toBeUndefined();
    }
    expect(parseReminderContext(context({ targetNoticeSeen: { key: 'k' } }))?.input.targetNoticeSeen).toEqual({ key: 'k' });
  });

  it('is null for anything but an object', () => {
    expect(parseReminderContext(null)).toBeNull();
    expect(parseReminderContext([])).toBeNull();
    expect(parseReminderContext('{}')).toBeNull();
    expect(parseReminderContext({})).toEqual({ input: { days: [], meals: [], completeDays: 0, periods: [], goals: [], sent: [] }, targets: [] });
  });
});

describe('deliverTest', () => {
  it('sends the test notification for 5 minutes', async () => {
    const { sender, sent } = fakeSender();
    expect(await deliverTest({ sender, vapid: VAPID }, PHONE)).toEqual({ endpoint: PHONE.endpoint, outcome: 'ok' });
    expect(sent[0]?.opts).toEqual({ ttl: 300, topic: 'km-test', urgency: 'high' });
    expect(JSON.parse(sent[0]?.payload ?? '')).toEqual({
      v: 1,
      kind: 'test',
      title: 'Test notification',
      body: 'Reminders from Kira Makan show up like this.',
      url: '/more/reminders',
    });
  });
});
