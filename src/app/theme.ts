import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect } from 'react';
import { db } from '@/db/db';
import { getProfile } from '@/db/selectors';
import type { ThemePreference } from '@/domain/types';

/**
 * Light / dark / system theme (Settings › Appearance). tokens.css swaps the colour set on
 * `data-theme` on <html>; with no attribute the system setting decides. The browser chrome
 * (<meta name="theme-color">) follows --bg.
 */

const STORAGE_KEY = 'km-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStored(): ThemePreference | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function store(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private mode): the profile still drives the theme once it loads.
  }
}

/**
 * Points every theme-color meta at the current --bg. Metas with a media query (index.html ships one
 * for light and one for dark) keep their own colour under 'system', so the browser can switch them.
 */
function syncThemeColor(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  let metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    metas = [meta];
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of metas) {
    if (meta.dataset.defaultContent === undefined) meta.dataset.defaultContent = meta.content;
    const hasMedia = meta.media !== '' && meta.media !== 'all';
    if (pref === 'system' && hasMedia) meta.content = meta.dataset.defaultContent;
    else if (bg) meta.content = bg;
  }
}

/** Sets or clears `data-theme` on <html> and updates the theme-color meta. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncThemeColor(pref);
}

/** Applies the last known theme before the database answers, so a forced dark theme never flashes light. */
export function applyStoredTheme(): void {
  const pref = readStored();
  if (pref) applyTheme(pref);
}

/** The profile's theme; 'system' before setup; undefined while loading. */
function useThemePreference(): ThemePreference | undefined {
  return useLiveQuery(async () => (await getProfile(db))?.theme ?? 'system', []);
}

/** Keeps <html data-theme> and the theme-color meta in step with the profile. Used once, by the shell. */
export function useProfileTheme(): void {
  const pref = useThemePreference();

  useLayoutEffect(() => {
    if (pref === undefined) return;
    applyTheme(pref);
    store(pref);
  }, [pref]);

  // Under 'system', metas without a media query have to follow the OS switch by hand.
  useLayoutEffect(() => {
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => syncThemeColor('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [pref]);
}
