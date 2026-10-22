import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { isAuthConfigured, signIn, signOut, useSession, type SessionState } from '@/auth/session';
import { clearStoredSession } from '@/auth/supabase';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { nextOptionIndex } from '@/components/OptionRow/optionKeys';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SignInPanel } from '@/components/SignInPanel/SignInPanel';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { resetAll, setDemoMode } from '@/db/actions';
import { db } from '@/db/db';
import { useMealCount, useNow, useProfile, useWeightTrend } from '@/db/hooks';
import {
  AI_ESTIMATE_MODES,
  DAILY_MINIMUM_STEP,
  PROFILE_LIMITS,
  ROLLOVER_HOURS,
  aiEstimateModeOf,
  clearLastExport,
  readLastBackupAt,
  readLastExport,
  updateProfileSettings,
  type ProfileSettingsPatch,
} from '@/db/settings';
import { backupStatus } from '@/domain/backup';
import { fmtClock, fmtDayShort, fmtInt, fmtKcal, fmtKg } from '@/domain/format';
import { logicalDayOf } from '@/domain/day';
import { photosLabel } from '@/domain/photoSync';
import { resolveReminderPrefs } from '@/domain/reminders';
import type { AiEstimateMode, Profile, Sex, ThemePreference } from '@/domain/types';
import { forgetDriveToken, resumeDrive, stopDrive } from '@/drive';
import { useDriveView } from '@/drive/hooks';
import { readEstimateUrl } from '@/estimate/aiClient';
import { forgetPush } from '@/push';
import { usePushView } from '@/push/hooks';
import { backupsRowSub } from '@/screens/Backups/backupsModel';
import { remindersRowSub } from '@/screens/Reminders/remindersModel';
import { SEX_OPTIONS } from '@/screens/Setup/AboutStep';
import { fieldError, parseNumber } from '@/screens/Setup/fields';
import { NumberField } from '@/screens/Setup/NumberField';
import { Stepper } from '@/screens/Setup/Stepper';
import { resetUiState, useUiStore } from '@/state/ui';
import { flushSync, resumeSync, stopSync, syncNow } from '@/sync';
import { useSyncView } from '@/sync/hooks';
import { pendingSummary, readMeta } from '@/sync/local';
import setupStyles from '@/screens/Setup/Setup.module.css';
import { PhotosGroup } from './PhotosGroup';
import { SyncGroup } from './SyncGroup';
import styles from './SettingsScreen.module.css';

type SheetKind = 'profile' | 'minimum' | 'rollover';

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const SEX_LABEL: Record<Sex, string> = { male: 'Male', female: 'Female' };

const TARGET_NOTE = 'Your target changes through a suggestion you approve.';

const AI_MODE_COPY: Record<AiEstimateMode, { label: string; sub: string }> = {
  auto: { label: 'When needed', sub: "Only when the offline estimator can't match everything you typed. Cheapest." },
  always: { label: 'Always', sub: 'Every typed meal and photo goes to the AI.' },
  off: { label: 'Off', sub: "Offline estimates only. Meals aren't sent to the AI." },
};

function hourLabel(hour: number): string {
  return fmtClock(hour * 60, { compact: true });
}

/** How long Delete everything waits for Supabase to end the session before forgetting it anyway. */
const SIGN_OUT_WAIT_MS = 3_000;
/** How long Sign out waits for what's queued to reach the account. */
const SIGN_OUT_FLUSH_MS = 5_000;

