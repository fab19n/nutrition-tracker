import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';

/**
 * Goes offline or back online the way a browser does: navigator.onLine changes first, then the
 * event fires. Firing only the event leaves navigator.onLine at true, which useOnline reads.
 */
export function setOnline(online: boolean): void {
  const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  onTestFinished(() => spy.mockRestore());
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}
