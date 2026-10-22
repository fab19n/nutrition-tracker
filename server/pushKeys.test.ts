// @vitest-environment node
// `npm run push:keys` (scripts/generate-push-keys.mjs): keys the function and the browser accept.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { base64UrlDecode, readVapidConfig, vapidAuthorization } from '../supabase/functions/send-reminders/webpush';

const SCRIPT = fileURLToPath(new URL('../scripts/generate-push-keys.mjs', import.meta.url));

function run(...args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

interface Keys {
  publicKey: string;
  privateKey: string;
  subject: string;
  cronSecret: string;
}

describe('npm run push:keys', () => {
  it('prints a P-256 pair and a cron secret the function accepts', async () => {
    const keys = JSON.parse(run('--json', '--subject', 'https://kira-makan.vercel.app')) as Keys;
    const pub = base64UrlDecode(keys.publicKey);
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(4);
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(base64UrlDecode(keys.privateKey)).toHaveLength(32);
    expect(keys.cronSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.subject).toBe('https://kira-makan.vercel.app');

    const env: Record<string, string> = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: keys.subject };
    const vapid = readVapidConfig((name) => env[name]);
    expect(vapid).not.toBeNull();
    if (!vapid) return;

    // A VAPID JWT signed with them verifies against the public key.
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', vapid, 1_800_000_000);
    const [, jwt = ''] = /^vapid t=([^,]+), k=/.exec(header) ?? [];
    const [h = '', c = '', s = ''] = jwt.split('.');
    const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64UrlDecode(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('makes new keys every run', () => {
    const a = JSON.parse(run('--json')) as Keys;
    const b = JSON.parse(run('--json')) as Keys;
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.cronSecret).not.toBe(b.cronSecret);
  });

  it('says where each value goes', () => {
    const out = run();
    expect(out).toContain('Kira Makan reminder keys (DEPLOY.md part 10).');
    expect(out).toMatch(/^VITE_VAPID_PUBLIC_KEY=B/m);
    expect(out).toMatch(/^VAPID_PRIVATE_KEY=/m);
    expect(out).toMatch(/^CRON_SECRET=[0-9a-f]{64}$/m);
    expect(out).toContain('select public.push_configure(');
    expect(out).toContain('/functions/v1/send-reminders');
  });
});
