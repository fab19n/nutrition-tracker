import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { SettingsGroup } from '@/components/SettingsRow/SettingsRow';
import { SyncStatus } from '@/components/SyncStatus/SyncStatus';
import { Button } from '@/components/ui/Button';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { fmtAgo, fmtInt } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import {
  keepThisDeviceData,
  notNow,
  switchToSignedInAccount,
  syncNow,
  turnOffAfterReset,
  turnSyncBackOn,
  uploadAfterReset,
  useAccountData,
  type SyncPhase,
} from '@/sync';
import { isSyncError } from '@/sync/errors';
import { describeSync, type SyncActionId, type SyncView } from '@/sync/status';
import styles from './SyncGroup.module.css';

type Choice = NonNullable<SyncView['choice']>;

/** The confirm dialog that's open: the two choose-sheet replacements, or switching accounts. */
type ConfirmKind = 'useAccount' | 'keepDevice' | 'switch';

/** The card's buttons wait while these run. */
const BUSY_PHASES: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['syncing', 'uploading', 'restoring']);

/** 'No meals', '1 meal', '1,240 meals'. */
function mealCount(n: number): string {
  if (n === 0) return 'No meals';
  return `${fmtInt(n)} ${n === 1 ? 'meal' : 'meals'}`;
}

/**
 * A Postgres timestamptz from the account ('2026-10-16T11:00:00.25+00:00', up to six fractional
 * digits) in ms, NaN when it isn't one. The fraction goes to the three digits the format Date.parse
 * must accept has; anything else is up to the browser.
 */
function serverTimeMs(text: string): number {
  return Date.parse(text.replace(/\.(\d+)/, (_, fraction: string) => `.${fraction.padEnd(3, '0').slice(0, 3)}`));
}

/** "30 meals, last changed yesterday at 9:40pm. Replaces the 12 meals on this device." */
function accountSub(choice: Choice, nowMs: number, tz: string): string {
  const cloud = mealCount(choice.cloud.counts.meals ?? 0);
  const changedAt = choice.cloud.lastChangeAt === null ? Number.NaN : serverTimeMs(choice.cloud.lastChangeAt);
  const held = Number.isFinite(changedAt) ? `${cloud}, last changed ${fmtAgo(changedAt, nowMs, tz)}.` : `${cloud}.`;
  const replaces = choice.localMeals > 0 ? `Replaces the ${mealCount(choice.localMeals)} on this device.` : 'Replaces the data on this device.';
  return `${held} ${replaces}`;
}

/** "12 meals. Replaces the copy in your account, and your other devices follow." */
function deviceSub(choice: Choice): string {
  return `${mealCount(choice.localMeals)}. Replaces the copy in your account, and your other devices follow.`;
}

function switchBody(view: SyncView): string {
  const to = view.sessionEmail ?? "the account you're signed in to";
  const from = view.linkedEmail ?? 'the other account';
  return `This device's data starts syncing with ${to}. The copy in ${from} stays as it is.`;
}

interface ChooseSheetProps {
  choice: Choice;
  nowMs: number;
  tz: string;
  onUseAccount: () => void;
  onKeepDevice: () => void;
  onExport: () => void;
  onNotNow: () => void;
}

/** "Which copy to keep?": the account's diary or this device's, after an export if wanted, or neither for now. */
function ChooseSheet({ choice, nowMs, tz, onUseAccount, onKeepDevice, onExport, onNotNow }: ChooseSheetProps) {
  const id = useId();
  return (
    <>
      <SheetTitle>Which copy to keep?</SheetTitle>
      <div className={styles.sheetBody}>
        <p className={styles.lead}>This device and your account each have a diary. They can't be merged, so pick one.</p>
        <div className={styles.choice}>
          <Button onClick={onUseAccount} aria-describedby={`${id}-account`}>
            Use the account's data
          </Button>
          <p id={`${id}-account`} className={styles.choiceSub}>
            {accountSub(choice, nowMs, tz)}
          </p>
        </div>
        <div className={styles.choice}>
          <Button variant="secondary" onClick={onKeepDevice} aria-describedby={`${id}-device`}>
            Keep this device's data
          </Button>
          <p id={`${id}-device`} className={styles.choiceSub}>
            {deviceSub(choice)}
          </p>
        </div>
        <div className={styles.later}>
          <Button variant="ghost" size="md" onClick={onExport}>
            Export a backup first
          </Button>
          <Button variant="ghost" size="md" onClick={onNotNow}>
            Not now
          </Button>
        </div>
      </div>
    </>
  );
}

