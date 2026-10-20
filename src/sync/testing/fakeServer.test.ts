// @vitest-environment node
import { SyncError } from '../errors';
import type { PushReply } from '../remote';
import { createFakeServer, FakeRpcError, type FakeServer } from './fakeServer';

const USER = 'user-1';
const T0 = Date.parse('2026-10-16T11:00:00.000Z');
/** The two halves of 🍜, for text that holds only one. */
const HIGH = String.fromCharCode(0xd83c);
const LOW = String.fromCharCode(0xdf5c);

let serverNow: number;
let server: FakeServer;
let dataset: string;

beforeEach(() => {
  serverNow = T0;
  server = createFakeServer({ now: () => serverNow });
  dataset = server.hello(USER).dataset;
});

/** The self-test's first row: weights/selftest at 70 kg, made 1 Jan 2026. */
const row1 = { t: 'weights', k: 'selftest', del: false, data: { id: 'selftest', kg: 70 }, base: null, at: '2026-01-01T00:00:00.000Z', n: 'selftest-n1' };

function push(device: string, changes: unknown, sentAt: string | null = new Date(serverNow).toISOString(), set = dataset): PushReply {
  return server.push(USER, { p_dataset: set, p_device: device, p_sent_at: sentAt, p_changes: changes });
}

function rpcError(run: () => unknown): FakeRpcError {
  try {
    run();
  } catch (error) {
    if (error instanceof FakeRpcError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('the self-test cases (supabase/sync-selftest.sql)', () => {
  it('runs the same sequence with the same answers', () => {
    let r = push('selftest-a', [row1]);
    expect(r.results[0]).toMatchObject({ s: 'ok' }); // a new row applies
    const rev1 = r.results[0]?.s === 'ok' ? r.results[0].rev : -1;

    r = push('selftest-a', [row1]);
    expect(r.results[0]).toEqual({ i: 0, s: 'ok', rev: rev1 }); // a retried push adds no revision
    expect(r.head).toBe(r.prevHead);

    r = push('selftest-b', [{ ...row1, data: { id: 'selftest', kg: 71 }, at: '2025-12-31T00:00:00.000Z', n: 'selftest-n2' }]);
    expect(r.results[0]).toMatchObject({ s: 'lost', rev: rev1, del: false, data: { kg: 70 } }); // an older edit that never saw the current copy loses

    r = push('selftest-b', [{ ...row1, del: true, data: null, base: rev1, at: '2025-01-01T00:00:00.000Z', n: 'selftest-n3' }]);
    expect(r.results[0]).toMatchObject({ s: 'ok' }); // an edit made on top of the current copy applies, whatever its clock says

    r = push('selftest-b', [{ t: 'profile', k: 'me', del: false, data: { id: 'me', demoMode: true }, base: null, at: '2026-01-01T00:00:00.000Z', n: 'selftest-n4' }]);
    expect(r.results[0]).toEqual({ i: 0, s: 'invalid' }); // demo data never syncs

    const page = server.pull(USER, rev1, 10);
    expect(page.rows.some((x) => x.k === 'selftest' && x.del)).toBe(true); // pull returns the tombstone

    r = push('selftest-b', [
      { t: 'weights', k: 'selftest-2', del: false, data: { id: 'selftest-2' }, base: null, at: '2026-02-30T00:00:00.000Z', n: 'selftest-n5' },
      { t: 'weights', k: 'selftest-3', del: false, data: { id: 'selftest-3' }, base: null, at: '2026-01-01T00:00:00.000Z', n: 'selftest-n6' },
    ]);
    expect(r.results.map((x) => x.s)).toEqual(['invalid', 'ok']); // a bad row is answered invalid and the rest of the batch applies
  });
});

describe('sync_push conflict rules', () => {
  const edit = (kg: number, n: string, extra: Record<string, unknown> = {}) => ({ ...row1, data: { id: 'selftest', kg }, n, ...extra });

  type Case = { name: string; first: { device: string; at?: string }; second: { device: string; at?: string; base?: 'current' | 'old' | null }; wins: boolean };
  const cases: Case[] = [
    { name: 'base match applies, even with an older clock', first: { device: 'a' }, second: { device: 'b', at: '2025-01-01T00:00:00.000Z', base: 'current' }, wins: true },
    { name: 'the same device applies, even with an older clock', first: { device: 'a' }, second: { device: 'a', at: '2025-01-01T00:00:00.000Z' }, wins: true },
    { name: 'an older concurrent edit loses', first: { device: 'a' }, second: { device: 'b', at: '2025-12-31T00:00:00.000Z' }, wins: false },
    { name: 'an older edit on a stale base loses', first: { device: 'a' }, second: { device: 'b', at: '2025-12-31T00:00:00.000Z', base: 'old' }, wins: false },
    { name: 'a later concurrent edit wins', first: { device: 'a' }, second: { device: 'b', at: '2026-01-02T00:00:00.000Z' }, wins: true },
    { name: 'a tie goes to the larger device id', first: { device: 'a' }, second: { device: 'b', at: '2026-01-01T00:00:00.000Z' }, wins: true },
    { name: 'a tie loses to a larger device id', first: { device: 'b' }, second: { device: 'a', at: '2026-01-01T00:00:00.000Z' }, wins: false },
  ];

  it.each(cases)('$name', ({ first, second, wins }) => {
    const r1 = push(first.device, [edit(70, 'n1', first.at ? { at: first.at } : {})]);
    const rev1 = r1.results[0]?.s === 'ok' ? r1.results[0].rev : -1;
    const base = second.base === 'current' ? rev1 : second.base === 'old' ? rev1 - 1 : null;
    const r2 = push(second.device, [edit(71, 'n2', { at: second.at, base })]);
    expect(r2.results[0]?.s).toBe(wins ? 'ok' : 'lost');
    expect(server.live(USER).weights?.selftest?.kg).toBe(wins ? 71 : 70);
    expect(r2.head).toBe(wins ? r1.head + 1 : r1.head);
  });

  it('applies a new key, and a retry with the same nonce answers ok without a new revision', () => {
    const r1 = push('a', [row1]);
    expect(r1).toMatchObject({ prevHead: 0, head: 1, results: [{ i: 0, s: 'ok', rev: 1 }] });
    const retry = push('a', [row1]);
    expect(retry).toMatchObject({ prevHead: 1, head: 1, results: [{ i: 0, s: 'ok', rev: 1 }] });
    expect(server.head(USER)).toBe(1);
  });

  it('removes the device clock offset before comparing edits', () => {
    // Device a runs 10 minutes slow: its edit at 11:05 on its clock was made at 11:15 server time.
    const slow = (t: number) => new Date(t - 10 * 60_000).toISOString();
    serverNow = T0 + 20 * 60_000;
    push('b', [edit(70, 'n1', { at: '2026-10-16T11:10:00.000Z' })]);
    const r = push('a', [edit(71, 'n2', { at: slow(T0 + 15 * 60_000) })], slow(serverNow));
    expect(r.results[0]?.s).toBe('ok');
    expect(server.rows(USER)[0]?.changedAt).toBe(BigInt(T0 + 15 * 60_000) * 1000n);
  });

  it('clamps an edit from a clock in the future to the server time', () => {
    serverNow = T0;
    push('a', [edit(70, 'n1', { at: '2027-01-01T00:00:00.000Z' })]);
    expect(server.pull(USER, 0, 10).rows[0]?.at).toBe('2026-10-16T11:00:00+00:00');
    // So a later real edit from another device still wins.
    serverNow = T0 + 1000;
    const r = push('b', [edit(71, 'n2', { at: new Date(T0 + 1000).toISOString() })]);
    expect(r.results[0]?.s).toBe('ok');
  });

  it('gives tombstones the same rules: a later edit brings the row back, an older one loses', () => {
    push('a', [row1]);
    push('a', [{ ...row1, del: true, data: null, at: '2026-01-02T00:00:00.000Z', n: 'n-del' }]);
    expect(server.live(USER).weights).toBeUndefined();
    expect(push('b', [edit(72, 'n-old', { at: '2026-01-01T12:00:00.000Z' })]).results[0]).toMatchObject({ s: 'lost', del: true, data: null });
    expect(push('b', [edit(73, 'n-new', { at: '2026-01-03T00:00:00.000Z' })]).results[0]?.s).toBe('ok');
    expect(server.live(USER).weights?.selftest).toEqual({ id: 'selftest', kg: 73 });
  });
});

describe('sync_push refusals', () => {
  it('answers bad rows invalid one by one and applies the rest', () => {
    const good = (k: string) => ({ ...row1, k, data: { id: k }, n: `n-${k}` });
    const r = push('a', [
      good('ok-1'),
      { ...good('x'), t: '1bad' },
      { ...good('x'), k: '' },
      { ...good('x'), k: 'k'.repeat(201) },
      { ...good('x'), n: undefined },
      { ...good('x'), n: 'n'.repeat(65) },
      { ...good('x'), at: '2026-01-01 00:00:00Z' },
      { ...good('x'), at: '2026-01-01T00:00:00+08:00' },
      { ...good('x'), at: '2026-13-01T00:00:00.000Z' },
      { ...good('x'), base: 2 ** 64 },
      { ...good('x'), data: null },
      { ...good('x'), data: [1] },
      { ...good('x'), data: undefined },
      { ...good('x'), data: { id: 'x', blob: 'a'.repeat(262_144) } },
      { t: 'profile', k: 'me', del: true, data: null, base: null, at: row1.at, n: 'n-p1' },
      { t: 'profile', k: 'me', del: false, data: { id: 'me', demoMode: true }, base: null, at: row1.at, n: 'n-p2' },
      'not a change',
      good('ok-2'),
    ]);
    expect(r.results.map((x) => x.s)).toEqual(['ok', ...Array<string>(16).fill('invalid'), 'ok']);
    expect(Object.keys(server.live(USER).weights ?? {})).toEqual(['ok-1', 'ok-2']);
    expect(r.head).toBe(2);
  });

  it('accepts a real profile, a numeric base and the longest key and nonce', () => {
    const r = push('a', [
      { t: 'profile', k: 'me', del: false, data: { id: 'me', demoMode: false }, base: null, at: row1.at, n: 'n-p' },
      { ...row1, k: 'k'.repeat(200), n: 'n'.repeat(64), base: 1.4, at: '2026-01-01T00:00:00.123456Z' },
    ]);
    expect(r.results.map((x) => x.s)).toEqual(['ok', 'ok']);
    expect(server.pull(USER, 1, 1).rows[0]?.at).toBe('2026-01-01T00:00:00.123456+00:00');
  });

  it.each([
    { name: 'a bad device id', run: () => push('bad device', [row1]), status: 400, code: 'PT400' },
    { name: 'a missing device id', run: () => push('', [row1]), status: 400, code: 'PT400' },
    { name: 'more than 200 changes', run: () => push('a', Array.from({ length: 201 }, () => row1)), status: 400, code: 'PT400' },
    { name: 'changes that are not a list', run: () => push('a', { 0: row1 }), status: 400, code: 'PT400' },
    { name: 'a dataset that does not match', run: () => push('a', [row1], undefined, crypto.randomUUID()), status: 409, code: 'PT409' },
    { name: 'a dataset that is not a uuid', run: () => push('a', [row1], undefined, 'nope'), status: 400, code: '22P02' },
    { name: 'a sent time that is not a time', run: () => push('a', [row1], 'yesterday'), status: 400, code: '22007' },
    { name: 'a NUL character', run: () => push('a', [{ ...row1, data: { id: 'selftest', note: 'a\u0000b' } }]), status: 400, code: '22P05' },
    { name: 'half a surrogate pair', run: () => push('a', [{ ...row1, data: { id: 'selftest', note: `a${HIGH}b` } }]), status: 400, code: '22P02' },
    { name: 'half a surrogate pair in a key', run: () => push('a', [row1, { ...row1, data: { id: 'selftest', [LOW]: 1 } }]), status: 400, code: '22P02' },
    { name: 'no signed-in user', run: () => server.push(null, { p_dataset: dataset, p_device: 'a', p_sent_at: null, p_changes: [] }), status: 401, code: 'PT401' },
  ])('fails the whole call for $name', ({ run, status, code }) => {
    expect(rpcError(run)).toMatchObject({ status, code });
    expect(server.head(USER)).toBe(0);
  });

  it('takes a whole surrogate pair, and answers half of one as PostgREST does', () => {
    expect(push('a', [{ ...row1, data: { id: 'selftest', note: `mee ${HIGH}${LOW}` } }]).results[0]?.s).toBe('ok');
    expect(server.live(USER).weights?.selftest?.note).toBe('mee 🍜');
    expect(rpcError(() => push('a', [{ ...row1, data: { id: 'selftest', note: `${LOW}${HIGH}` } }])).toJSON()).toEqual({
      code: '22P02',
      message: 'invalid input syntax for type json',
      details: 'Unicode low surrogate must follow a high surrogate.',
      hint: null,
    });
    expect(server.head(USER)).toBe(1);
  });

  it('gives 409 before the account exists', () => {
    expect(rpcError(() => server.push('user-2', { p_dataset: dataset, p_device: 'a', p_sent_at: null, p_changes: [] }))).toMatchObject({
      status: 409,
      code: 'PT409',
    });
  });

  it('takes an empty batch without a new revision', () => {
    expect(push('a', [])).toEqual({ dataset, prevHead: 0, head: 0, results: [] });
  });
});

describe('sync_hello, sync_pull and sync_keys', () => {
  it('says what the account holds', () => {
    expect(server.hello(USER)).toEqual({ dataset, head: 0, counts: {}, lastChangeAt: null });
    serverNow = Date.parse('2026-10-16T11:30:00.250Z');
    server.seed(USER, [
      { t: 'weights', k: 'w1', data: { id: 'w1' } },
      { t: 'weights', k: 'w2', data: { id: 'w2' } },
      { t: 'weights', k: 'w3', data: null },
      { t: 'meals', k: 'm1', data: { id: 'm1' } },
    ]);
    expect(server.hello(USER)).toEqual({ dataset, head: 4, counts: { weights: 2, meals: 1 }, lastChangeAt: '2026-10-16T11:30:00.25+00:00' });
  });

  it('pulls rows after a revision in order, with the limit clamped', () => {
    server.seed(USER, Array.from({ length: 5 }, (_, i) => ({ t: 'weights', k: `w${i}`, data: { id: `w${i}` } })));
    expect(server.pull(USER, 2, 2).rows.map((r) => r.rev)).toEqual([3, 4]);
    expect(server.pull(USER, -5, 0).rows.map((r) => r.rev)).toEqual([1]);
    expect(server.pull(USER, null, null).rows).toHaveLength(5);
    expect(server.pull(USER, 5, 10)).toEqual({ dataset, head: 5, rows: [] });
    expect(server.pull(USER, 0, 1).rows[0]).toEqual({ t: 'weights', k: 'w0', rev: 1, del: false, data: { id: 'w0' }, at: '2026-10-16T11:00:00+00:00' });
    expect(rpcError(() => server.pull(USER, 1.5, 10))).toMatchObject({ status: 400, code: '22P02' });
  });

  it('answers with no dataset before the account exists', () => {
    expect(server.pull('user-2', 0, 10)).toEqual({ dataset: null, head: 0, rows: [] });
    expect(server.keys('user-2')).toEqual({ dataset: null, head: 0, keys: [] });
    expect(rpcError(() => server.pull(null, 0, 10))).toMatchObject({ status: 401, code: 'PT401' });
  });

  it('lists live keys as [t, k, rev] arrays, as sync_keys does', () => {
    server.seed(USER, [
      { t: 'weights', k: 'w1', data: { id: 'w1' } },
      { t: 'weights', k: 'gone', data: null },
    ]);
    expect(server.keys(USER)).toEqual({ dataset, head: 2, keys: [['weights', 'w1', 1]] });
    expect(server.call(USER, 'sync_keys')).toEqual({ dataset, head: 2, keys: [['weights', 'w1', 1]] });
  });

  it('starts again with a new dataset when the account copy is wiped', () => {
    server.seed(USER, [{ t: 'weights', k: 'w1', data: { id: 'w1' } }]);
    server.wipe(USER);
    const after = server.hello(USER);
    expect(after.dataset).not.toBe(dataset);
    expect(after).toMatchObject({ head: 0, counts: {}, lastChangeAt: null });
    expect(rpcError(() => push('a', [row1]))).toMatchObject({ status: 409 });
  });
});

describe('call', () => {
  it('answers JSON as the RPC does and records every call', () => {
    const reply = server.call(USER, 'sync_push', { p_dataset: dataset, p_device: 'a', p_sent_at: null, p_changes: [row1] });
    expect(reply).toEqual({ dataset, prevHead: 0, head: 1, results: [{ i: 0, s: 'ok', rev: 1 }] });
    expect(server.call(USER, 'sync_pull', { p_after: 0 })).toMatchObject({ head: 1, rows: [{ k: 'selftest' }] });
    expect(server.calls.map((c) => c.fn)).toEqual(['sync_hello', 'sync_push', 'sync_pull']);
  });

  it('shares nothing with the caller', () => {
    const change = { ...row1, data: { id: 'selftest', kg: 70 } };
    push('a', [change]);
    change.data.kg = 1;
    expect(server.live(USER).weights?.selftest?.kg).toBe(70);
  });
});

describe('remote', () => {
  const ctx = (signal = new AbortController().signal) => ({ userId: USER, signal });

  it('parses keys into objects and stamps p_sent_at from the device clock', async () => {
    const remote = server.remote({ clock: () => T0 - 60_000 });
    const reply = await remote.push(ctx(), dataset, 'device-a', [{ ...row1, t: 'weights', at: new Date(T0 - 60_000).toISOString() }]);
    expect(reply.results[0]?.s).toBe('ok');
    expect(server.calls.at(-1)?.args.p_sent_at).toBe(new Date(T0 - 60_000).toISOString());
    // Made "now" on a clock a minute slow: stored at the server's now.
    expect(server.rows(USER)[0]?.changedAt).toBe(BigInt(T0) * 1000n);
    expect(await remote.keys(ctx())).toEqual({ dataset, head: 1, keys: [{ t: 'weights', k: 'selftest', rev: 1 }] });
    expect(await remote.hello(ctx())).toMatchObject({ dataset, head: 1, counts: { weights: 1 } });
    expect((await remote.pull(ctx(), 0, 10)).rows).toHaveLength(1);
  });

  it('turns server errors into SyncErrors', async () => {
    const remote = server.remote();
    await expect(remote.push(ctx(), crypto.randomUUID(), 'device-a', [])).rejects.toMatchObject({ kind: 'cloudReset' });
    await expect(remote.push(ctx(), dataset, 'bad device', [])).rejects.toMatchObject({ kind: 'rejected' });
    await expect(remote.hello({ userId: '', signal: new AbortController().signal })).rejects.toMatchObject({ kind: 'needsSignIn' });
    await expect(remote.push(ctx(), dataset, 'bad device', [])).rejects.toBeInstanceOf(SyncError);
  });

  it('lets a test fail, delay or lose a call', async () => {
    let lose = true;
    const remote = server.remote({
      before: (call) => {
        if (call.fn === 'sync_hello') throw new SyncError('offline');
      },
      after: (call) => {
        if (call.fn === 'sync_push' && lose) {
          lose = false;
          throw new SyncError('unreachable');
        }
      },
    });
    await expect(remote.hello(ctx())).rejects.toMatchObject({ kind: 'offline' });
    await expect(remote.push(ctx(), dataset, 'device-a', [{ ...row1, t: 'weights' }])).rejects.toMatchObject({ kind: 'unreachable' });
    expect(server.head(USER)).toBe(1); // the server applied it; only the answer was lost
    const retry = await remote.push(ctx(), dataset, 'device-a', [{ ...row1, t: 'weights' }]);
    expect(retry).toMatchObject({ prevHead: 1, head: 1, results: [{ s: 'ok', rev: 1 }] });
  });

  it('answers aborted for an aborted signal, before or after the server answered', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(server.remote().pull(ctx(aborted.signal), 0, 10)).rejects.toMatchObject({ kind: 'aborted' });

    const later = new AbortController();
    const remote = server.remote({ after: () => later.abort() });
    await expect(remote.push(ctx(later.signal), dataset, 'device-a', [{ ...row1, t: 'weights' }])).rejects.toMatchObject({ kind: 'aborted' });
    expect(server.head(USER)).toBe(1);
  });
});