/** '1 change', '12 changes'. */
function changes(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'change' : 'changes'}`;
}

/** Changes queued for the account this device syncs with; 0 when it isn't linked, or can't tell. */
async function changesWaiting(): Promise<number> {
  try {
    const [meta, summary] = await Promise.all([readMeta(db), pendingSummary(db)]);
    return meta.link ? summary.pending : 0;
  } catch {
    return 0;
  }
}

/**
 * Delete everything signs this phone out too, so no token, email or user record stays behind.
 * It never rejects and never holds the wipe up for long: whatever Supabase answers, the stored
 * session is removed.
 */
async function forgetAccount(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_WAIT_MS);
  });
  // Caught here so a sign-out that fails after the wait never surfaces as an unhandled rejection.
  const signingOut = signOut().catch(() => undefined);
  await Promise.race([signingOut, waited]);
  clearTimeout(timer);
  clearStoredSession();
}

/** Age, sex and height. Saving updates the profile only, never the target. */
function ProfileSheet({ profile, onSave, onCancel }: { profile: Profile; onSave: (patch: ProfileSettingsPatch) => void; onCancel: () => void }) {
  const [age, setAge] = useState(String(profile.age));
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [height, setHeight] = useState(String(profile.heightCm));
  const [tried, setTried] = useState(false);
  const errors = { age: fieldError('age', age), heightCm: fieldError('heightCm', height) };

  const save = () => {
    const ageValue = parseNumber(age);
    const heightValue = parseNumber(height);
    if (errors.age || errors.heightCm || ageValue === null || heightValue === null) {
      setTried(true);
      return;
    }
    onSave({ age: ageValue, sex, heightCm: heightValue });
  };

  return (
    <form
      className={styles.sheetBody}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <NumberField label="Age" unit="years" value={age} onChange={setAge} error={tried ? errors.age : null} />
      <div className={setupStyles.field}>
        <span className={setupStyles.fieldLabel} aria-hidden="true">
          Sex
        </span>
        <ChipGroup
          kind="choice"
          stretch
          label="Sex"
          options={SEX_OPTIONS}
          selectedIndex={SEX_OPTIONS.findIndex((o) => o.value === sex)}
          getLabel={(o) => o.label}
          onSelect={(i) => {
            const option = SEX_OPTIONS[i];
            if (option) setSex(option.value);
          }}
        />
      </div>
      <NumberField
        label="Height"
        unit="cm"
        decimal
        hint="An estimate is fine."
        value={height}
        onChange={setHeight}
        error={tried ? errors.heightCm : null}
      />
      <p className={styles.sheetNote}>{TARGET_NOTE}</p>
      <Button type="submit">Save</Button>
      <Button variant="ghost" size="md" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function MinimumSheet({ initial, onSave }: { initial: number; onSave: (kcal: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className={styles.sheetBody}>
      <div className={styles.sheetCard}>
        <Stepper
          label="Daily minimum"
          sub="No day's allowance goes below this"
          value={value}
          onChange={setValue}
          min={PROFILE_LIMITS.dailyMinimumKcal.min}
          max={PROFILE_LIMITS.dailyMinimumKcal.max}
          step={DAILY_MINIMUM_STEP}
          unit="kcal"
        />
      </div>
      <p className={styles.sheetNote}>When you go over, the rest of the week shares it out, never below this. {TARGET_NOTE}</p>
      <Button onClick={() => onSave(value)}>Save</Button>
    </div>
  );
}

function RolloverSheet({ initial, onSave }: { initial: number; onSave: (hour: number) => void }) {
  const [hour, setHour] = useState(initial);
  return (
    <div className={styles.sheetBody}>
      <ChipGroup
        kind="choice"
        stretch
        label="Day rolls over at"
        options={ROLLOVER_HOURS}
        selectedIndex={ROLLOVER_HOURS.indexOf(hour as (typeof ROLLOVER_HOURS)[number])}
        getLabel={hourLabel}
        onSelect={(i) => {
          const next = ROLLOVER_HOURS[i];
          if (next !== undefined) setHour(next);
        }}
      />
      <p className={styles.sheetNote}>A 2am supper counts as the night before. Meals you've already logged keep their day.</p>
      <Button onClick={() => onSave(hour)}>Save</Button>
    </div>
  );
}

/** When typed and photographed meals go to the AI: a radio list inside the AI estimates card. */
function AiModeChooser({ value, onChange }: { value: AiEstimateMode; onChange: (mode: AiEstimateMode) => void }) {
  const captionId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = AI_ESTIMATE_MODES.indexOf(value);
  const tabbable = selected >= 0 ? selected : 0;

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextOptionIndex(event.key, index, AI_ESTIMATE_MODES.length);
    const mode = next === null ? undefined : AI_ESTIMATE_MODES[next];
    if (next === null || mode === undefined) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(mode);
  };

  return (
    <div className={styles.modeBlock}>
      <p id={captionId} className={styles.modeCaption}>
        When to use AI
      </p>
      <div role="radiogroup" aria-labelledby={captionId} className={styles.modeList}>
        {AI_ESTIMATE_MODES.map((mode, i) => {
          const checked = mode === value;
          return (
            <button
              key={mode}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabbable ? 0 : -1}
              className={[styles.modeRow, checked ? styles.modeChecked : ''].filter(Boolean).join(' ')}
              onClick={() => onChange(mode)}
              onKeyDown={onKeyDown(i)}
            >
              <span className={styles.modeText}>
                <span className={styles.controlLabel}>{AI_MODE_COPY[mode].label}</span>
                <span className={styles.controlSub}>{AI_MODE_COPY[mode].sub}</span>
              </span>
              <span className={styles.radio} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface AccountRowProps {
  session: SessionState;
  signingOut: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

/** Who's signed in, with Sign out; or the way into the sign-in sheet. */
function AccountRow({ session, signingOut, onSignIn, onSignOut }: AccountRowProps) {
  if (session.status === 'signedIn') {
    return (
      <div className={styles.accountRow}>
        <span className={styles.accountText}>
          <span className={styles.controlLabel}>Account</span>
          <span className={[styles.controlSub, styles.accountEmail].join(' ')}>
            {session.email ? `Signed in as ${session.email}` : 'Signed in'}
          </span>
        </span>
        <Button variant="secondary" size="sm" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    );
  }
  if (session.status === 'loading') return <SettingsRow label="Account" sub="Checking sign-in…" />;
  return <SettingsRow label="Account" sub="Sign in to sync and use AI estimates" value="Sign in" onPress={onSignIn} />;
}

const SHEET_TITLE: Record<SheetKind, string> = {
  profile: 'Profile and body',
  minimum: 'Daily minimum',
  rollover: 'Day rollover',
};

/**
 * S19 Settings: account and sync, AI estimates (when to use AI), profile, budget, day, appearance,
 * privacy, photos (Keep photos and Google Drive), data, demo, about and Delete everything.
 */
export default function SettingsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const weight = useWeightTrend();
  const now = useNow();
  const mealCount = useMealCount();
  const session = useSession();
  const syncView = useSyncView();
  const driveView = useDriveView();
  const pushView = usePushView();
  const showToast = useUiStore((s) => s.showToast);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastExport] = useState(readLastExport);
  const [lastBackupAt] = useState(readLastBackupAt);

  // Sign-in serves sync and guards the AI function, so Account and sync exists only when Supabase
  // is set up. Without Supabase, AI calls go straight to the endpoint (the Vite dev server in local dev).
  const authConfigured = isAuthConfigured();
  const aiReachable = authConfigured || readEstimateUrl() !== undefined;
  const aiMode = aiEstimateModeOf(profile);
  let aiNote: string | undefined;
  if (!authConfigured) {
    aiNote = import.meta.env.DEV ? 'AI estimates run through the dev server.' : undefined;
  } else if (session.status === 'signedOut' && aiMode !== 'off') {
    aiNote = 'Until you sign in, estimates stay offline.';
  }

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.more, { replace: true }));

  const save = async (patch: ProfileSettingsPatch, toast?: string) => {
    try {
      await updateProfileSettings(patch);
      if (toast) showToast(toast);
      return true;
    } catch {
      showToast("Couldn't save that. Try again.");
      return false;
    }
  };

  const saveFromSheet = async (patch: ProfileSettingsPatch, toast: string) => {
    if (await save(patch, toast)) setSheet(null);
  };

  const leaveAccount = async () => {
    setSigningOut(true);
    try {
      // What's queued goes to the account first; whatever is left waits here for the next sign-in.
      await flushSync(SIGN_OUT_FLUSH_MS);
      // This device's reminders go with the account, while its token still works (never longer than 3 s).
      await forgetPush();
      await signOut();
      const waiting = await changesWaiting();
      showToast(waiting > 0 ? `Signed out. ${changes(waiting)} ${waiting === 1 ? 'waits' : 'wait'} on this device until you sign in.` : 'Signed out');
    } catch {
      showToast("Couldn't sign out. Try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const leaveDemo = async () => {
    await setDemoMode(false);
    resetUiState();
    // The sample week's export record carries a demo timestamp.
    clearLastExport();
    navigate(PATHS.setup, { replace: true });
  };

  const deleteEverything = async () => {
    setConfirmDelete(false);
    // Sync and Drive stand still while this phone is wiped, and a wipe is never sent: the account's
    // copy and the photos in Google Drive stay.
    await Promise.all([stopSync(), stopDrive()]);
    try {
      // Reminders for this device go first, while the session's token still works.
      await Promise.all([resetAll(), forgetPush().then(forgetAccount)]);
      forgetDriveToken();
    } finally {
      resumeSync();
      resumeDrive();
    }
    resetUiState();
    clearLastExport();
    navigate(PATHS.setup, { replace: true });
    showToast('Everything on this phone is deleted');
  };

  const latestKg = weight?.entries[0]?.kg;
  // The monthly backup nudge shows here, quietly: the Backups row's sub-line says when a file is due.
  const backupsSub = profile
    ? backupsRowSub(
        backupStatus({
          ...(lastBackupAt ? { lastBackupAt } : {}),
          now,
          tz: profile.timeZone,
          startedOn: profile.startedOn,
          mealCount: mealCount ?? 0,
          demo: profile.demoMode === true,
        }),
        authConfigured,
      )
    : '';
  const exportSub = lastExport
    ? `Last export ${fmtDayShort(logicalDayOf(lastExport.at, profile?.timeZone, 0))}`
    : 'Full backup or spreadsheet files';
  // Failed changes haven't reached the account either: they go too.
  const unsynced = syncView.pending + syncView.failed;
  // Once linked the copy is about sync, so it says "device" (a laptop syncs too); before, "phone" as elsewhere.
  const deleteSub = syncView.linked ? 'Removes all data on this device. The copy in your account stays.' : 'Removes all data on this phone';
  // Photos waiting to upload (or set aside) are only on this device: the wipe takes them with it.
  const photosWaiting = driveView.counts.uploads + driveView.counts.failed;
  const driveNote = driveView.connected
    ? ' Photos in your Google Drive stay there.' +
      (photosWaiting > 0 ? ` ${photosLabel(photosWaiting)} that ${photosWaiting === 1 ? "hasn't" : "haven't"} uploaded will be lost.` : '')
    : '';
  const deleteBody =
    (syncView.linked
      ? 'Every meal, weigh-in, Place and goal on this device goes, and this device signs out. The copy in your account stays, so signing in again brings it back.' +
        (unsynced > 0 ? ` ${changes(unsynced)} ${unsynced === 1 ? "hasn't" : "haven't"} synced and will be lost.` : '')
      : "Every meal, weigh-in, Place and goal on this phone goes, and it can't be undone. Export a backup first if you want a copy.") + driveNote;

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title="Settings" onBack={back} />

      {profile ? (
        <div className={styles.settingsBody}>
          {authConfigured ? (
            <SyncGroup
              view={syncView}
              tz={profile.timeZone}
              signingOut={signingOut}
              onSignIn={() => setSignInOpen(true)}
              onSignOut={() => void leaveAccount()}
            >
              <AccountRow
                session={session}
                signingOut={signingOut}
                onSignIn={() => setSignInOpen(true)}
                onSignOut={() => void leaveAccount()}
              />
            </SyncGroup>
          ) : null}

          {aiReachable ? (
            <SettingsGroup title="AI estimates" note={aiNote}>
              <AiModeChooser
                value={aiMode}
                onChange={(mode) => {
                  if (mode !== aiMode) void save({ aiEstimates: mode });
                }}
              />
            </SettingsGroup>
          ) : null}

          <SettingsGroup title="Profile and body" note={TARGET_NOTE}>
            <SettingsRow label="Age" value={fmtInt(profile.age)} onPress={() => setSheet('profile')} />
            <SettingsRow label="Sex" value={SEX_LABEL[profile.sex]} onPress={() => setSheet('profile')} />
            <SettingsRow label="Height" sub="An estimate is fine" value={`${fmtInt(profile.heightCm)} cm`} onPress={() => setSheet('profile')} />
            <SettingsRow
              label="Weight"
              sub="Latest weigh-in"
              value={latestKg !== undefined ? fmtKg(latestKg) : 'None yet'}
              onPress={() => navigate(PATHS.weight)}
            />
          </SettingsGroup>

          <SettingsGroup title="Budget">
            <SettingsRow
              label="Daily minimum"
              sub="No day's allowance goes below this"
              value={fmtKcal(profile.dailyMinimumKcal)}
              onPress={() => setSheet('minimum')}
            />
            <SettingsRow label="Weeks start on Monday" sub="Each week's budget starts fresh" />
          </SettingsGroup>

          <SettingsGroup title="Day">
            <SettingsRow
              label="Day rollover"
              sub="A 2am supper counts as the night before"
              value={hourLabel(profile.rolloverHour)}
              onPress={() => setSheet('rollover')}
            />
          </SettingsGroup>

          <SettingsGroup title="Appearance">
            <div className={styles.controlRow}>
              <span>
                <span className={styles.controlLabel}>Theme</span>
                <span className={styles.controlSub}>System follows your phone's light or dark setting</span>
              </span>
              <ChipGroup
                kind="portion"
                label="Theme"
                options={THEME_OPTIONS}
                selectedIndex={THEME_OPTIONS.findIndex((o) => o.value === profile.theme)}
                getLabel={(o) => o.label}
                onSelect={(i) => {
                  const option = THEME_OPTIONS[i];
                  if (option && option.value !== profile.theme) void save({ theme: option.value });
                }}
              />
            </div>
          </SettingsGroup>

          <SettingsGroup title="Privacy">
            <SettingsRow
              label="Location"
              sub="Suggests the nearest Place when you log. Only each Place's own spot is saved."
              toggle={{ checked: profile.useLocation, onChange: (useLocation) => void save({ useLocation }) }}
            />
          </SettingsGroup>

          <PhotosGroup profile={profile} />

          <SettingsGroup title="Reminders and data">
            <SettingsRow
              label="Reminders"
              sub={remindersRowSub(pushView, resolveReminderPrefs(profile.reminders))}
              onPress={() => navigate(PATHS.reminders)}
            />
            <SettingsRow label="Backups" sub={backupsSub} onPress={() => navigate(PATHS.backups)} />
            <SettingsRow label="Export" sub={exportSub} onPress={() => navigate(PATHS.export)} />
          </SettingsGroup>

          {profile.demoMode ? (
            <SettingsGroup title="Demo mode" note="You're looking at a sample week. Nothing here is yours yet.">
              <SettingsRow label="Leave demo and start fresh" sub="Clears the sample data and opens setup" onPress={() => void leaveDemo()} />
            </SettingsGroup>
          ) : null}

          <SettingsGroup title="About" note="Estimates are approximate. This app isn't medical advice.">
            <SettingsRow label="Kira Makan" sub="A calorie budget that speaks Malaysian food" />
            <SettingsRow label="How estimates work" sub="Best guesses with a likely range, from the starter catalogue and your own corrections" />
          </SettingsGroup>

          <div className={styles.dangerZone}>
            <SettingsGroup>
              <SettingsRow label="Delete everything" sub={deleteSub} destructive onPress={() => setConfirmDelete(true)} />
            </SettingsGroup>
          </div>
        </div>
      ) : null}

      <BottomSheet open={sheet !== null && profile !== undefined} onClose={() => setSheet(null)}>
        {sheet && profile ? (
          <>
            <SheetTitle>{SHEET_TITLE[sheet]}</SheetTitle>
            {sheet === 'profile' ? (
              <ProfileSheet profile={profile} onCancel={() => setSheet(null)} onSave={(patch) => void saveFromSheet(patch, 'Profile saved')} />
            ) : null}
            {sheet === 'minimum' ? (
              <MinimumSheet
                initial={profile.dailyMinimumKcal}
                onSave={(kcal) => void saveFromSheet({ dailyMinimumKcal: kcal }, `Daily minimum ${fmtKcal(kcal)}`)}
              />
            ) : null}
            {sheet === 'rollover' ? (
              <RolloverSheet
                initial={profile.rolloverHour}
                onSave={(hour) => void saveFromSheet({ rolloverHour: hour }, `Day rolls over at ${hourLabel(hour)}`)}
              />
            ) : null}
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet open={signInOpen && authConfigured} onClose={() => setSignInOpen(false)}>
        <SheetTitle>Sign in</SheetTitle>
        <SignInPanel
          signIn={signIn}
          onSignedIn={() => {
            setSignInOpen(false);
            showToast('Signed in');
            // The session change runs a cycle too; this one also runs while sync waits on a refused session.
            void syncNow();
          }}
        />
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete everything?"
        body={deleteBody}
        confirmLabel="Delete everything"
        destructive
        requireTyping="DELETE"
        onConfirm={() => void deleteEverything()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
