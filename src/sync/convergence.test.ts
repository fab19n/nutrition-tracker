// @vitest-environment node
/*
 * Two capture-enabled devices and one fake account, driven through local.ts by a small cycle
 * (push, then pull) that stands in for the engine. Each device has its own clock: Date.now (which
 * capture stamps) answers for whichever device is acting.
 */
import { createActions } from '@/db/actions';
import { createDb, SYNC_TABLES, type KiraMakanDb } from '@/db/db';
import type { SyncLink } from '@/db/syncTypes';
import { setDemoClock } from '@/domain/clock';
import type { DayRecord, MealLog } from '@/domain/types';
import { SyncError } from './errors';
import { ackPush, applyPage, applyRestore, collectPush, linkEmptyAccount, readMeta, recordSuccess } from './local';
import type { PushChange, PushReply, PushResult, RemoteCtx, SyncRemote, WireRow } from './remote';
import { primaryKeyField, toServerRow, type JsonObject } from './rows';
import { createFakeServer, type FakeServer } from './testing/fakeServer';

const USER = 'user-1';
const DEFAULTS = { theme: 'system' as const };
/** Small pages and batches, so paging and batching run too. */
const PULL_LIMIT = 7;
const PUSH_ROWS = 5;
const MINUTE = 60_000;

interface Device {
  name: string;
  db: KiraMakanDb;
  remote: SyncRemote;
  /** This device's clock is the true time plus this. */
  skewMs: number;
  /** The next push reaches the server but its answer is lost. */
  loseNextReply: boolean;
}

let trueNow: number;
let acting: Device | undefined;
let server: FakeServer;
let devices: Device[];
/** Push answers by kind, across devices. */
let answers: Record<PushResult['s'], number>;

beforeEach(() => {
  trueNow = Date.parse('2026-10-16T11:00:00.000Z');
  acting = undefined;
  server = createFakeServer({ now: () => trueNow });
  devices = [];
  answers = { ok: 0, lost: 0, invalid: 0 };
  vi.spyOn(Date, 'now').mockImplementation(() => trueNow + (acting?.skewMs ?? 0));
});

afterEach(async () => {
  vi.restoreAllMocks();
  setDemoClock(false);
  await Promise.all(devices.map((d) => d.db.delete()));
});

function makeDevice(name: string, skewMs = 0): Device {
  const state = { skewMs, loseNextReply: false };
  const remote = server.remote({
    clock: () => trueNow + state.skewMs,
    after: (call, reply) => {
      if (call.fn !== 'sync_push') return;
      for (const result of (reply as PushReply).results) answers[result.s] += 1;
      if (state.loseNextReply) {
        state.loseNextReply = false;
        throw new SyncError('unreachable', 'The answer was lost');
      }
    },
  });
  const device = Object.assign(state, { name, db: createDb(`convergence-${name}-${crypto.randomUUID()}`, { capture: () => true }), remote });
  devices.push(device);
  return device;
}

/** Runs `fn` as `device`: its writes are stamped with its clock. */
async function on<T>(device: Device, fn: () => Promise<T>): Promise<T> {
  const before = acting;
  acting = device;
  try {
    return await fn();
  } finally {
    acting = before;
  }
}

function ctx(): RemoteCtx {
  return { userId: USER, signal: new AbortController().signal };
}

async function linkOf(device: Device): Promise<SyncLink> {
  const link = (await readMeta(device.db)).link;
  if (!link) throw new Error(`${device.name} is not linked`);
  return link;
}

/**
 * One cycle, as the engine runs it: push until nothing is left, then pull until a short page.
 * The hooks stand for edits made while the cycle is out: `whilePushing` before the first push is
 * acknowledged, `beforePull` between the push and the pull.
 */
