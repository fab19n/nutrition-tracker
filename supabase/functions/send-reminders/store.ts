/**
 * The reminder job's database side: thin wrappers over the push_* functions in supabase/push.sql,
 * with supabase-js. Runtime-agnostic: server/remindersStore.test.ts runs them over a fake fetch.
 *
 * - createSupabaseReminderStore: the service role's client (the job's RPCs). Any RPC error throws.
 * - createTestTargetReader: push_test_target as the signed-in caller, so PostgREST checks the token
 *   and the row is the caller's own.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ReminderKind } from '../_shared/reminders.ts';
import { TestTargetError, type ReminderStore } from './core.ts';
import type { PushTarget } from './webpush.ts';

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** The service role's client: it never stores or refreshes a session. */
export function createServiceClient(url: string, secretKey: string, fetchImpl?: typeof fetch): SupabaseClient {
  return createClient(url, secretKey, { auth: NO_SESSION, ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}) });
}

function failed(fn: string, error: { code?: string; message?: string }): Error {
  // The code only: messages can quote values.
  return new Error(`${fn} failed (${error.code ?? 'error'})`);
}

export function createSupabaseReminderStore(client: SupabaseClient): ReminderStore {
  return {
    async dueUsers() {
      const { data, error } = await client.rpc('push_due_users');
      if (error) throw failed('push_due_users', error);
      const reply: unknown = data;
      return Array.isArray(reply) ? reply.filter((id): id is string => typeof id === 'string') : [];
    },
    async context(userId, fromDay) {
      const { data, error } = await client.rpc('push_context', { p_user: userId, p_from: fromDay });
      if (error) throw failed('push_context', error);
      const reply: unknown = data;
      return reply;
    },
    async claim(userId, kind: ReminderKind, date) {
      const { data, error } = await client.rpc('push_claim', { p_user: userId, p_kind: kind, p_date: date });
      if (error) throw failed('push_claim', error);
      return data === true;
    },
    async release(userId, kind, date) {
      const { error } = await client.rpc('push_release', { p_user: userId, p_kind: kind, p_date: date });
      if (error) throw failed('push_release', error);
    },
    async report(userId, kind, date, results) {
      const p_results = results.map((r) => ({ endpoint: r.endpoint, outcome: r.outcome, error: r.error ?? null }));
      const { error } = await client.rpc('push_report', { p_user: userId, p_kind: kind, p_date: date, p_results });
      if (error) throw failed('push_report', error);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the caller's own device for a test: null when this account has no such endpoint. */
export function createTestTargetReader(
  url: string,
  publishableKey: string,
  fetchImpl?: typeof fetch,
): (token: string, endpoint: string) => Promise<(PushTarget & { userId: string }) | null> {
  return async (token, endpoint) => {
    const client = createClient(url, publishableKey, {
      auth: NO_SESSION,
      global: { headers: { Authorization: `Bearer ${token}` }, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
    });
    const { data, error, status } = await client.rpc('push_test_target', { p_endpoint: endpoint });
    if (error) {
      if (status === 401 || error.code === 'PT401') throw new TestTargetError('notSignedIn');
      if (status === 404 || error.code === 'PGRST202') throw new TestTargetError('notSetUp');
      throw new TestTargetError('upstream', `push_test_target failed (${error.code || status})`);
    }
    const reply: unknown = data;
    if (reply === null) return null;
    if (!isRecord(reply)) throw new TestTargetError('upstream', 'push_test_target answered something else');
    const { userId, p256dh, auth, vapidKey } = reply;
    const found = reply.endpoint;
    if (typeof userId !== 'string' || typeof found !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string' || typeof vapidKey !== 'string') {
      throw new TestTargetError('upstream', 'push_test_target answered something else');
    }
    return { userId, endpoint: found, p256dh, auth, vapidKey };
  };
}