export interface SyncGroupProps {
  /** From useSyncView (src/sync/hooks.ts). */
  view: SyncView;
  /** The profile's time zone, for "Last synced at 9:40pm". */
  tz: string;
  /** Signing out is under way (the card's Sign out waits too). */
  signingOut: boolean;
  /** Opens the sign-in sheet. */
  onSignIn: () => void;
  /** Sends what's queued, then signs out. */
  onSignOut: () => void;
  /** The Account row, under the card. */
  children: ReactNode;
}

/**
 * Settings › Account and sync (shown when Supabase is set up): the sync card (C55-style
 * SyncStatus, copy from src/sync/status.ts) with its actions connected to the engine, over the
 * Account row. It also holds the "Which copy to keep?" sheet, its two confirm dialogs, and the
 * confirm for switching accounts.
 */
export function SyncGroup({ view, tz, signingOut, onSignIn, onSignOut, children }: SyncGroupProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);

  const choice = view.phase === 'choose' ? view.choice : undefined;
  const switchable = view.phase === 'otherAccount';
  // What the card no longer offers closes (another tab chose, or the session changed), so it
  // never opens again by itself later.
  if (chooseOpen && !choice) setChooseOpen(false);
  if (confirm !== null && !(confirm === 'switch' ? switchable : choice)) setConfirm(null);

  const copy = describeSync(view, view.now, tz);
  const busy = running || signingOut || BUSY_PHASES.has(view.phase);

  /** One engine call at a time. A failure says so; a stop (Delete everything, another tab) doesn't. */
  const run = async (task: () => Promise<void>, failed?: string, done?: string) => {
    setRunning(true);
    try {
      await task();
      if (done) showToast(done);
    } catch (error) {
      if (failed && !isSyncError(error, 'aborted')) showToast(failed);
    } finally {
      setRunning(false);
    }
  };

  const handlers: Record<SyncActionId, () => void> = {
    signIn: onSignIn,
    turnOn: () => void run(turnSyncBackOn, "Couldn't turn sync on. Try again."),
    syncNow: () => void run(syncNow),
    retry: () => void run(syncNow),
    choose: () => setChooseOpen(true),
    switchAccount: () => setConfirm('switch'),
    signOut: onSignOut,
    uploadAfterReset: () => void run(uploadAfterReset, "Couldn't start the upload. Try again."),
    turnOff: () => void run(turnOffAfterReset, "Couldn't turn sync off. Try again."),
  };

  const chosen = (task: () => Promise<void>, failed: string, done: string) => {
    setConfirm(null);
    setChooseOpen(false);
    void run(task, failed, done);
  };

  return (
    <section>
      <SectionHeading inset={20}>Account and sync</SectionHeading>
      <div className={styles.status}>
        <SyncStatus {...copy} actions={copy.actions.map((action) => ({ ...action, busy, onPress: handlers[action.id] }))} />
      </div>
      <SettingsGroup>{children}</SettingsGroup>

      <BottomSheet open={chooseOpen && choice !== undefined} onClose={() => setChooseOpen(false)}>
        {choice ? (
          <ChooseSheet
            choice={choice}
            nowMs={view.now}
            tz={tz}
            onUseAccount={() => setConfirm('useAccount')}
            onKeepDevice={() => setConfirm('keepDevice')}
            onExport={() => {
              setChooseOpen(false);
              navigate(PATHS.export);
            }}
            onNotNow={() => {
              setChooseOpen(false);
              void run(notNow, "Couldn't turn sync off. Try again.");
            }}
          />
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        open={confirm === 'useAccount'}
        title="Replace this device's data?"
        body="Everything on this device is replaced with your account's data. Entries only on this device are lost."
        confirmLabel="Replace this device's data"
        destructive
        onConfirm={() => chosen(useAccountData, "Couldn't get your account's data. Try again.", "Using your account's data")}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'keepDevice'}
        title="Replace your account's data?"
        body="Your account gets this device's data. Entries only in your account are deleted, and your other devices follow on their next sync."
        confirmLabel="Replace account data"
        destructive
        onConfirm={() => chosen(keepThisDeviceData, "Couldn't start the upload. Try again.", "Uploading this device's data")}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'switch'}
        title="Sync with this account?"
        body={switchBody(view)}
        confirmLabel="Switch"
        onConfirm={() => {
          setConfirm(null);
          void run(switchToSignedInAccount, "Couldn't switch accounts. Try again.");
        }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
