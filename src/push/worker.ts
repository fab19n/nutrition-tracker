/**
 * Messages from the service worker (src/sw/push.ts): a notification tap with the app already open
 * ('km-open', so the app navigates in place and a draft on screen survives), and a subscription the
 * browser rotated ('km-push-changed'). Every path goes through safeNotificationPath.
 */
import { safeNotificationPath } from './notificationPaths';

export interface WorkerHandlers {
  onOpen: (path: string) => void;
  onSubscriptionChange: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Listens until the returned function is called. A no-op without a service worker (the dev server, tests). */
export function listenToWorker(handlers: WorkerHandlers): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return () => {};
  const container = navigator.serviceWorker;
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (!isRecord(data)) return;
    if (data.type === 'km-open') handlers.onOpen(safeNotificationPath(data.url));
    else if (data.type === 'km-push-changed') handlers.onSubscriptionChange();
  };
  container.addEventListener('message', onMessage);
  return () => container.removeEventListener('message', onMessage);
}