function sync(
  device: Device,
  hooks: { whilePushing?: (sent: readonly PushChange[]) => Promise<unknown>; beforePull?: () => Promise<unknown> } = {},
): Promise<void> {
  return on(device, async () => {
    let link = await linkOf(device);
    for (let round = 0; round < 100; round += 1) {
      const batch = await collectPush(device.db, link, { rows: PUSH_ROWS });
      if (!batch) break;
      const reply = batch.changes.length > 0
        ? await device.remote.push(ctx(), link.dataset, link.deviceId, batch.changes)
        : { dataset: link.dataset, prevHead: link.cursor, head: link.cursor, results: [] };
      if (round === 0) await hooks.whilePushing?.(batch.changes);
      await ackPush(device.db, link, batch, reply, DEFAULTS);
      link = await linkOf(device);
    }
    await hooks.beforePull?.();
    for (let round = 0; round < 100; round += 1) {
      const cursor = link.cursor;
      const page = await device.remote.pull(ctx(), cursor, PULL_LIMIT);
      await applyPage(device.db, link, cursor, page, PULL_LIMIT, DEFAULTS);
      link = await linkOf(device);
      if (page.rows.length < PULL_LIMIT) break;
    }
    await recordSuccess(device.db, link, Date.now());
  });
}

/** One page pulled and applied, as another tab of the same device would. */
function pullOnce(device: Device): Promise<unknown> {
  return on(device, async () => {
    const link = await linkOf(device);
    const page = await device.remote.pull(ctx(), link.cursor, PULL_LIMIT);
    return applyPage(device.db, link, link.cursor, page, PULL_LIMIT, DEFAULTS);
  });
}

/** Sets up on `device` and uploads it to the empty account. */
async function setUpFirst(device: Device): Promise<void> {
  await on(device, async () => {
    await createActions(device.db).completeSetup({
      age: 34,
      sex: 'male',
      heightCm: 172,
      weightKg: 78.6,
      activity: 'light',
      paceKgPerWeek: 0.5,
      dailyMinimumKcal: 1400,
      regulars: [],
      places: [{ name: 'Home', type: 'home' }],
      rolloverHour: 5,
      timeZone: 'Asia/Kuala_Lumpur',
    });
    const summary = await device.remote.hello(ctx());
    await linkEmptyAccount(device.db, { userId: USER, summary, now: Date.now() });
  });
  await sync(device);
}

/** Restores a new device from the account before setup. */
function restore(device: Device): Promise<void> {
  return on(device, async () => {
    const { dataset } = await device.remote.hello(ctx());
    const rows = new Map<string, WireRow>();
    let after = 0;
    let head = 0;
    for (;;) {
      const page = await device.remote.pull(ctx(), after, PULL_LIMIT);
      for (const row of page.rows) rows.set(`${row.t}/${row.k}`, row);
      head = page.head;
      if (page.rows.length < PULL_LIMIT) break;
      after = page.rows.at(-1)?.rev ?? after;
    }
    await applyRestore(device.db, { dataset, head, rows: [...rows.values()] }, { userId: USER, expect: 'noProfile', defaults: DEFAULTS, now: Date.now() });
  });
}

/** Two devices on one account: A set up and uploaded, B restored from it. */
async function pair(bSkewMs = 0): Promise<[Device, Device]> {
  const a = makeDevice('a');
  const b = makeDevice('b', bSkewMs);
  await setUpFirst(a);
  await restore(b);
  return [a, b];
}

/** Every synced row as the account would hold it, by table and key. */
async function snapshotOf(device: Device): Promise<Record<string, Record<string, JsonObject>>> {
  const out: Record<string, Record<string, JsonObject>> = {};
  for (const table of SYNC_TABLES) {
    for (const row of await device.db.table<Record<string, unknown>, string>(table).toArray()) {
      (out[table] ??= {})[String(row[primaryKeyField(table)])] = toServerRow(table, row);
    }
  }
  return out;
}

async function expectConverged(...all: Device[]): Promise<void> {
  const account = server.live(USER);
  for (const device of all) {
    expect(await snapshotOf(device), `${device.name} matches the account`).toEqual(account);
    expect(await device.db.syncOutbox.count(), `${device.name} has nothing queued`).toBe(0);
  }
}

