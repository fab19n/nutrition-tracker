/**
 * One run of the reminder job, and the test notification. Runtime-agnostic: ./index.ts injects the
 * Supabase store (./store.ts) and the Web Push sender (./webpush.ts); server/sendReminders.test.ts
 * injects fakes. The rules themselves are ../_shared/reminders.ts, the same module the app uses.
 *
 * Never twice (decision §10.19 D12): a reminder is claimed in push_log before it is sent, and the
 * claim is released only when no device took it and a failure was worth retrying.
 */
import {
  decideReminder,
  notificationPayload,
  reminderMessage,
  type ReminderDayRow,
  type ReminderGoalRow,
  type ReminderInput,
  type ReminderKind,
  type ReminderMealRow,
  type ReminderPeriodRow,
  type ReminderTargetMark,
  type ReminderTargetSeen,
  type SentRow,
  type SkipReason,
} from '../_shared/reminders.ts';
import type { DeliveryReport, PushSender, PushTarget, VapidConfig } from './webpush.ts';

export interface ReminderStore {
  /** Users with at least one subscription. */
  dueUsers(): Promise<string[]>;
  /** push_context: the compact JSON decideReminder reads, from `fromDay` on. */
  context(userId: string, fromDay: string): Promise<unknown>;
  /** True when this run may send it (push_log had no row). */
  claim(userId: string, kind: ReminderKind, date: string): Promise<boolean>;
  release(userId: string, kind: ReminderKind, date: string): Promise<void>;
  /** Per device: ok, gone (the row goes), failed or skipped. With a kind and date, the log counts the deliveries. */
  report(userId: string, kind: ReminderKind | null, date: string | null, results: DeliveryReport[]): Promise<void>;
}

export interface TickDeps {
  store: ReminderStore;
  sender: PushSender;
  vapid: VapidConfig;
  /** Counts and codes only: never an endpoint, an email or a user id. */
  log?: (line: string) => void;
}

export type TickSkip = SkipReason | 'noDevice' | 'claimed' | 'error';

export interface TickSummary {
  users: number;
  sent: number;
  skipped: Partial<Record<TickSkip, number>>;
}

/** push_test_target couldn't answer: not signed in, the SQL isn't in, or something else. */
export class TestTargetError extends Error {
  readonly code: 'notSignedIn' | 'notSetUp' | 'upstream';

  constructor(code: 'notSignedIn' | 'notSetUp' | 'upstream', message?: string) {
    super(message ?? code);
    this.name = 'TestTargetError';
    this.code = code;
  }
}

