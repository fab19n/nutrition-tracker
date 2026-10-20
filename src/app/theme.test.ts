import { applyStoredTheme, applyTheme, readStoredTheme } from './theme';

function addMeta(content: string, media?: string): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = content;
  if (media) meta.media = media;
  document.head.appendChild(meta);
  return meta;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('--bg');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  window.localStorage.clear();
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark and clears it for system', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('points theme-color at --bg when forced and restores the media-specific colours for system', () => {
    const light = addMeta('#FAF4EA', '(prefers-color-scheme: light)');
    const dark = addMeta('#171310', '(prefers-color-scheme: dark)');
    document.documentElement.style.setProperty('--bg', '#171310');

    applyTheme('dark');
    expect(light.content).toBe('#171310');
    expect(dark.content).toBe('#171310');

    applyTheme('system');
    expect(light.content).toBe('#FAF4EA');
    expect(dark.content).toBe('#171310');
  });

  it('creates a theme-color meta when the page has none', () => {
    document.documentElement.style.setProperty('--bg', '#faf4ea');
    applyTheme('light');
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#faf4ea');
  });
});

describe('applyStoredTheme', () => {
  it('re-applies the last forced theme saved on this device', () => {
    window.localStorage.setItem('km-theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores anything that is not a theme', () => {
    window.localStorage.setItem('km-theme', 'neon');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('readStoredTheme', () => {
  it("returns this device's saved theme, or system when none is saved", () => {
    expect(readStoredTheme()).toBe('system');
    window.localStorage.setItem('km-theme', 'dark');
    expect(readStoredTheme()).toBe('dark');
    window.localStorage.setItem('km-theme', 'neon');
    expect(readStoredTheme()).toBe('system');
  });
});
