/**
 * A DriveTokenSource for tests: no script, no Google window. Each request takes the next queued
 * answer (a token, or a problem it rejects with), or waits for `settle`. The log says whether each
 * request came synchronously from the test's tap (`tap(fn)`), as Chrome needs for the window to
 * open. Test-only; never imported by the app.
 */
import { DriveAuthError, type DriveAuthProblem, type DriveToken, type DriveTokenRequest, type DriveTokenSource } from '../gis';

type Answer = DriveToken | DriveAuthProblem;

export interface FakeTokenRequest extends DriveTokenRequest {
  /** request() ran synchronously inside tap(). */
  inTap: boolean;
}

export function createFakeTokens(options: { ready?: boolean; loads?: 'ok' | 'fail' } = {}) {
  const answers: Answer[] = [];
  const requests: FakeTokenRequest[] = [];
  let pending: { promise: Promise<DriveToken>; resolve: (t: DriveToken) => void; reject: (e: DriveAuthError) => void } | null = null;
  let inTap = false;

  const fake = {
    isReady: options.ready ?? true,
    loads: options.loads ?? 'ok',
    loadCalls: 0,
    requests,

    /** Queues the answer to the next request. */
    next(answer: Answer): void {
      answers.push(answer);
    },

    /** Answers the request that is waiting. */
    settle(answer: Answer): void {
      const current = pending;
      if (!current) throw new Error('No token request is waiting');
      pending = null;
      if (typeof answer === 'string') current.reject(new DriveAuthError(answer));
      else current.resolve(answer);
    },

    waiting(): boolean {
      return pending !== null;
    },

    /** Runs `fn` as a tap: requests made synchronously inside it are marked inTap. */
    tap<T>(fn: () => T): T {
      inTap = true;
      try {
        return fn();
      } finally {
        inTap = false;
      }
    },

    ready: (): boolean => fake.isReady,

    load: async (): Promise<void> => {
      fake.loadCalls += 1;
      if (fake.loads === 'fail') throw new DriveAuthError('unavailable');
      fake.isReady = true;
    },

    request(req: DriveTokenRequest): Promise<DriveToken> {
      if (pending) return pending.promise;
      if (!fake.isReady) return Promise.reject(new DriveAuthError('notReady'));
      requests.push({ ...req, inTap });
      const answer = answers.shift();
      if (answer !== undefined) {
        return typeof answer === 'string' ? Promise.reject(new DriveAuthError(answer)) : Promise.resolve(answer);
      }
      let resolve: (t: DriveToken) => void = () => undefined;
      let reject: (e: DriveAuthError) => void = () => undefined;
      const promise = new Promise<DriveToken>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending = { promise, resolve, reject };
      return promise;
    },
  } satisfies DriveTokenSource & Record<string, unknown>;

  return fake;
}

export type FakeTokens = ReturnType<typeof createFakeTokens>;
