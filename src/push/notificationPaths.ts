/**
 * Where a notification tap may open (decision §10.19 D14). The worker and the app both pass a
 * notification's url through safeNotificationPath, so a push can only ever open one of these.
 */
import { PATHS } from '@/app/paths';

export const NOTIFICATION_PATHS: readonly string[] = [PATHS.today, `${PATHS.today}?sheet=checkin`, PATHS.weekly, PATHS.target, PATHS.reminders];

/** The path when it is exactly one of NOTIFICATION_PATHS, else Today. */
export function safeNotificationPath(raw: unknown): string {
  return typeof raw === 'string' && NOTIFICATION_PATHS.includes(raw) ? raw : PATHS.today;
}
