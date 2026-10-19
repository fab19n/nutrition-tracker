import { useCallback, useEffect } from 'react';
import { Navigate, Outlet, ScrollRestoration, useBlocker, useLocation, useMatches, useNavigate, type BlockerFunction } from 'react-router';
import { topLocalSheet } from '@/components/BottomSheet/BottomSheet';
import { BottomNav, type NavTab } from '@/components/BottomNav/BottomNav';
import { Button } from '@/components/ui/Button';
import { useCheckIn, useHasProfile } from '@/db/hooks';
import { useBootstrap } from './bootstrap';
import { takeProgrammaticBack } from './history';
import { useSheet } from './navigation';
import { useOnline } from './network';
import { OfflineBanner } from './OfflineBanner';
import { PATHS, type Tab } from './paths';
import type { RouteHandle } from './routes';
import { SheetHost } from './SheetHost';
import { useProfileTheme } from './theme';
import { ToastHost } from './ToastHost';
import styles from './AppShell.module.css';

const TAB_PATHS: Record<NavTab, string> = {
  today: PATHS.today,
  diary: PATHS.diary,
  insights: PATHS.insights,
  more: PATHS.more,
};

function isRouteHandle(handle: unknown): handle is RouteHandle {
  return typeof handle === 'object' && handle !== null && 'tab' in handle;
}

/** The deepest matched route's `{ tab }` handle: a tab shows the nav, false (or none) hides it. */
function useActiveTab(): Tab | false {
  const matches = useMatches();
  const handle = matches.findLast((m) => isRouteHandle(m.handle))?.handle;
  return isRouteHandle(handle) ? handle.tab : false;
}

/** Setup (S01–S07) and the component gallery run without a profile. */
export function allowedWithoutProfile(pathname: string): boolean {
  return [PATHS.setup, PATHS.dev].some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** C01 with the Log sheet on "+" and the amber dot on Today while a check-in waits. */
function ShellNav({ active }: { active: NavTab }) {
  const navigate = useNavigate();
  const { open } = useSheet();
  const checkIn = useCheckIn();
  return (
    <BottomNav
      active={active}
      onNavigate={(tab) => navigate(TAB_PATHS[tab])}
      onLog={() => open('log')}
      badges={{ today: checkIn?.needed === true }}
    />
  );
}

/**
 * The phone's back button closes the newest local sheet (a picker, Usuals, Add an item…) instead
 * of leaving the screen under it. Those sheets have no history entry of their own, so the POP is
 * blocked and the sheet closed; ?sheet= sheets and the app's own goBack() pass through.
 */
function useBackClosesLocalSheets() {
  const shouldBlock = useCallback<BlockerFunction>(({ historyAction }) => {
    if (historyAction !== 'POP') return false;
    if (takeProgrammaticBack()) return false;
    return topLocalSheet() !== undefined;
  }, []);
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const sheet = topLocalSheet();
    // A sheet that can't be dismissed stays, as it does for Escape.
    if (sheet?.dismissible) sheet.close();
    blocker.reset();
  }, [blocker]);
}

function ShellLayout() {
  useBackClosesLocalSheets();
  const tab = useActiveTab();
  const online = useOnline();
  return (
    <div className={styles.app}>
      <main className={styles.main}>
        <OfflineBanner offline={!online} />
        <Outlet />
      </main>
      {tab ? <ShellNav active={tab} /> : null}
      <SheetHost />
      <ToastHost placement={tab ? 'aboveNav' : 'bottom'} />
      <ScrollRestoration />
    </div>
  );
}

/**
 * The app shell (layout route): start-up, first-run redirect, theme, the centred phone column with
 * window scrolling, bottom nav, sheet host, toast host and offline banner.
 */
export function AppShell() {
  useProfileTheme();
  const ready = useBootstrap();
  const hasProfile = useHasProfile();
  const { pathname } = useLocation();

  // Plain --bg until the clock is synced and we know whether setup has run.
  if (!ready || hasProfile === undefined) return <div className={styles.splash} />;
  // First run: everything except setup goes to S01. With a profile, /setup is SetupFlow's call.
  if (!hasProfile && !allowedWithoutProfile(pathname)) return <Navigate to={PATHS.setup} replace />;
  return <ShellLayout />;
}

/** Route error element: a calm fallback instead of the router's developer screen. */
export function ShellError() {
  return (
    <div className={styles.app}>
      <main className={styles.error}>
        <h1 className="t-subtitle">Something went wrong</h1>
        <p className="t-body muted">Your entries stay on this phone. Reload to try again.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </main>
    </div>
  );
}
