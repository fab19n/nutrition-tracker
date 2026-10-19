import { useEffect, useState } from 'react';

function initiallyOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * True while the browser reports a connection. Follows the window's online/offline events
 * (the events themselves decide, so a test can dispatch them without touching navigator.onLine).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(initiallyOnline);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Catch a change between the first render and subscribing.
    setOnline(initiallyOnline());
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
