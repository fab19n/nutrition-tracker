import { useCallback, useEffect, useRef, useState } from 'react';
import { signIn, signOut, useSession } from '@/auth/session';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { SignInPanel } from '@/components/SignInPanel/SignInPanel';
import { Button } from '@/components/ui/Button';
import { fmtInt } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import { restoreFromAccount, type SyncProgress } from '@/sync';
import { isSyncError } from '@/sync/errors';
import styles from './Setup.module.css';

export interface RestoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** "Get started" and "Set up instead": closes the sheet and starts setup on this device (S02). */
  onSetUp: () => void;
}

/**
 * Where the sheet is. 'account' follows the session: checking it, the sign-in panel while signed
 * out, and the restore straight away once signed in. 'signIn' asks again after the account
 * refused the session. 'uploading': the account has rows but no profile yet, so another device's
 * first upload is part way. 'failed' with notSetUp: the server has no sync functions yet.
 */
type View =
  | { kind: 'account' }
  | { kind: 'signIn' }
  | { kind: 'restoring'; progress: SyncProgress }
  | { kind: 'empty' }
  | { kind: 'uploading' }
  | { kind: 'failed'; notSetUp: boolean };

const STARTING: SyncProgress = { done: 0, total: 0 };
/** The Settings card's line for the same state (src/sync/status.ts, notSetUp). */
const NOT_SET_UP = 'Run supabase/sync.sql in the Supabase SQL Editor (see DEPLOY.md).';

/** "340 of about 1,840 entries. Keep the app open.", or the second sentence while the total is unknown. */
function progressLine({ done, total }: SyncProgress): string {
  if (total <= 0) return 'Keep the app open.';
  return `${fmtInt(Math.min(Math.max(done, 0), total))} of about ${fmtInt(total)} entries. Keep the app open.`;
}

