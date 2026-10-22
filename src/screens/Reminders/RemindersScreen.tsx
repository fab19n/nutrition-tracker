import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { isAuthConfigured, signIn, useSession } from '@/auth/session';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { OptionGroup, type OptionItem } from '@/components/OptionRow/OptionRow';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SignInPanel } from '@/components/SignInPanel/SignInPanel';
import { SyncStatus } from '@/components/SyncStatus/SyncStatus';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useProfile } from '@/db/hooks';
import { updateReminderSettings, useReminderView, type ReminderSettingsPatch, type ReminderView } from '@/db/reminders';
import { DEFAULT_TZ } from '@/domain/day';
import { CHECK_IN_CHOICES_MIN, QUIET_FROM_CHOICES, QUIET_UNTIL_CHOICES } from '@/domain/reminders';
import { refreshPush, repairPush, retryPush, sendTestPush, turnOffPush, turnOnPush, type TurnOnResult } from '@/push';
import { usePushView } from '@/push/hooks';
import { describePush, type PushActionId } from '@/push/status';
import { useUiStore } from '@/state/ui';
import { syncNow, type SyncPhase } from '@/sync';
import { useSyncView } from '@/sync/hooks';
import { NotificationsSheet } from './NotificationsSheet';
import { checkInLabel, checkInToast, gapRow, quietAutoSub, quietRow, quietToast, REMINDER_TOASTS, testToast } from './remindersModel';
import styles from './RemindersScreen.module.css';

type SheetKind = 'checkIn' | 'quiet' | 'notifications' | 'signIn';

/** Sync isn't running on this device in these, so the server works from what the account last had. */
const SYNC_OFF: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['paused', 'choose', 'otherAccount', 'cloudReset']);

/** The chip nearest `min`, the short way round the clock. */
function nearest(choices: readonly number[], min: number): number {
  const distance = (a: number) => {
    const d = Math.abs(a - min) % 1440;
    return Math.min(d, 1440 - d);
  };
  return choices.reduce((best, c) => (distance(c) < distance(best) ? c : best), choices[0] ?? min);
}

function CheckInTimeSheet({ initial, onSave }: { initial: number; onSave: (min: number) => void }) {
  const [min, setMin] = useState(nearest(CHECK_IN_CHOICES_MIN, initial));
  return (
    <div className={styles.sheetBody}>
      <ChipGroup
        kind="choice"
        stretch
        label="Send it at"
        options={CHECK_IN_CHOICES_MIN}
        selectedIndex={CHECK_IN_CHOICES_MIN.indexOf(min as (typeof CHECK_IN_CHOICES_MIN)[number])}
        getLabel={checkInLabel}
        onSelect={(i) => {
          const next = CHECK_IN_CHOICES_MIN[i];
          if (next !== undefined) setMin(next);
        }}
      />
      <p className={styles.sheetNote}>Only when yesterday isn't confirmed yet. If your quiet hours run later, it waits until they end.</p>
      <Button onClick={() => onSave(min)}>Save</Button>
    </div>
  );
}

type QuietMode = 'auto' | 'custom';