const weight = (id: string, kg: number) => ({ id, kg, measuredAt: '2026-10-16T00:05:00.000Z', logicalDay: '2026-10-16' });
const later = (ms: number) => {
  trueNow += ms;
};

describe('two devices converge', () => {
  it('an edit on A appears on B', async () => {
    const [a, b] = await pair();
    await expectConverged(a, b);
    await on(a, () => a.db.weights.put(weight('w1', 80)));
    await on(a, () => a.db.profile.update('me', { dailyMinimumKcal: 1500 }));
    await sync(a);
    await sync(b);
    expect(await b.db.weights.get('w1')).toEqual(weight('w1', 80));
    expect(await b.db.profile.get('me')).toMatchObject({ dailyMinimumKcal: 1500 });

    // And back: B's edit reaches A.
    await on(b, () => b.db.weights.update('w1', { kg: 79.5 }));
    await sync(b);
    await sync(a);
    expect(await a.db.weights.get('w1')).toMatchObject({ kg: 79.5 });
    await expectConverged(a, b);
  });

  it('delete, then undo, brings the row back everywhere', async () => {
    const [a, b] = await pair();
    const [setupWeight] = await a.db.weights.toArray();
    if (!setupWeight) throw new Error('setup wrote no weigh-in');
    const actions = createActions(a.db);

    const undo = await on(a, () => actions.deleteWeight(setupWeight.id));
    later(MINUTE);
    await sync(a);
    await sync(b);
    expect(await b.db.weights.get(setupWeight.id)).toBeUndefined();
    expect(server.live(USER).weights?.[setupWeight.id]).toBeUndefined();

    later(MINUTE);
    await on(a, undo);
    await sync(a);
    await sync(b);
    expect(await b.db.weights.get(setupWeight.id)).toEqual(setupWeight);
    await expectConverged(a, b);

    // A delete undone before it synced sends nothing at all.
    const head = server.head(USER);
    const undoAgain = await on(a, () => actions.deleteWeight(setupWeight.id));
    await on(a, undoAgain);
    await sync(a);
    expect(server.head(USER)).toBe(head);
    await expectConverged(a, b);
  });

  it.each([
    { name: 'while it stays slow', fixClockBeforeSync: false },
    { name: 'even when the clock is fixed before B syncs', fixClockBeforeSync: true },
  ])('A, then B, then A edits lose nothing with B 10 minutes slow, $name', async ({ fixClockBeforeSync }) => {
    const [a, b] = await pair(-10 * MINUTE);
    await on(a, () => a.db.weights.put(weight('w1', 70)));
    await sync(a);
    later(MINUTE);
    await sync(b);

    later(MINUTE);
    // On B's clock this edit is 9 minutes older than A's.
    await on(b, () => b.db.weights.put(weight('w1', 71)));
    if (fixClockBeforeSync) b.skewMs = 0;
    later(MINUTE);
    await sync(b);
    expect(server.live(USER).weights?.w1?.kg).toBe(71);

    later(MINUTE);
    await sync(a);
    await on(a, () => a.db.weights.put(weight('w1', 72)));
    later(MINUTE);
    await sync(a);
    await sync(b);
    expect(await b.db.weights.get('w1')).toMatchObject({ kg: 72 });
    await expectConverged(a, b);
  });

  it.each([
    { name: 'A syncs first', order: ['a', 'b', 'a'] },
    { name: 'B syncs first', order: ['b', 'a', 'b'] },
  ])('concurrent offline edits: the later one wins on both devices ($name)', async ({ order }) => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('shared', 80)));
    await sync(a);
    await sync(b);

    later(MINUTE);
    await on(a, () => a.db.weights.put(weight('shared', 81)));
    later(MINUTE);
    await on(b, () => b.db.weights.put(weight('shared', 82)));
    for (const name of order) await sync(name === 'a' ? a : b);

    expect(await a.db.weights.get('shared')).toMatchObject({ kg: 82 });
    expect(await b.db.weights.get('shared')).toMatchObject({ kg: 82 });
    await expectConverged(a, b);
  });

  it.each([
    { name: 'wins when it is the later one', aFirst: false, kg: 83 },
    { name: 'loses when it is the older one', aFirst: true, kg: 82 },
  ])('an edit queued on A while its pull brings B’s edit is kept for the push, and $name', async ({ aFirst, kg }) => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('shared', 80)));
    await sync(a);
    await sync(b);

    later(MINUTE);
    const editOnA = () => on(a, () => a.db.weights.put(weight('shared', 83)));
    if (aFirst) await editOnA(); // made offline, before B's edit
    later(MINUTE);
    await on(b, () => b.db.weights.put(weight('shared', 82)));
    await sync(b);
    later(MINUTE);
    if (aFirst) {
      await pullOnce(a); // the pull meets the queued edit (as after a push round that hit its limit)
    } else {
      await sync(a, { beforePull: editOnA });
    }
    expect(await a.db.weights.get('shared')).toMatchObject({ kg: 83 });
    expect(await a.db.syncOutbox.get(['weights', 'shared'])).toBeDefined();

    later(MINUTE);
    await sync(a);
    await sync(b);
    expect(await a.db.weights.get('shared')).toMatchObject({ kg });
    expect(await b.db.weights.get('shared')).toMatchObject({ kg });
    await expectConverged(a, b);
  });

  it.each([
    { name: 'a synced row deleted and the delete undone', synced: true },
    { name: 'a day made on both devices, then deleted on A', synced: false },
  ])('a change on A that comes to nothing after its pull met B’s newer version brings that version in ($name)', async ({ synced }) => {
    const [a, b] = await pair();
    const day: DayRecord = { logicalDay: '2026-10-16', status: 'complete' };
    let undoOnA: () => Promise<unknown>;
    if (synced) {
      await on(a, () => a.db.weights.put(weight('shared', 80)));
      await sync(a);
      await sync(b);
      later(MINUTE);
      const undo = await on(a, () => createActions(a.db).deleteWeight('shared'));
      undoOnA = () => on(a, undo);
      later(MINUTE);
      await on(b, () => b.db.weights.put(weight('shared', 82)));
    } else {
      await on(a, () => a.db.days.put(day));
      undoOnA = () => on(a, () => a.db.days.delete(day.logicalDay));
      later(MINUTE);
      await on(b, () => b.db.days.put({ ...day, status: 'guess' }));
    }
    await sync(b);
    later(MINUTE);
    await pullOnce(a); // meets A's pending change, and leaves B's version to the push
    later(MINUTE);
    await undoOnA(); // the latest edit anywhere, but it changes nothing that syncs
    await sync(a);
    await sync(b);

    if (synced) expect(await a.db.weights.get('shared')).toMatchObject({ kg: 82 });
    else expect(await a.db.days.get(day.logicalDay)).toEqual({ ...day, status: 'guess' });
    await expectConverged(a, b);
  });

  it('a row holding half an emoji still syncs, with U+FFFD in its place', async () => {
    const [a, b] = await pair();
    const half = String.fromCharCode(0xd83c);
    await on(a, () => a.db.places.put({ id: 'p1', name: `Kedai ${half}`, type: 'mamak', defaultVariants: {}, createdAt: '2026-10-16T11:00:00.000Z' }));
    await sync(a);
    await sync(b);
    expect((await b.db.places.get('p1'))?.name).toBe(`Kedai ${String.fromCharCode(0xfffd)}`);
    await expectConverged(a, b);
  });

  it('an edit made while its row is being pushed goes in the next push', async () => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('w1', 80)));
    const head = server.head(USER);
    await sync(a, { whilePushing: () => a.db.weights.put(weight('w1', 81)) });
    expect(server.head(USER)).toBe(head + 2); // 80, then 81 in the cycle's next round
    expect(server.live(USER).weights?.w1?.kg).toBe(81);
    await sync(b);
    expect(await b.db.weights.get('w1')).toMatchObject({ kg: 81 });
    await expectConverged(a, b);
  });

  it("another tab's pull between a push and its answer keeps the newer edit", async () => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('shared', 80)));
    await sync(a);
    await sync(b);

    later(MINUTE);
    await on(a, () => a.db.weights.put(weight('shared', 81)));
    later(MINUTE);
    await on(b, () => b.db.weights.put(weight('shared', 82)));
    await sync(a, {
      whilePushing: async () => {
        // A's 81 is in; B's later 82 beats it; then A's other tab pulls both before A records its answer.
        await sync(b);
        await pullOnce(a);
      },
    });
    expect(await a.db.weights.get('shared')).toMatchObject({ kg: 82 });
    await expectConverged(a, b);
  });

  it('an offline edit days old loses to a newer one it never saw', async () => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('shared', 80)));
    await sync(a);
    await sync(b);

    await on(b, () => b.db.weights.put(weight('shared', 60)));
    later(3 * 24 * 60 * MINUTE);
    await on(a, () => a.db.weights.put(weight('shared', 65)));
    await sync(a);
    later(60 * MINUTE);
    const head = server.head(USER);
    await sync(b);
    expect(server.head(USER)).toBe(head);
    expect(await b.db.weights.get('shared')).toMatchObject({ kg: 65 });
    await expectConverged(a, b);
  });

  it('a lost push answer, then a retry, adds no revision', async () => {
    const [a, b] = await pair();
    await on(a, () => a.db.weights.put(weight('w1', 80)));
    a.loseNextReply = true;
    const head = server.head(USER);
    await expect(sync(a)).rejects.toMatchObject({ kind: 'unreachable' });
    expect(server.head(USER)).toBe(head + 1);
    expect(await a.db.syncOutbox.count()).toBe(1);

    await sync(a);
    expect(server.head(USER)).toBe(head + 1);
    await sync(b);
    expect(await b.db.weights.get('w1')).toEqual(weight('w1', 80));
    await expectConverged(a, b);
  });

  it.each([
    { name: 'B syncs first', order: ['b', 'a', 'b'] },
    { name: 'A syncs first', order: ['a', 'b', 'a'] },
  ])("a theme toggle on A doesn't beat B's concurrent rollover edit ($name)", async ({ order }) => {
    const [a, b] = await pair();
    await on(b, () => b.db.profile.update('me', { rolloverHour: 4 }));
    later(MINUTE);
    await on(a, () => a.db.profile.update('me', { theme: 'dark' }));
    const head = server.head(USER);
    for (const name of order) await sync(name === 'a' ? a : b);

    expect(server.head(USER)).toBe(head + 1); // only B's edit was sent
    expect(await a.db.profile.get('me')).toMatchObject({ rolloverHour: 4, theme: 'dark' });
    expect(await b.db.profile.get('me')).toMatchObject({ rolloverHour: 4, theme: 'system' });
    await expectConverged(a, b);
  });
});

