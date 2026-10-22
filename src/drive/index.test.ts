/*
 * The app's Drive engine: built lazily, and nothing of Google's loads until a device that uses
 * Drive asks for it (decision §10.18, D20).
 */
import { resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { GIS_SCRIPT_URL } from './config';
import * as gis from './gis';
import * as drive from '.';

const CLIENT_ID = '123-abc.apps.googleusercontent.com';

vi.mock('./gis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gis')>();
  return { ...actual, createGisTokenSource: vi.fn(actual.createGisTokenSource) };
});

function gisScripts(): HTMLScriptElement[] {
  return [...document.head.querySelectorAll('script')].filter((s) => s.getAttribute('src') === GIS_SCRIPT_URL);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  await resetAll();
});

afterEach(async () => {
  await drive.resetDriveForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.mocked(gis.createGisTokenSource).mockClear();
  for (const script of gisScripts()) script.remove();
  await resetAll();
});

describe('the app Drive engine', () => {
  it('without a client id builds no token source and loads nothing', async () => {
    drive.startDrive();
    drive.prepareDrive();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gis.createGisTokenSource).not.toHaveBeenCalled();
    expect(gisScripts()).toHaveLength(0);
    expect(drive.getDriveState()).toMatchObject({ configured: false, connected: false });
    expect(await drive.connectDrive()).toEqual({ ok: false, problem: 'notReady' });
  });

  it('with a client id but not connected, loads Google only when asked', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
    drive.startDrive();
    drive.startDrive();
    expect(gis.createGisTokenSource).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gis.createGisTokenSource).mock.calls[0]?.[0]).toBe(CLIENT_ID);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gisScripts()).toHaveLength(0);
    expect(await db.driveJobs.count()).toBe(0);

    drive.prepareDrive();
    expect(gisScripts()).toHaveLength(1);
    expect(gisScripts()[0]?.async).toBe(true);
  });

  it('passes the calls through to one engine', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
    const listener = vi.fn();
    const unsubscribe = drive.subscribeDrive(listener);
    expect(drive.getDriveState()).toMatchObject({ configured: true, gisReady: false });
    expect(await drive.continueDrive()).toEqual({ ok: false, problem: 'notReady' });
    expect(await drive.fetchMealPhoto('missing')).toEqual({ ok: false, problem: 'notInDrive' });
    drive.renewDriveTokenOnTap();
    drive.forgetDriveToken();
    await drive.stopDrive();
    drive.resumeDrive();
    await drive.retryDrive();
    await drive.disconnectDrive();
    unsubscribe();
    expect(gis.createGisTokenSource).toHaveBeenCalledTimes(1);
    expect(gisScripts()).toHaveLength(0);
  });
});