function QuietHoursSheet({ view, onSave }: { view: ReminderView; onSave: (quiet: { fromMin: number; untilMin: number } | null) => void }) {
  const custom = view.prefs.quiet;
  const [mode, setMode] = useState<QuietMode>(custom ? 'custom' : 'auto');
  const [fromMin, setFromMin] = useState(nearest(QUIET_FROM_CHOICES, (custom ?? view.autoQuiet).fromMin));
  const [untilMin, setUntilMin] = useState(nearest(QUIET_UNTIL_CHOICES, (custom ?? view.autoQuiet).untilMin));
  const options: OptionItem[] = [
    { id: 'auto', label: 'Follow my sleep taps', sub: quietAutoSub(view.autoQuiet) },
    { id: 'custom', label: 'Set my own', sub: 'Pick when they start and end' },
  ];

  return (
    <div className={styles.sheetBody}>
      <OptionGroup size="lg" label="Quiet hours" options={options} value={mode} onChange={(id) => setMode(id === 'custom' ? 'custom' : 'auto')} />
      {mode === 'custom' ? (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel} aria-hidden="true">
              From
            </span>
            <ChipGroup
              kind="choice"
              stretch
              label="From"
              options={QUIET_FROM_CHOICES}
              selectedIndex={QUIET_FROM_CHOICES.indexOf(fromMin as (typeof QUIET_FROM_CHOICES)[number])}
              getLabel={checkInLabel}
              onSelect={(i) => {
                const next = QUIET_FROM_CHOICES[i];
                if (next !== undefined) setFromMin(next);
              }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel} aria-hidden="true">
              Until
            </span>
            <ChipGroup
              kind="choice"
              stretch
              label="Until"
              options={QUIET_UNTIL_CHOICES}
              selectedIndex={QUIET_UNTIL_CHOICES.indexOf(untilMin as (typeof QUIET_UNTIL_CHOICES)[number])}
              getLabel={checkInLabel}
              onSelect={(i) => {
                const next = QUIET_UNTIL_CHOICES[i];
                if (next !== undefined) setUntilMin(next);
              }}
            />
          </div>
        </>
      ) : null}
      <p className={styles.sheetNote}>Nothing is sent during quiet hours. A Going to sleep tap makes it quiet from then on.</p>
      <Button onClick={() => onSave(mode === 'custom' ? { fromMin, untilMin } : null)}>Save</Button>
    </div>
  );
}

const SHEET_TITLE: Record<'checkIn' | 'quiet', string> = { checkIn: 'Morning check-in', quiet: 'Quiet hours' };

/**
 * @design S38 Reminders — this device's notifications (a SyncStatus card: on, off, blocked, signed out,
 * demo, not available, server not set up) and the synced preferences: the morning check-in and its time,
 * gap nudges (locked until 14 complete days), the weekly review, target suggestions and quiet hours.
 */