/** mulberry32: a small seeded generator, so a failing run can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random steps', () => {
  it.each([1, 2, 3])('200 steps from seed %i leave A, B and the account the same', async (seed) => {
    const next = random(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const [a, b] = await pair(-10 * MINUTE);
    const weightKeys = ['w0', 'w1', 'w2', 'w3', 'w4'];
    const dayKeys = ['2026-10-14', '2026-10-15', '2026-10-16'];
    const mealKeys = ['m0', 'm1', 'm2'];
    const meal = (id: string, name: string): MealLog => ({
      id,
      eatenAt: '2026-10-16T04:30:00.000Z',
      logicalDay: '2026-10-16',
      slot: 'lunch',
      name,
      items: [],
      method: 'manual',
      finished: 'all',
      createdAt: '2026-10-16T04:31:00.000Z',
      updatedAt: '2026-10-16T04:31:00.000Z',
      syncState: 'local',
    });
    const steps: string[] = [];

    for (let step = 0; step < 200; step += 1) {
      const device = pick([a, b]);
      const roll = next();
      const label = `${step} ${device.name}`;
      if (roll < 0.14) {
        const key = pick(weightKeys);
        const kg = Math.round(next() * 300) / 10 + 60;
        steps.push(`${label} put weight ${key} ${kg}`);
        await on(device, () => device.db.weights.put(weight(key, kg)));
      } else if (roll < 0.22) {
        const key = pick(weightKeys);
        steps.push(`${label} delete weight ${key}`);
        await on(device, () => device.db.weights.delete(key));
      } else if (roll < 0.3) {
        const day: DayRecord = { logicalDay: pick(dayKeys), status: pick(['complete', 'guess', 'notCounted'] as const) };
        steps.push(`${label} put day ${day.logicalDay} ${day.status}`);
        await on(device, () => device.db.days.put(day));
      } else if (roll < 0.34) {
        const key = pick(dayKeys);
        steps.push(`${label} delete day ${key}`);
        await on(device, () => device.db.days.delete(key));
      } else if (roll < 0.42) {
        const key = pick(mealKeys);
        const name = pick(['Economy rice', 'Roti canai', 'Nasi lemak', 'Mee goreng']);
        steps.push(`${label} put meal ${key} ${name}`);
        await on(device, () => device.db.meals.put(meal(key, name)));
      } else if (roll < 0.46) {
        const key = pick(mealKeys);
        steps.push(`${label} delete meal ${key}`);
        await on(device, () => device.db.meals.delete(key));
      } else if (roll < 0.52) {
        const rolloverHour = Math.floor(next() * 24);
        steps.push(`${label} rollover ${rolloverHour}`);
        await on(device, () => device.db.profile.update('me', { rolloverHour }));
      } else if (roll < 0.56) {
        const theme = pick(['light', 'dark', 'system'] as const);
        steps.push(`${label} theme ${theme}`);
        await on(device, () => device.db.profile.update('me', { theme }));
      } else if (roll < 0.62) {
        const ms = Math.floor(next() * 10 * MINUTE);
        steps.push(`${label} wait ${ms} ms`);
        later(ms);
      } else if (roll < 0.66) {
        const kg = Math.round(next() * 300) / 10 + 60;
        const fallback = pick(weightKeys);
        if (next() < 0.5) {
          // Edits a weight that is in the push, when there is one.
          await sync(device, {
            whilePushing: (sent) => {
              const key = sent.find((c) => c.t === 'weights')?.k ?? fallback;
              steps.push(`${label} sync, put weight ${key} ${kg} while pushing`);
              return device.db.weights.put(weight(key, kg));
            },
          });
        } else {
          steps.push(`${label} sync, put weight ${fallback} ${kg} before the pull`);
          await sync(device, { beforePull: () => device.db.weights.put(weight(fallback, kg)) });
        }
      } else if (roll < 0.69) {
        // The other device syncs and another tab here pulls, all while this push is out.
        const other = device === a ? b : a;
        steps.push(`${label} sync, ${other.name} syncs and another tab pulls while pushing`);
        await sync(device, {
          whilePushing: async () => {
            await sync(other);
            await pullOnce(device);
          },
        });
      } else if (roll < 0.72) {
        steps.push(`${label} sync, answer lost`);
        device.loseNextReply = true;
        await sync(device).catch((error: unknown) => {
          if (!(error instanceof SyncError && error.kind === 'unreachable')) throw error;
        });
        device.loseNextReply = false;
      } else {
        steps.push(`${label} sync`);
        await sync(device);
      }
      later(1_000);

      // Every 25 steps both devices catch up and must match the account.
      if (step % 25 === 24) {
        for (const each of [a, b, a]) await sync(each);
        try {
          await expectConverged(a, b);
        } catch (error) {
          throw new Error(`Seed ${seed} diverged after:\n${steps.join('\n')}`, { cause: error });
        }
      }
    }

    // The steps really did conflict: some pushes lost, and the account holds far more than the setup.
    expect(answers.lost).toBeGreaterThan(0);
    expect(answers.invalid).toBe(0);
    expect(server.head(USER)).toBeGreaterThan(40);
  }, 60_000);
});
