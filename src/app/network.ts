import { useSyncExternalStore } from 'react';

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * True while the browser reports a connection: navigator.onLine, read again on every online and
 * offline event. useSyncExternalStore reads it when it subscribes too, so a change between the
 * first render and the subscription is never missed. Browsers change navigator.onLine before
 * firing the event; tests do the same with setOnline (src/test/network.ts).
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true);
}
