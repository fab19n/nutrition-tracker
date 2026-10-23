import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOnline } from '@/test/network';
import { useOnline } from './network';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOnline', () => {
  it('reads navigator.onLine when it subscribes, so a change before then is never missed', () => {
    // The browser went offline (and fired its event) before this component subscribed.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

  it('follows the browser going offline and back online', () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    setOnline(false);
    expect(result.current).toBe(false);
    setOnline(true);
    expect(result.current).toBe(true);
  });

  it('goes by navigator.onLine, not by an event alone', () => {
    const { result } = renderHook(() => useOnline());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(true);
  });
});
