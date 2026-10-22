import { PATHS } from '@/app/paths';
import { NOTIFICATION_PATHS, safeNotificationPath } from './notificationPaths';

describe('safeNotificationPath', () => {
  it.each(['/', '/?sheet=checkin', '/insights/weekly', '/insights/target', '/more/reminders'])('opens %s', (path) => {
    expect(safeNotificationPath(path)).toBe(path);
  });

  it('lists the screens a reminder opens, and nothing else', () => {
    expect(NOTIFICATION_PATHS).toEqual([PATHS.today, '/?sheet=checkin', PATHS.weekly, PATHS.target, PATHS.reminders]);
  });

  it.each([
    '//evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/more/settings',
    '/?sheet=log',
    '/insights/weekly/../../more',
    '',
    undefined,
    null,
    42,
    { url: '/' },
  ])('sends %o to Today', (raw) => {
    expect(safeNotificationPath(raw)).toBe(PATHS.today);
  });
});
