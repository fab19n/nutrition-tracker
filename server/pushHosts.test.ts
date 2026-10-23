// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../supabase/functions/_shared/pushHosts';

describe('isAllowedPushEndpoint', () => {
  it.each([
    ['Chrome / Android (FCM)', 'https://fcm.googleapis.com/fcm/send/dAbC123:APA91bE'],
    ['Chrome (FCM web push)', 'https://fcm.googleapis.com/wp/dAbC123:APA91bE'],
    ['Chrome (jmt)', 'https://jmt17.google.com/fcm/send/abc'],
    ['Firefox', 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB'],
    ['Edge', 'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB'],
    ['Safari', 'https://web.push.apple.com/QHx8vQ'],
    ['an explicit 443', 'https://fcm.googleapis.com:443/fcm/send/abc'],
    ['an upper-case host', 'https://FCM.googleapis.com/fcm/send/abc'],
  ])('allows %s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['any other site', 'https://evil.example/collect'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['another port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['a user and password', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['a look-alike prefix', 'https://fcm.googleapis.com.evil.example/fcm/send/abc'],
    ['a look-alike suffix', 'https://evilfcm.googleapis.com/fcm/send/abc'],
    ['another Google host', 'https://www.googleapis.com/upload/drive/v3/files'],
    ['a look-alike Mozilla host', 'https://push.services.mozilla.com.evil.example/x'],
    ['the bare Windows domain', 'https://notify.windows.com/x'],
    ['a trailing-dot host', 'https://fcm.googleapis.com./fcm/send/abc'],
    ['a local address', 'https://127.0.0.1/x'],
    ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
    ['empty', ''],
  ])('refuses %s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});
