/**
 * Where Web Push may deliver: the browsers' own push services, nowhere else. A subscription for any
 * other address is refused when it's saved (supabase/push.sql push_valid_subscription) and never
 * sent to (send-reminders webpush.ts), so a signed-in account can't make the server POST to a URL of
 * its choosing. The app checks it too, before it saves (src/push/engine.ts).
 *
 * Import-free, so Deno and the browser share it. Keep the hosts in step with push.sql.
 */
const PUSH_HOSTS: readonly RegExp[] = [
  // Chrome on Android and desktop, Samsung Internet, Opera: Firebase Cloud Messaging.
  /^fcm\.googleapis\.com$/,
  // Chrome's other Google push endpoints.
  /^jmt[0-9]+\.google\.com$/,
  // Firefox (Mozilla Push Service).
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  // Edge (Windows Push Notification Services).
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  // Safari (Apple Push Notification service).
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

/** True for an https address on a browser push service: no other port, no user or password in it. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((pattern) => pattern.test(host));
}
