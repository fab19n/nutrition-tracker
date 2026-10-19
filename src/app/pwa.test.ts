import { act, renderHook } from '@testing-library/react';
import { detectPlatform, detectStandalone, usePwaInstall } from './pwa';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('detectPlatform', () => {
  it('tells iOS, Android and everything else apart', () => {
    expect(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe('android');
    expect(detectPlatform({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe('other');
  });

  it('treats an iPad asking for the desktop site (a Mac with touch) as iOS', () => {
    expect(detectPlatform({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('other');
  });
});

describe('detectStandalone', () => {
  it('is false in a plain browser tab and true with display-mode standalone', () => {
    expect(detectStandalone()).toBe(false);
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(display-mode: standalone)' }) as MediaQueryList);
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      expect(detectStandalone()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('usePwaInstall', () => {
  it('captures beforeinstallprompt and shows it once on prompt()', async () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.isStandalone).toBe(false);
    expect(['ios', 'android', 'other']).toContain(result.current.platform);

    const showPrompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: showPrompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canPrompt).toBe(true);

    await act(async () => {
      await result.current.prompt();
    });
    expect(showPrompt).toHaveBeenCalledTimes(1);
    expect(result.current.canPrompt).toBe(false);

    // A second call has nothing left to show.
    await act(async () => {
      await result.current.prompt();
    });
    expect(showPrompt).toHaveBeenCalledTimes(1);
  });

  it('forgets a saved prompt once the app is installed', () => {
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: async () => undefined }));
    });
    expect(result.current.canPrompt).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current.canPrompt).toBe(false);
  });
});
