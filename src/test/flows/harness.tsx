/**
 * End-to-end flow harness: the whole app (AppShell + every route, sheet, toast) in a memory
 * router on a fresh database, driven with user-event. Test-only; not imported by the app.
 */
import { render, screen, type ByRoleOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockInstance } from 'vitest';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router';
import { routes } from '@/app/routes';
import { loadDemoData, resetAll } from '@/db/actions';
import { resetUiState } from '@/state/ui';

/** Lazy routes and live queries need a moment on a cold start. */
export const SLOW = { timeout: 8000 } as const;

/**
 * Fresh state before each test: no estimate endpoint (the local estimator answers), an empty
 * database, optionally the demo world (Fri 16 Oct 2026, 7:10pm), and an empty UI store.
 */
export function setupFlows(opts: { demo: boolean } = { demo: true }): void {
  let consoleError: MockInstance<typeof console.error> | undefined;
  // A whole flow is many screens long; give it room when the suite runs in parallel.
  vi.setConfig({ testTimeout: 30_000 });

  beforeEach(async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '');
    // React warnings (keys, nested updates, bad props) fail the flow.
    consoleError = vi.spyOn(console, 'error');
    // jsdom has no scrolling; ScrollRestoration calls it on every navigation.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    resetUiState();
    await resetAll();
    if (opts.demo) await loadDemoData();
  });

  afterEach(async () => {
    const calls = consoleError?.mock.calls ?? [];
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetUiState();
    // Live queries settling after the last assertion trip React's act() check; that's the test, not the app.
    const messages = calls.map((args) => args.map(String).join(' ')).filter((m) => !m.includes('not wrapped in act('));
    expect(messages).toEqual([]);
  });
}

/** Renders the whole app at `path`, like opening it on the phone. */
export function startApp(path: InitialEntry = '/') {
  const user = userEvent.setup();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { user, router, ...view };
}

export const nav = () => screen.queryByRole('navigation', { name: 'Main' });

/** The Today hero card (a button whose name starts with the main figure). */
export function findHero(name: RegExp | string = /left today|over today/) {
  return screen.findByRole('button', { name }, SLOW);
}

/** The hero's week bars ("This week: Mon 1,620, …"). */
export function findWeekBars(name: RegExp = /^This week: /) {
  return screen.findByRole('img', { name }, SLOW);
}

export function findDialog(name: string | RegExp, options: Omit<ByRoleOptions, 'name'> = {}) {
  return screen.findByRole('dialog', { name, ...options }, SLOW);
}


