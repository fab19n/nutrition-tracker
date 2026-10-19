import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { resetAll, setDemoMode } from '@/db/actions';
import { useProfile, useWeightTrend } from '@/db/hooks';
import {
  DAILY_MINIMUM_STEP,
  PROFILE_LIMITS,
  ROLLOVER_HOURS,
  clearLastExport,
  readLastExport,
  updateProfileSettings,
  type ProfileSettingsPatch,
} from '@/db/settings';
import { fmtClock, fmtDayShort, fmtInt, fmtKcal, fmtKg } from '@/domain/format';
import { logicalDayOf } from '@/domain/day';
import type { Profile, Sex, ThemePreference } from '@/domain/types';
import { SEX_OPTIONS } from '@/screens/Setup/AboutStep';
import { fieldError, parseNumber } from '@/screens/Setup/fields';
import { NumberField } from '@/screens/Setup/NumberField';
import { Stepper } from '@/screens/Setup/Stepper';
import { resetUiState, useUiStore } from '@/state/ui';
import setupStyles from '@/screens/Setup/Setup.module.css';
import styles from './SettingsScreen.module.css';

type SheetKind = 'profile' | 'minimum' | 'rollover';

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const SEX_LABEL: Record<Sex, string> = { male: 'Male', female: 'Female' };

const TARGET_NOTE = 'Your target changes through a suggestion you approve.';

function hourLabel(hour: number): string {
  return fmtClock(hour * 60, { compact: true });
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

const SHEET_TITLE: Record<SheetKind, string> = {
  profile: 'Profile and body',
  minimum: 'Daily minimum',
  rollover: 'Day rollover',
};

/** S19 Settings: profile, budget, day, appearance, privacy, data, demo, about and Delete everything. */
export default function SettingsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const weight = useWeightTrend();
  const showToast = useUiStore((s) => s.showToast);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastExport] = useState(readLastExport);

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

  const leaveDemo = async () => {
    await setDemoMode(false);
    resetUiState();
    navigate(PATHS.setup, { replace: true });
  };

  const deleteEverything = async () => {
    setConfirmDelete(false);
    await resetAll();
    resetUiState();
    clearLastExport();
    navigate(PATHS.setup, { replace: true });
    showToast('Everything on this phone is deleted');
  };

  const latestKg = weight?.entries[0]?.kg;
  const exportSub = lastExport
    ? `Last export ${fmtDayShort(logicalDayOf(lastExport.at, profile?.timeZone, 0))}`
    : 'Full backup or spreadsheet files';

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title="Settings" onBack={back} />

      {profile ? (
        <div className={styles.settingsBody}>
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
            <SettingsRow
              label="Keep photos"
              sub={profile.keepPhotos ? 'Kept as a visual diary' : 'Photos clear after estimating'}
              toggle={{ checked: profile.keepPhotos, onChange: (keepPhotos) => void save({ keepPhotos }) }}
            />
          </SettingsGroup>

          <SettingsGroup title="Reminders and data">
            <SettingsRow label="Reminders" sub="Weigh-in and meal nudges" onPress={() => navigate(PATHS.soon('reminders'))} />
            <SettingsRow label="Backups" sub="A weekly copy to Google Drive" onPress={() => navigate(PATHS.soon('backups'))} />
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
              <SettingsRow label="Delete everything" sub="Removes all data on this phone" destructive onPress={() => setConfirmDelete(true)} />
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

      <ConfirmDialog
        open={confirmDelete}
        title="Delete everything?"
        body="Every meal, weigh-in, Place and goal on this phone goes, and it can't be undone. Export a backup first if you want a copy."
        confirmLabel="Delete everything"
        destructive
        requireTyping="DELETE"
        onConfirm={() => void deleteEverything()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
