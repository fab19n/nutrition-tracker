// Prints a VAPID key pair and a cron secret for reminders (DEPLOY.md part 10). Writes no file.
// Run: npm run push:keys [-- --subject https://<your-app>.vercel.app] [-- --json]
// Node built-ins only. Run it once: new keys mean every device turns reminders on again by itself.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const subjectAt = args.indexOf('--subject');
const subject = subjectAt >= 0 && args[subjectAt + 1] ? args[subjectAt + 1] : 'https://<your-app>.vercel.app';

/** Base64url without padding. */
function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
// The uncompressed point the browser takes: 0x04 ‖ x ‖ y (65 bytes).
const vapidPublic = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]));
const vapidPrivate = b64url(Buffer.from(priv.d, 'base64url'));
const cronSecret = randomBytes(32).toString('hex');

if (json) {
  console.log(JSON.stringify({ publicKey: vapidPublic, privateKey: vapidPrivate, subject, cronSecret }));
  process.exit(0);
}

// `npx supabase link` remembers the project here; without it the address keeps a placeholder.
let projectRef = '<project-ref>';
try {
  const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
  if (/^[a-z0-9]{10,40}$/.test(linked)) projectRef = linked;
} catch {
  // Not linked on this PC.
}

console.log(`Kira Makan reminder keys (DEPLOY.md part 10). Keep them in your password manager.
The private key and the cron secret are secrets: never in Git, Vercel or a VITE_ variable.

1. Vercel and .env.local (public):
VITE_VAPID_PUBLIC_KEY=${vapidPublic}

2. supabase/.env.secrets (then: npx supabase secrets set --env-file supabase/.env.secrets):
VAPID_PUBLIC_KEY=${vapidPublic}
VAPID_PRIVATE_KEY=${vapidPrivate}
VAPID_SUBJECT=${subject}
CRON_SECRET=${cronSecret}

3. SQL Editor, after supabase/push.sql (one query):
select public.push_configure('https://${projectRef}.supabase.co/functions/v1/send-reminders', '${cronSecret}');`);