function mealsLabel(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'meal' : 'meals'}`;
}

/**
 * Welcome › Restore from your account (ARCHITECTURE.md §6.2): signs in when needed, then
 * downloads the account's diary and writes it in one commit (src/sync restoreFromAccount). The
 * sheet can't be closed while that runs. Once the profile lands, SetupFlow opens Today by itself;
 * the toast says how many meals came back. Nothing on this device changes unless the restore
 * completes.
 */
export function RestoreSheet(props: RestoreSheetProps) {
  // Only an open sheet reads the session, so Welcome alone never loads supabase-js.
  return props.open ? <OpenRestoreSheet {...props} /> : null;
}

function OpenRestoreSheet({ onClose, onSetUp }: RestoreSheetProps) {
  const session = useSession();
  const showToast = useUiStore((s) => s.showToast);
  const [view, setView] = useState<View>({ kind: 'account' });
  const [signingOut, setSigningOut] = useState(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restore = useCallback(() => {
    // StrictMode runs effects twice, and Try again can't be pressed twice: one restore at a time.
    if (running.current) return;
    running.current = true;
    setView({ kind: 'restoring', progress: STARTING });
    void (async () => {
      try {
        const result = await restoreFromAccount((progress) => {
          if (mounted.current) setView({ kind: 'restoring', progress });
        });
        if (result.result === 'restored') {
          // The profile is in: SetupFlow opens Today and the sheet goes with it.
          showToast(`Restored · ${mealsLabel(result.meals)}`);
        } else if (mounted.current) {
          setView({ kind: result.result });
        }
      } catch (error) {
        if (!mounted.current) return;
        if (isSyncError(error, 'needsSignIn')) setView({ kind: 'signIn' });
        else setView({ kind: 'failed', notSetUp: isSyncError(error, 'notSetUp') });
      } finally {
        running.current = false;
      }
    })();
  }, [showToast]);

  // Signed in (already, or just now in the panel): the restore starts without another tap.
  useEffect(() => {
    if (view.kind === 'account' && session.status === 'signedIn') restore();
  }, [view.kind, session.status, restore]);

  const checking = view.kind === 'account' && session.status === 'loading';
  const askToSignIn = view.kind === 'signIn' || (view.kind === 'account' && session.status !== 'signedIn' && !checking);
  // Signed in as the sheet opens: show the restore at once rather than a frame of something else.
  const shown: View = view.kind === 'account' && session.status === 'signedIn' ? { kind: 'restoring', progress: STARTING } : view;
  const screenKey = askToSignIn ? 'signIn' : checking ? 'checking' : shown.kind;

  // A new state (not each progress step) moves focus to its title, so screen readers hear it and
  // focus never stays on a button that's gone. The sign-in panel focuses its own first field.
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    if (screenKey === 'signIn') return;
    const heading = rootRef.current?.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }, [screenKey]);

  const leave = async () => {
    setSigningOut(true);
    try {
      await signOut();
      // Signed out now: the sign-in panel, for another account.
      if (mounted.current) setView({ kind: 'account' });
    } catch {
      showToast("Couldn't sign out. Try again.");
    } finally {
      if (mounted.current) setSigningOut(false);
    }
  };

  const working = shown.kind === 'restoring' || signingOut;

  return (
    <BottomSheet open onClose={onClose} dismissible={!working}>
      <div ref={rootRef}>
        {askToSignIn ? (
          <>
            <SheetTitle>Restore from your account</SheetTitle>
            <SignInPanel
              signIn={signIn}
              lead="Sign in with the account your diary syncs to."
              initialEmail={session.email}
              // Asked again after a refusal: back to following the session, which restores.
              onSignedIn={() => setView((current) => (current.kind === 'signIn' ? { kind: 'account' } : current))}
            />
          </>
        ) : null}

        {checking ? (
          <>
            <SheetTitle>Restore from your account</SheetTitle>
            <p className={styles.restoreBody}>Checking your account…</p>
          </>
        ) : null}

        {!askToSignIn && shown.kind === 'restoring' ? (
          <>
            <SheetTitle>Restoring your diary</SheetTitle>
            <p className={styles.restoreBody}>{progressLine(shown.progress)}</p>
            {shown.progress.total > 0 ? (
              <div
                className={styles.restoreTrack}
                role="progressbar"
                aria-label="Restoring your diary"
                aria-valuemin={0}
                aria-valuemax={shown.progress.total}
                aria-valuenow={Math.min(Math.max(shown.progress.done, 0), shown.progress.total)}
              >
                <div
                  className={styles.restoreFill}
                  style={{ width: `${Math.min(100, Math.max(0, (shown.progress.done / shown.progress.total) * 100))}%` }}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {shown.kind === 'empty' ? (
          <>
            <SheetTitle>Nothing to restore yet</SheetTitle>
            <p className={styles.restoreBody}>This account has no diary yet. Set up here and it syncs from then on.</p>
            <div className={styles.restoreActions}>
              <Button onClick={onSetUp} disabled={signingOut}>
                Get started
              </Button>
              <Button variant="ghost" size="lg" onClick={() => void leave()} disabled={signingOut} aria-busy={signingOut || undefined}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </>
        ) : null}

        {shown.kind === 'uploading' ? (
          <>
            <SheetTitle>Your diary is still uploading</SheetTitle>
            <p className={styles.restoreBody}>Another device is still sending your diary. Keep it open, then try again in a minute.</p>
            <div className={styles.restoreActions}>
              <Button onClick={restore}>Try again</Button>
              <Button variant="ghost" size="lg" onClick={onSetUp}>
                Set up instead
              </Button>
            </div>
          </>
        ) : null}

        {shown.kind === 'failed' ? (
          <>
            <SheetTitle>Couldn't restore right now</SheetTitle>
            <p className={styles.restoreBody}>
              {shown.notSetUp ? NOT_SET_UP : 'Check your connection and try again. Nothing on this device has changed.'}
            </p>
            <div className={styles.restoreActions}>
              <Button onClick={restore}>Try again</Button>
              <Button variant="ghost" size="lg" onClick={onSetUp}>
                Set up instead
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}