export default function RemindersScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const view = useReminderView();
  const push = usePushView();
  // Showing the session starts it, so this device's card can move past "Checking".
  useSession();
  const syncPhase = useSyncView().phase;
  const showToast = useUiStore((s) => s.showToast);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void refreshPush();
  }, []);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.settings, { replace: true }));
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const copy = describePush(push, tz, { syncOff: SYNC_OFF.has(syncPhase) });
  const busy = running || push.busy !== undefined;

  /** One device action at a time; `toast` says how it went, when there's something to say. */
  const run = <T,>(pending: Promise<T>, toast: (result: T) => string | null) => {
    setRunning(true);
    void pending
      .then((result) => {
        const line = toast(result);
        if (line) showToast(line);
      })
      .finally(() => setRunning(false));
  };

  const turnedOn = (result: TurnOnResult): string | null => {
    if (result.ok) return REMINDER_TOASTS.on;
    return result.problem === 'denied' ? REMINDER_TOASTS.blocked : null;
  };

  const handlers: Record<PushActionId, () => void> = {
    signIn: () => setSheet('signIn'),
    // Straight from the tap when Chrome would ask nothing; otherwise the primer first.
    turnOn: () => (push.permission === 'granted' ? run(turnOnPush(), turnedOn) : setSheet('notifications')),
    turnOff: () => run(turnOffPush(), () => REMINDER_TOASTS.off),
    test: () => run(sendTestPush(), testToast),
    retry: () => run(retryPush(), () => null),
    repair: () => run(repairPush(), (result) => (result.ok ? REMINDER_TOASTS.on : null)),
  };

  const save = async (patch: ReminderSettingsPatch, toast?: string): Promise<boolean> => {
    try {
      await updateReminderSettings(patch);
      if (toast) showToast(toast);
      return true;
    } catch {
      showToast(REMINDER_TOASTS.saveFailed);
      return false;
    }
  };

  const saveFromSheet = async (patch: ReminderSettingsPatch, toast: string) => {
    if (await save(patch, toast)) setSheet(null);
  };

  const prefs = view?.prefs;
  const gap = view ? gapRow(view.gap) : undefined;
  const quiet = view ? quietRow(view.quiet) : undefined;

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title="Reminders" onBack={back} />
      <p className={styles.intro}>A few gentle nudges, never during quiet hours.</p>

      <section>
        <SectionHeading inset={20}>This device</SectionHeading>
        <div className={styles.status}>
          <SyncStatus
            {...copy}
            icon={push.phase === 'on' ? Bell : BellOff}
            actions={copy.actions.map((action) => ({ ...action, busy, onPress: handlers[action.id] }))}
          />
        </div>
      </section>

      {push.phase !== 'unconfigured' && view && prefs && gap && quiet ? (
        <>
          <SettingsGroup title="What to send" note="These sync to your other devices. Each device turns notifications on for itself.">
            <SettingsRow
              label="Morning check-in"
              sub="Quick check: was yesterday's log complete? Only when it isn't confirmed yet."
              toggle={{ checked: prefs.checkIn, onChange: (checkIn) => void save({ checkIn }) }}
            />
            {prefs.checkIn ? (
              <SettingsRow
                label="Check-in time"
                sub="Later if your quiet hours run past it"
                value={checkInLabel(prefs.checkInAtMin)}
                onPress={() => setSheet('checkIn')}
              />
            ) : null}
            {view.gap.unlocked ? (
              <SettingsRow label="Gap nudges" sub={gap.sub} toggle={{ checked: prefs.gapNudges, onChange: (gapNudges) => void save({ gapNudges }) }} />
            ) : (
              <SettingsRow label="Gap nudges" sub={gap.sub} value={gap.value} />
            )}
            <SettingsRow
              label="Weekly review"
              sub="Sunday night, when your week is ready"
              toggle={{ checked: prefs.weeklyReview, onChange: (weeklyReview) => void save({ weeklyReview }) }}
            />
            <SettingsRow
              label="Target suggestions"
              sub="When your logs suggest a new daily target. Once a week at most."
              toggle={{ checked: prefs.targetSuggestion, onChange: (targetSuggestion) => void save({ targetSuggestion }) }}
            />
          </SettingsGroup>

          <SettingsGroup title="Quiet hours" note="Nothing is sent during quiet hours, or after you tap Going to sleep until they end.">
            <SettingsRow label="Quiet hours" value={quiet.value} sub={quiet.sub} onPress={() => setSheet('quiet')} />
          </SettingsGroup>
        </>
      ) : null}

      <BottomSheet open={(sheet === 'checkIn' || sheet === 'quiet') && view !== undefined} onClose={() => setSheet(null)}>
        {view && (sheet === 'checkIn' || sheet === 'quiet') ? (
          <>
            <SheetTitle>{SHEET_TITLE[sheet]}</SheetTitle>
            {sheet === 'checkIn' ? (
              <CheckInTimeSheet
                initial={view.prefs.checkInAtMin}
                onSave={(checkInAtMin) => void saveFromSheet({ checkInAtMin }, checkInToast(checkInAtMin))}
              />
            ) : (
              <QuietHoursSheet
                view={view}
                onSave={(window) => void saveFromSheet({ quiet: window }, quietToast(window))}
              />
            )}
          </>
        ) : null}
      </BottomSheet>

      <NotificationsSheet open={sheet === 'notifications'} onClose={() => setSheet(null)} />

      <BottomSheet open={sheet === 'signIn' && isAuthConfigured()} onClose={() => setSheet(null)}>
        <SheetTitle>Sign in</SheetTitle>
        <SignInPanel
          signIn={signIn}
          onSignedIn={() => {
            setSheet(null);
            showToast('Signed in');
            void syncNow();
            void refreshPush();
          }}
        />
      </BottomSheet>
    </div>
  );
}