/** The server reads this much history: the 28-day windows plus a week. */
const HISTORY_DAYS = 36;
const MS_PER_DAY = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function list<T>(value: unknown, parse: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const items: unknown[] = value;
  const out: T[] = [];
  for (const item of items) {
    const parsed = isRecord(item) ? parse(item) : null;
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseProfile(value: unknown): ReminderInput['profile'] {
  if (!isRecord(value)) return undefined;
  const profile: NonNullable<ReminderInput['profile']> = {};
  const timeZone = str(value.timeZone);
  const startedOn = str(value.startedOn);
  if (timeZone) profile.timeZone = timeZone;
  if (typeof value.rolloverHour === 'number') profile.rolloverHour = value.rolloverHour;
  if (startedOn) profile.startedOn = startedOn;
  if (value.reminders !== undefined && value.reminders !== null) profile.reminders = value.reminders;
  if (typeof value.demoMode === 'boolean') profile.demoMode = value.demoMode;
  return profile;
}

function parseMark(value: unknown): ReminderTargetMark | undefined {
  if (!isRecord(value)) return undefined;
  const mark: ReminderTargetMark = {};
  const key = str(value.key);
  const weekStart = str(value.weekStart);
  const markedAt = str(value.markedAt);
  const seenAt = str(value.seenAt);
  if (key) mark.key = key;
  if (weekStart) mark.weekStart = weekStart;
  if (typeof value.weeks === 'number') mark.weeks = value.weeks;
  if (markedAt) mark.markedAt = markedAt;
  if (seenAt) mark.seenAt = seenAt;
  return mark;
}

function parseSeen(value: unknown): ReminderTargetSeen | undefined {
  if (!isRecord(value)) return undefined;
  const key = str(value.key);
  if (!key) return undefined;
  const seen: ReminderTargetSeen = { key };
  const seenAt = str(value.seenAt);
  if (seenAt) seen.seenAt = seenAt;
  return seen;
}

/** push_context's JSON as decideReminder's input and the user's devices. Elements of the wrong shape are dropped; a non-object is null. */
export function parseReminderContext(json: unknown): { input: ReminderInput; targets: PushTarget[] } | null {
  if (!isRecord(json)) return null;
  const days = list<ReminderDayRow>(json.days, (d) => {
    const day = str(d.d);
    if (!day) return null;
    const row: ReminderDayRow = { day };
    const status = str(d.s);
    const sleepAt = str(d.sl);
    if (status) row.status = status;
    if (sleepAt) row.sleepAt = sleepAt;
    return row;
  });
  const meals = list<ReminderMealRow>(json.meals, (m) => {
    const day = str(m.d);
    const at = str(m.at);
    if (!day || !at) return null;
    const row: ReminderMealRow = { day, at, guess: m.g === true };
    const slot = str(m.sl);
    if (slot) row.slot = slot;
    return row;
  });
  const periods = list<ReminderPeriodRow>(json.periods, (p) => {
    const id = str(p.id);
    const goalId = str(p.g);
    const from = str(p.f);
    if (!id || !goalId || !from) return null;
    const row: ReminderPeriodRow = { id, goalId, from };
    const to = str(p.t);
    const createdAt = str(p.c);
    if (to) row.to = to;
    if (createdAt) row.createdAt = createdAt;
    return row;
  });
  const goals = list<ReminderGoalRow>(json.goals, (g) => {
    const id = str(g.id);
    if (!id) return null;
    const template = str(g.tp);
    return template ? { id, template } : { id };
  });
  const sent = list<SentRow>(json.sent, (s) => {
    const kind = str(s.kind);
    const date = str(s.date);
    const at = str(s.at);
    return kind && date && at ? { kind, date, at } : null;
  });
  const targets = list<PushTarget>(json.subscriptions, (s) => {
    const endpoint = str(s.endpoint);
    const p256dh = str(s.p256dh);
    const auth = str(s.auth);
    const vapidKey = str(s.vapidKey);
    return endpoint && p256dh && auth && vapidKey ? { endpoint, p256dh, auth, vapidKey } : null;
  });
  const completeDays = typeof json.completeDays === 'number' && Number.isInteger(json.completeDays) && json.completeDays >= 0 ? json.completeDays : 0;

  const input: ReminderInput = { days, meals, completeDays, periods, goals, sent };
  const profile = parseProfile(json.profile);
  if (profile) input.profile = profile;
  const mark = parseMark(json.targetNotice);
  if (mark) input.targetNotice = mark;
  const seen = parseSeen(json.targetNoticeSeen);
  if (seen) input.targetNoticeSeen = seen;
  return { input, targets };
}

function codeOf(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'error';
}

/** Every user with a device, one at a time: at most one reminder each. One user's failure never stops the next. */
export async function runTick(deps: TickDeps, nowMs: number): Promise<TickSummary> {
  const users = await deps.store.dueUsers();
  const summary: TickSummary = { users: users.length, sent: 0, skipped: {} };
  const skip = (reason: TickSkip) => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };
  // The server's own date only sets how far back to read; every rule uses the profile's zone.
  const fromDay = new Date(nowMs - HISTORY_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

  for (const userId of users) {
    try {
      const parsed = parseReminderContext(await deps.store.context(userId, fromDay));
      if (!parsed) {
        skip('badContext');
        continue;
      }
      const decision = decideReminder(parsed.input, nowMs);
      if (!decision.due) {
        skip(decision.reason);
        continue;
      }
      const due = decision.due;
      const current = parsed.targets.filter((t) => t.vapidKey === deps.vapid.publicKey);
      // Subscribed with keys from before `npm run push:keys` was run again: each device re-subscribes when it opens.
      const oldKey: DeliveryReport[] = parsed.targets
        .filter((t) => t.vapidKey !== deps.vapid.publicKey)
        .map((t) => ({ endpoint: t.endpoint, outcome: 'skipped', error: 'oldKey' }));
      if (current.length === 0) {
        if (oldKey.length > 0) await deps.store.report(userId, null, null, oldKey);
        skip('noDevice');
        continue;
      }
      if (!(await deps.store.claim(userId, due.kind, due.localDate))) {
        skip('claimed');
        continue;
      }
      const payload = notificationPayload(due.kind, due);
      const results = await Promise.all(current.map((t) => deps.sender.send(t, payload, { ttl: due.ttlSeconds, topic: due.topic, urgency: 'high' })));
      await deps.store.report(userId, due.kind, due.localDate, [...results, ...oldKey]);
      if (!results.some((r) => r.outcome === 'ok') && results.some((r) => r.transient === true)) {
        // Nobody got it and it may work later: the next run tries again.
        await deps.store.release(userId, due.kind, due.localDate);
      } else {
        summary.sent += 1;
      }
    } catch (error) {
      skip('error');
      deps.log?.(`a user failed: ${codeOf(error)}`);
    }
  }
  return summary;
}

/** A test notification to one device (S38): not logged, and it ignores quiet hours and spacing. */
export function deliverTest(deps: { sender: PushSender; vapid: VapidConfig }, target: PushTarget): Promise<DeliveryReport> {
  return deps.sender.send(target, notificationPayload('test', reminderMessage('test')), { ttl: 300, topic: 'km-test', urgency: 'high' });
}
