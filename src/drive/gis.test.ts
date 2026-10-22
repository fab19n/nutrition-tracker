/*
 * The GIS token source against a stand-in `google.accounts.oauth2` on a test window, with injected
 * timers: nothing loads from Google and no window opens.
 */
import type { SyncTimers } from '@/sync/engine';
import { DRIVE_SCOPE, GIS_SCRIPT_URL } from './config';
import { createGisTokenSource, DriveAuthError, GIS_LOAD_TIMEOUT_MS, POPUP_TIMEOUT_MS, type DriveTokenSource } from './gis';

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const NOW = 1_000_000;

/** Timers the test fires by hand. */
class ManualTimers implements SyncTimers {
  readonly pending = new Map<number, { ms: number; callback: () => void }>();
  private seq = 0;

  setTimeout(callback: () => void, ms: number): number {
    this.seq += 1;
    this.pending.set(this.seq, { ms, callback });
    return this.seq;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Fires every timer of this length. */
  fire(ms: number): void {
    for (const [id, timer] of [...this.pending]) {
      if (timer.ms !== ms) continue;
      this.pending.delete(id);
      timer.callback();
    }
  }
}

interface Config {
  client_id: string;
  scope: string;
  prompt?: string;
  callback: (response: Record<string, unknown>) => void;
  error_callback?: (error: { type: string }) => void;
}

/** The token client GIS builds, recording what the app asks it. */
function fakeOAuth(options: { granted?: boolean } = {}) {
  const configs: Config[] = [];
  const requests: { prompt?: string; login_hint?: string }[] = [];
  const oauth2 = {
    initTokenClient: vi.fn((config: Config) => {
      configs.push(config);
      return {
        requestAccessToken: vi.fn((overrides?: { prompt?: string; login_hint?: string }) => {
          requests.push(overrides ?? {});
        }),
      };
    }),
    hasGrantedAllScopes: vi.fn((_response: unknown, scope: string) => scope === DRIVE_SCOPE && (options.granted ?? true)),
  };
  const answer = (response: Record<string, unknown>) => configs.at(-1)?.callback(response);
  const fail = (type: string) => configs.at(-1)?.error_callback?.({ type });
  return { oauth2, configs, requests, answer, fail };
}

let timers: ManualTimers;
let win: { google?: unknown };

function source(): DriveTokenSource {
  return createGisTokenSource(CLIENT_ID, { clock: () => NOW, timers, doc: document, win: win as unknown as Window });
}

function scripts(): HTMLScriptElement[] {
  return [...document.head.querySelectorAll('script')].filter((s) => s.src === GIS_SCRIPT_URL);
}

async function problemOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DriveAuthError) return error.problem;
    throw error;
  }
  throw new Error('It resolved');
}

/** A loaded source with its fake oauth2. */
async function ready(options: { granted?: boolean } = {}) {
  const google = fakeOAuth(options);
  win.google = { accounts: { oauth2: google.oauth2 } };
  const tokens = source();
  await tokens.load();
  return { tokens, google };
}

beforeEach(() => {
  timers = new ManualTimers();
  win = {};
});

afterEach(() => {
  for (const script of scripts()) script.remove();
});

