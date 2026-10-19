import { useCallback, useRef, useState } from 'react';

/**
 * Ignores repeat taps while a save runs: `run(key, fn)` does nothing while the same key is still
 * running (a double tap on Duplicate logs one copy). `busy(key)` tells a button to wait.
 */
export function useInFlight() {
  const running = useRef(new Set<string>());
  const [, setVersion] = useState(0);

  const run = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined;
    running.current.add(key);
    setVersion((v) => v + 1);
    try {
      return await fn();
    } finally {
      running.current.delete(key);
      setVersion((v) => v + 1);
    }
  }, []);

  const busy = useCallback((key: string) => running.current.has(key), []);
  return { run, busy };
}