describe('load', () => {
  it('appends one async script with the GIS address, shared by a second load', async () => {
    const tokens = source();
    const first = tokens.load();
    const second = tokens.load();
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.async).toBe(true);
    expect(scripts()[0]?.getAttribute('src')).toBe('https://accounts.google.com/gsi/client');
    expect(tokens.ready()).toBe(false);

    const google = fakeOAuth();
    win.google = { accounts: { oauth2: google.oauth2 } };
    scripts()[0]?.dispatchEvent(new Event('load'));
    await first;
    expect(tokens.ready()).toBe(true);
    expect(timers.pending.size).toBe(0);
  });

  it('builds the token client once, with the client id, the Drive scope and both callbacks', async () => {
    const { tokens, google } = await ready();
    await tokens.load();
    expect(google.oauth2.initTokenClient).toHaveBeenCalledTimes(1);
    expect(google.configs[0]).toMatchObject({ client_id: CLIENT_ID, scope: DRIVE_SCOPE, prompt: '' });
    expect(typeof google.configs[0]?.callback).toBe('function');
    expect(typeof google.configs[0]?.error_callback).toBe('function');
    expect(scripts()).toHaveLength(0);
  });

  it("is unavailable when the script fails, and the next load appends it again", async () => {
    const tokens = source();
    const first = tokens.load();
    scripts()[0]?.dispatchEvent(new Event('error'));
    expect(await problemOf(first)).toBe('unavailable');
    expect(scripts()).toHaveLength(0);

    void tokens.load().catch(() => undefined);
    expect(scripts()).toHaveLength(1);
  });

  it('is unavailable when the script loads without the token client', async () => {
    const tokens = source();
    const first = tokens.load();
    scripts()[0]?.dispatchEvent(new Event('load'));
    expect(await problemOf(first)).toBe('unavailable');
    expect(tokens.ready()).toBe(false);
  });

  it('gives up after 15 s', async () => {
    const tokens = source();
    const first = tokens.load();
    expect([...timers.pending.values()].map((t) => t.ms)).toEqual([GIS_LOAD_TIMEOUT_MS]);
    timers.fire(15_000);
    expect(await problemOf(first)).toBe('unavailable');
    expect(scripts()).toHaveLength(0);
  });
});

describe('request', () => {
  it('is not ready before load, and opens nothing', async () => {
    const google = fakeOAuth();
    const tokens = source();
    expect(await problemOf(tokens.request({ prompt: '' }))).toBe('notReady');
    expect(google.requests).toHaveLength(0);
  });

  it('asks Google before returning, with the prompt and the login hint', async () => {
    const { tokens, google } = await ready();
    const promise = tokens.request({ prompt: '', loginHint: 'you@example.com' });
    // Synchronous: the window opens inside the tap.
    expect(google.requests).toEqual([{ prompt: '', login_hint: 'you@example.com' }]);
    google.answer({ access_token: 'token-1', expires_in: 3599, scope: DRIVE_SCOPE });
    expect(await promise).toEqual({ accessToken: 'token-1', expiresAt: NOW + 3_599_000 });
    expect(timers.pending.size).toBe(0);
  });

  it('asks to pick the account on Connect, without a hint', async () => {
    const { tokens, google } = await ready();
    void tokens.request({ prompt: 'select_account' });
    expect(google.requests).toEqual([{ prompt: 'select_account' }]);
  });

  it('shares a pending request', async () => {
    const { tokens, google } = await ready();
    const first = tokens.request({ prompt: '' });
    const second = tokens.request({ prompt: 'select_account' });
    expect(second).toBe(first);
    expect(google.requests).toHaveLength(1);
    google.answer({ access_token: 'token-1', expires_in: '60', scope: DRIVE_SCOPE });
    expect((await first).expiresAt).toBe(NOW + 60_000);
  });

  it.each([
    [{ error: 'access_denied' }, 'denied'],
    [{ error: 'invalid_request' }, 'failed'],
  ])('maps the answer %o to %s', async (response, problem) => {
    const { tokens, google } = await ready();
    const promise = tokens.request({ prompt: '' });
    google.answer(response);
    expect(await problemOf(promise)).toBe(problem);
  });

  it('is scopeDenied when the Drive box was left unticked', async () => {
    const { tokens, google } = await ready({ granted: false });
    const promise = tokens.request({ prompt: '' });
    google.answer({ access_token: 'token-1', expires_in: 3599, scope: 'email' });
    expect(await problemOf(promise)).toBe('scopeDenied');
    expect(google.oauth2.hasGrantedAllScopes).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'token-1' }), DRIVE_SCOPE);
  });

  it.each([
    ['popup_failed_to_open', 'popupBlocked'],
    ['popup_closed', 'popupClosed'],
    ['unknown', 'failed'],
  ])('maps the window error %s to %s', async (type, problem) => {
    const { tokens, google } = await ready();
    const promise = tokens.request({ prompt: '' });
    google.fail(type);
    expect(await problemOf(promise)).toBe(problem);
  });

  it('fails after 3 minutes without an answer, and asks again next time', async () => {
    const { tokens, google } = await ready();
    const promise = tokens.request({ prompt: '' });
    timers.fire(POPUP_TIMEOUT_MS);
    expect(await problemOf(promise)).toBe('failed');
    void tokens.request({ prompt: '' });
    expect(google.requests).toHaveLength(2);
  });
});
