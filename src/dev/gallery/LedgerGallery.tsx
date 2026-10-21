import { useState, type CSSProperties, type ReactNode } from 'react';
import { FileCheck, FileClock, FileDown, MapPin, Scale, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MealRow } from '@/components/MealRow/MealRow';
import { EmptySlot, MealSectionHeader } from '@/components/EmptySlot/EmptySlot';
import { TimingTag, type TimingTagKind } from '@/components/TimingTag/TimingTag';
import { DayStatusBadge, type DayBadgeStatus } from '@/components/DayStatusBadge/DayStatusBadge';
import { PhotoThumb } from '@/components/PhotoThumb/PhotoThumb';
import { CheckInCard } from '@/components/CheckInCard/CheckInCard';
import { OptionGroup, type OptionItem } from '@/components/OptionRow/OptionRow';
import { WeightEntry } from '@/components/WeightEntry/WeightEntry';
import { SetupStep } from '@/components/SetupStep/SetupStep';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { BackupStatus, type BackupState } from '@/components/BackupStatus/BackupStatus';
import { BackupPreview } from '@/components/BackupPreview/BackupPreview';
import { SyncStatus } from '@/components/SyncStatus/SyncStatus';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { InstallPrompt } from '@/components/InstallPrompt/InstallPrompt';
import { ConfirmDialog, ConfirmDialogPanel } from '@/components/ConfirmDialog/ConfirmDialog';
import { SleepTap } from '@/components/SleepTap/SleepTap';
import type { BackupPreview as BackupFilePreview } from '@/db/export';
import type { CheckInChoice } from '@/db/selectors';
import type { BackupStatus as BackupFileStatus } from '@/domain/backup';
import { DEMO_NOW_ISO } from '@/domain/clock';
import { DEFAULT_TZ } from '@/domain/day';
import { exportCardCopy, previewCard, type ExportCardCopy } from '@/screens/Backups/backupsModel';
import { describeSync, type SyncView } from '@/sync/status';
import { CHECK_IN_CAPTIONS, CheckInTimelineSample } from './checkInSample';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9): Fri 16 Oct, scenario B for the check-in.
// ---------------------------------------------------------------------------

const SAMPLE_PHOTO = '/icons/icon.svg';
const noop = () => {};

/** Ids match the engine's check-in choices, so a screen can hand them straight to confirmDay. */
const CHECKIN_OPTIONS: (OptionItem & { id: CheckInChoice; consequence: string })[] = [
  { id: 'complete', label: "Yes, that's all I ate", consequence: 'Marks yesterday complete. Counts toward maintenance and timing.' },
  {
    id: 'fillTypical',
    label: 'I had dinner. Fill in a typical one (~650)',
    consequence: "Adds ~650 kcal to this week's budget, marked as a guess. Left out of maintenance and timing insights.",
  },
  { id: 'addMore', label: 'I ate more. Let me add it', consequence: 'Opens Log with the time set to last night.' },
  { id: 'notCounted', label: "Don't count this day", consequence: 'Counts as exactly 1,800. Missed meals never count as calories saved.' },
];
const CHECKIN_PROMPT = 'Pick an answer to see what it means for your budget.';
const CHECKIN_EXPLANATION = 'Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm.';

const FOCUS_OPTIONS: OptionItem[] = [
  { id: 'kurang', label: 'Kurang manis for drinks', sub: 'Teh tarik and teh o ais, 11 drinks last week' },
  { id: 'halfRice', label: 'Half rice at nasi kandar', sub: 'Big rice there is about +130 kcal a plate' },
  { id: 'window', label: 'Keep eating days under 12 hours', sub: 'Your window averaged 10.4 h, longer on weekends' },
];

const TIMING_KINDS: TimingTagKind[] = ['onTime', 'lateForYou', 'earlyForYou', 'outsideWindow', 'afterMidnight'];
const DAY_STATUSES: DayBadgeStatus[] = ['complete', 'inProgress', 'unconfirmed', 'makan', 'planned', 'notCounted', 'paused', 'guess'];
const BACKUP_STATES: { state: BackupState; label: string }[] = [
  { state: 'notConnected', label: 'Not connected' },
  { state: 'connected', label: 'Connected' },
  { state: 'inProgress', label: 'In progress' },
  { state: 'failed', label: 'Failed (Retry)' },
];

/** The sync card's copy comes from describeSync, so each state here is the app's own. */
const SYNC_NOW_MS = Date.parse(DEMO_NOW_ISO);
const SYNC_LINKED: SyncView = {
  phase: 'idle',
  pending: 0,
  failed: 0,
  linked: true,
  linkedEmail: 'you@example.com',
  sessionEmail: 'you@example.com',
  lastSyncedAt: SYNC_NOW_MS - 5 * 60_000,
  now: SYNC_NOW_MS,
};
const SYNC_STATES: { label: string; view: Partial<SyncView> }[] = [
  { label: 'Up to date', view: {} },
  { label: 'Changes waiting', view: { pending: 3 } },
  { label: 'Backing up (first upload)', view: { phase: 'uploading', pending: 1500, lastSyncedAt: undefined, progress: { done: 340, total: 1840 } } },
  { label: 'Syncing', view: { phase: 'syncing' } },
  { label: 'Checking your account', view: { phase: 'starting' } },
  { label: 'Signed out', view: { phase: 'signedOut', linked: false, sessionEmail: undefined, lastSyncedAt: undefined } },
  { label: 'Needs sign-in, 2 changes waiting', view: { phase: 'needsSignIn', pending: 2, sessionEmail: undefined } },
  { label: 'Demo mode', view: { phase: 'demo', linked: false, lastSyncedAt: undefined } },
  { label: 'Off on this phone', view: { phase: 'paused', linked: false, lastSyncedAt: undefined } },
  { label: 'Offline, 1 change waiting', view: { phase: 'offline', pending: 1 } },
  { label: 'Offline, nothing waiting', view: { phase: 'offline', lastSyncedAt: SYNC_NOW_MS - 26 * 60 * 60_000 } },
  { label: "Can't reach the account, 1 change refused", view: { phase: 'error', pending: 4, failed: 1, retryAt: SYNC_NOW_MS + 30_000 } },
  { label: 'Not set up on the server', view: { phase: 'notSetUp' } },
  { label: 'Account already has a diary', view: { phase: 'choose', linked: false, lastSyncedAt: undefined } },
  { label: 'Signed in to another account', view: { phase: 'otherAccount', sessionEmail: 'other@example.com' } },
  { label: 'Account copy deleted', view: { phase: 'cloudReset' } },
  { label: "Getting the account's data", view: { phase: 'restoring', linked: false, progress: { done: 600, total: 1840 } } },
];

/** The backup-file card on Backups: its copy comes from exportCardCopy, so each state here is the app's own. */
const FILE_STATES: { label: string; status: BackupFileStatus }[] = [
  { label: 'Saved', status: { kind: 'exported', at: DEMO_NOW_ISO, day: '2026-10-16', days: 0, due: false } },
  { label: 'Due', status: { kind: 'exported', at: '2026-09-01T11:10:00.000Z', day: '2026-09-01', days: 45, due: true } },
  { label: 'None yet', status: { kind: 'never', diaryDays: 10, due: false } },
];
const FILE_ICONS: Record<ExportCardCopy['icon'], typeof FileCheck> = { check: FileCheck, down: FileDown, clock: FileClock };

/** Restore from a backup file › the preview card, written by previewCard from a file's contents. */
const PREVIEW_NOW = new Date('2026-11-19T04:00:00.000Z');
const PREVIEW_COUNTS: BackupFilePreview['counts'] = {
  profile: 1,
  goals: 4,
  goalVersions: 6,
  goalPeriods: 3,
  meals: 1240,
  weights: 62,
  workouts: 3,
  bonuses: 1,
  days: 180,
  weekPlans: 20,
  places: 12,
  usuals: 4,
  pots: 1,
  photos: 0,
  insightFeedback: 2,
  suggestionEvents: 14,
  personalItems: 3,
};
const PREVIEW_FILE: BackupFilePreview = {
  exportedAt: DEMO_NOW_ISO,
  photos: 'omitted',
  counts: PREVIEW_COUNTS,
  mealDays: { from: '2026-03-03', to: '2026-10-16' },
  timeZone: DEFAULT_TZ,
};
const NO_MEALS: BackupFilePreview['counts'] = { ...PREVIEW_COUNTS, meals: 0, weights: 0, workouts: 0, places: 0, usuals: 0, pots: 0, goals: 0, bonuses: 0, days: 0, weekPlans: 0, insightFeedback: 0, suggestionEvents: 0, personalItems: 0 };
const PREVIEW_STATES: { label: string; card: Parameters<typeof previewCard>[0] }[] = [
  { label: 'Full', card: { fileName: 'kira-makan-backup-2026-10-16.json', preview: PREVIEW_FILE, comparison: null, word: 'phone', now: PREVIEW_NOW } },
  { label: 'No meals', card: { fileName: 'kira-makan-backup-2026-10-16.json', preview: { ...PREVIEW_FILE, counts: NO_MEALS }, comparison: null, word: 'phone', now: PREVIEW_NOW } },
  { label: 'Photos included', card: { fileName: 'kira-makan-backup-with-photos.json', preview: { ...PREVIEW_FILE, photos: 'included', counts: { ...PREVIEW_COUNTS, photos: 212 } }, comparison: null, word: 'phone', now: PREVIEW_NOW } },
  { label: 'Amber note', card: { fileName: 'kira-makan-backup-2026-10-16.json', preview: PREVIEW_FILE, comparison: { meals: 1252, weights: 65, onlyHere: { meals: 12, weights: 3 } }, word: 'phone', now: PREVIEW_NOW } },
  { label: 'Neutral note', card: { fileName: 'kira-makan-backup-2026-10-16.json', preview: PREVIEW_FILE, comparison: { meals: 1240, weights: 62, onlyHere: { meals: 0, weights: 0 } }, word: 'device', now: PREVIEW_NOW } },
  { label: 'Date unknown', card: { fileName: 'a-very-long-file-name-that-keeps-going-and-going-until-it-no-longer-fits-in-the-card.json', preview: { ...PREVIEW_FILE, exportedAt: null }, comparison: null, word: 'phone', now: PREVIEW_NOW } },
];

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  stateFlush: { padding: '6px 0 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  captionFlush: { display: 'block', padding: '0 20px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } satisfies CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', gap: 8 } satisfies CSSProperties,
  sheet: { background: 'var(--bg)', borderRadius: 'var(--r-sheet) var(--r-sheet) 0 0', padding: '10px 16px 24px', boxShadow: 'inset 0 0 0 1px var(--line)' } satisfies CSSProperties,
  handle: { width: 40, height: 4, borderRadius: 2, background: 'var(--dash)', margin: '0 auto 14px' } satisfies CSSProperties,
  screen: { height: 560, overflowY: 'auto', background: 'var(--bg)', borderRadius: 24, boxShadow: 'inset 0 0 0 1px var(--line)' } satisfies CSSProperties,
  input: { width: '100%', height: 48, border: 0, borderRadius: 12, background: 'var(--card)', padding: '0 14px', fontSize: 16 } satisfies CSSProperties,
  statusLine: { padding: '20px 0 0', textAlign: 'center', fontSize: 14, color: 'var(--muted)' } satisfies CSSProperties,
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 style={css.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}

/** `flush` drops the side padding for components that carry their own screen insets (SettingsGroup). */
function State({ label, flush, children }: { label: string; flush?: boolean; children: ReactNode }) {
  return (
    <div style={flush ? css.stateFlush : css.state}>
      <span style={flush ? css.captionFlush : css.caption}>{label}</span>
      {children}
    </div>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div style={css.sheet}>
      <div style={css.handle} aria-hidden="true" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function MealRowStates() {
  const [log, setLog] = useState('Swipe a row left, or Tab to it and open its actions.');
  const press = (what: string) => () => setLog(what);
  return (
    <Group title="C29 MealRow">
      <State label="C29 MealRow / Today · Late for you">
        <MealRow
          slotLabel="Breakfast"
          timeLabel="10:40am"
          placeName="Nasi kandar near home"
          name="Roti canai + teh tarik"
          kcalLabel="~560"
          tag="lateForYou"
          onPress={press('Opened: Roti canai + teh tarik')}
          onDuplicate={press('Duplicated: Roti canai + teh tarik')}
          onDelete={press('Deleted: Roti canai + teh tarik · Undo')}
        />
      </State>
      <State label="C29 MealRow / Diary · On time with RM">
        <MealRow
          slotLabel="Lunch"
          timeLabel="2:15pm"
          placeName="Kedai near home"
          priceLabel="RM 9.50"
          name="Economy rice"
          kcalLabel="~670"
          tag="onTime"
          onPress={press('Opened: Economy rice')}
          onDuplicate={press('Duplicated: Economy rice')}
          onDelete={press('Deleted: Economy rice · Undo')}
        />
      </State>
      <State label="C29 MealRow / Photo · Half finished">
        <MealRow
          slotLabel="Dinner"
          timeLabel="7:40pm"
          placeName="Medan selera nearby"
          priceLabel="RM 12.00"
          name="Ayam bakar, half rice, ulam"
          kcalLabel="~540"
          tag="onTime"
          thumbUrl={SAMPLE_PHOTO}
          finished="half"
          onPress={press('Opened: Ayam bakar')}
        />
      </State>
      <State label="C29 MealRow / Guess (check-in fill-in)">
        <MealRow slotLabel="Dinner" timeLabel="9:00pm" name="Typical dinner" kcalLabel="~650" isGuess onPress={press('Opened: guess')} />
      </State>
      <State label="C29 MealRow / Waiting to sync · Outside window">
        <MealRow
          slotLabel="Supper"
          timeLabel="11:05pm"
          placeName="Nasi kandar near home"
          name="Teh o ais kurang"
          kcalLabel="~60"
          tag="outsideWindow"
          pending
          onPress={press('Opened: Teh o ais kurang')}
        />
      </State>
      <State label="C29 MealRow / Early for you">
        <MealRow slotLabel="Breakfast" timeLabel="7:50am" placeName="Home" name="Bread, kaya, kopi" kcalLabel="~380" tag="earlyForYou" onPress={press('Opened: Bread, kaya, kopi')} />
      </State>
      <State label="C29 MealRow / After midnight (counts toward Thursday)">
        <MealRow slotLabel="Supper" timeLabel="12:40am" placeName="Home" name="Milo ais" kcalLabel="~180" tag="afterMidnight" onPress={press('Opened: Milo ais')} />
      </State>
      <State label="C29 MealRow / Event log">
        <p className="t-caption muted" style={{ margin: 0, padding: '0 4px' }} aria-live="polite">
          {log}
        </p>
      </State>
    </Group>
  );
}

function SlotStates() {
  return (
    <Group title="C30 MealSectionHeader / EmptySlot">
      <State label="C30 MealSectionHeader / With subtotal">
        <MealSectionHeader slotLabel="Lunch" subtotalLabel="~670 kcal" />
      </State>
      <State label="C30 EmptySlot / Not logged · Meal ideas">
        <EmptySlot slotLabel="Dinner" onAction={noop} />
      </State>
      <State label="C30 EmptySlot / Past day, no action">
        <EmptySlot slotLabel="Snacks" title="Nothing logged" />
      </State>
    </Group>
  );
}

function TagStates() {
  return (
    <>
      <Group title="C31 TimingTag">
        <State label="C31 TimingTag / On time · Late for you · Early for you · Outside window · After midnight">
          <div style={css.row}>
            {TIMING_KINDS.map((k) => (
              <TimingTag key={k} kind={k} />
            ))}
          </div>
        </State>
      </Group>
      <Group title="C32 DayStatusBadge">
        <State label="C32 DayStatusBadge / sm: Complete · In progress · Unconfirmed · Makan day · Planned · Not counted · Paused · Guess added">
          <div style={css.row}>
            {DAY_STATUSES.map((s) => (
              <DayStatusBadge key={s} status={s} />
            ))}
          </div>
        </State>
        <State label="C32 DayStatusBadge / md (Diary status card)">
          <div style={css.row}>
            <DayStatusBadge status="inProgress" size="md" />
            <DayStatusBadge status="guess" size="md" />
            <DayStatusBadge status="notCounted" size="md" />
          </div>
        </State>
      </Group>
      <Group title="C33 PhotoThumb">
        <State label="C33 PhotoThumb / Placeholder · Photo · Half · Most · Tap to view (96px)">
          <div style={css.row}>
            <PhotoThumb />
            <PhotoThumb url={SAMPLE_PHOTO} alt="Ayam bakar" />
            <PhotoThumb finished="half" />
            <PhotoThumb url={SAMPLE_PHOTO} finished="most" alt="Mee sup ayam" />
            <PhotoThumb url={SAMPLE_PHOTO} size={96} alt="Economy rice" onPress={noop} />
          </div>
        </State>
      </Group>
    </>
  );
}

function CheckInStates() {
  const [selected, setSelected] = useState<string | undefined>();
  const consequenceFor = (id?: string) => CHECKIN_OPTIONS.find((o) => o.id === id)?.consequence ?? CHECKIN_PROMPT;
  const card = (id: string | undefined, onSelect: (v: string) => void) => (
    <Sheet>
      <CheckInCard
        title="Yesterday · 2 meals · 1,240 kcal"
        timeline={<CheckInTimelineSample />}
        captions={CHECK_IN_CAPTIONS}
        explanation={CHECKIN_EXPLANATION}
        options={CHECKIN_OPTIONS}
        selectedId={id}
        onSelect={onSelect}
        consequence={consequenceFor(id)}
        onDone={noop}
      />
    </Sheet>
  );
  return (
    <Group title="C49 CheckInCard">
      <State label="C49 CheckInCard / Nothing picked (interactive)">{card(selected, setSelected)}</State>
      {CHECKIN_OPTIONS.map((o) => (
        <State key={o.id} label={`C49 CheckInCard / ${o.label}`}>
          {card(o.id, noop)}
        </State>
      ))}
      <State label="C49 CheckInCard / Light (day looks complete)">
        <Sheet>
          <CheckInCard variant="light" title="Yesterday: 3 meals, 1,760 kcal. All there?" onDone={noop} onAddMore={noop} />
        </Sheet>
      </State>
    </Group>
  );
}

function OptionRowStates() {
  const [focus, setFocus] = useState<string | undefined>();
  return (
    <Group title="OptionRow / OptionGroup">
      <State label="OptionGroup lg / Weekly review step 3 (interactive, arrow keys)">
        <OptionGroup label="Pick one thing to try next week" size="lg" options={FOCUS_OPTIONS} value={focus} onChange={setFocus} />
      </State>
      <State label="OptionGroup md / Selected">
        <OptionGroup label="Was that everything?" options={CHECKIN_OPTIONS.slice(0, 2)} value="complete" onChange={noop} />
      </State>
    </Group>
  );
}

function WeightStates() {
  const [value, setValue] = useState('77.8');
  const [saved, setSaved] = useState(false);
  return (
    <Group title="C50 WeightEntry">
      <State label="C50 WeightEntry / Pre-filled 77.8 (interactive)">
        <WeightEntry
          value={value}
          saved={saved}
          savedLabel="Saved · trend 77.9 kg"
          onChange={(v) => {
            setValue(v);
            setSaved(false);
          }}
          onSave={() => setSaved(true)}
        />
      </State>
      <State label="C50 WeightEntry / Saved">
        <WeightEntry value="77.8" saved savedLabel="Saved · trend 77.9 kg" onChange={noop} onSave={noop} />
      </State>
      <State label="C50 WeightEntry / Empty (Save disabled)">
        <WeightEntry value="" onChange={noop} onSave={noop} />
      </State>
    </Group>
  );
}

function SetupStates() {
  const [pace, setPace] = useState<string | undefined>('0.5');
  return (
    <Group title="C53 SetupStep">
      <State label="C53 SetupStep / S02 step 1 of 6, no Back">
        <div style={css.screen}>
          <SetupStep step={1} total={6} title="About you" helper="Height can be an estimate. 5 cm off is about 30 kcal a day." onNext={noop}>
            <div style={css.stack}>
              <input style={css.input} aria-label="Age" defaultValue="30" inputMode="numeric" />
              <input style={css.input} aria-label="Height in cm" defaultValue="172" inputMode="numeric" />
              <input style={css.input} aria-label="Today's weight in kg" defaultValue="78.6" inputMode="decimal" />
            </div>
          </SetupStep>
        </div>
      </State>
      <State label="C53 SetupStep / S04 step 3 of 6 with Back (OptionGroup content)">
        <div style={css.screen}>
          <SetupStep
            step={3}
            total={6}
            title="Goal and pace"
            helper="Starting maintenance ~2,350 → daily target 1,800 kcal"
            onNext={noop}
            onBack={noop}
          >
            <OptionGroup
              label="Pace"
              size="lg"
              value={pace}
              onChange={setPace}
              options={[
                { id: '0.25', label: '0.25 kg a week', sub: 'Target ~2,080' },
                { id: '0.5', label: '0.5 kg a week', sub: 'Target 1,800' },
                { id: '0.75', label: '0.75 kg a week', sub: 'Target 1,530' },
              ]}
            />
          </SetupStep>
        </div>
      </State>
      <State label="C53 SetupStep / S05 with Skip, Next disabled">
        <div style={css.screen}>
          <SetupStep
            step={4}
            total={6}
            title="Your regulars"
            helper="Tap common meals to make them Usuals, so ideas work from day 1."
            nextLabel="Next"
            nextDisabled
            onNext={noop}
            onBack={noop}
            onSkip={noop}
          >
            <EmptyState surface="plain" headline="Nothing picked yet" body="Roti canai + teh tarik, nasi lemak bungkus, bread kaya kopi…" />
          </SetupStep>
        </div>
      </State>
    </Group>
  );
}

function SettingsStates() {
  const [location, setLocation] = useState(true);
  const [keepPhotos, setKeepPhotos] = useState(false);
  return (
    <Group title="C54 SettingsRow / SettingsGroup">
      <State flush label="C54 SettingsGroup / Chevron rows with value and sub-line">
        <SettingsGroup title="Budget and day">
          <SettingsRow label="Daily minimum" sub="No day's allowance goes below this" value="1,400 kcal" onPress={noop} />
          <SettingsRow label="Week starts" value="Monday" onPress={noop} />
          <SettingsRow label="Day rollover" sub="A 2am supper counts as the night before" value="5am" onPress={noop} />
        </SettingsGroup>
      </State>
      <State flush label="C54 SettingsRow / Toggle on · off · disabled">
        <SettingsGroup title="Privacy">
          <SettingsRow label="Location" sub="Only saved when you create a Place" toggle={{ checked: location, onChange: setLocation }} />
          <SettingsRow label="Keep photos" sub="Off: photos clear after estimating" toggle={{ checked: keepPhotos, onChange: setKeepPhotos }} />
          <SettingsRow label="Gap nudges" sub="Switches on once the app knows your pattern" toggle={{ checked: false, onChange: noop, disabled: true }} />
        </SettingsGroup>
      </State>
      <State flush label="C54 SettingsRow / Static value · Destructive">
        <SettingsGroup title="About" note="Estimates are approximate. This app isn't medical advice.">
          <SettingsRow label="Version" value="0.1.0" />
          <SettingsRow label="Delete everything" sub="Removes all data on this phone" destructive onPress={noop} />
        </SettingsGroup>
      </State>
    </Group>
  );
}

function BackupStates() {
  return (
    <Group title="C55 BackupStatus">
      {BACKUP_STATES.map(({ state, label }) => (
        <State key={state} label={`C55 BackupStatus / ${label}`}>
          <BackupStatus
            state={state}
            lastBackupLabel="Sun 9:00pm"
            keepLabel="Last 12"
            onConnect={noop}
            onBackupNow={noop}
            onDisconnect={noop}
            onRetry={noop}
          />
        </State>
      ))}
    </Group>
  );
}

function FileBackupStates() {
  return (
    <Group title="Backups: the backup-file card and the preview (S39)">
      {FILE_STATES.map(({ label, status }) => {
        const copy = exportCardCopy(status, { tz: DEFAULT_TZ, linked: false });
        return (
          <State key={label} label={`SyncStatus / File backup (${label})`}>
            <SyncStatus
              tone={copy.tone}
              pill={copy.pill}
              title={copy.title}
              detail={copy.detail}
              icon={FILE_ICONS[copy.icon]}
              actions={[{ id: 'export', label: 'Export now', variant: copy.action, onPress: noop }]}
            />
          </State>
        );
      })}
      {PREVIEW_STATES.map(({ label, card }) => (
        <State key={label} label={`BackupPreview / ${label}`}>
          <BackupPreview {...previewCard(card)} />
        </State>
      ))}
    </Group>
  );
}

function SyncStates() {
  return (
    <Group title="SyncStatus (Settings › Account and sync)">
      {SYNC_STATES.map(({ label, view }) => {
        const copy = describeSync({ ...SYNC_LINKED, ...view }, SYNC_NOW_MS, DEFAULT_TZ);
        return (
          <State key={label} label={`SyncStatus / ${label}`}>
            <SyncStatus {...copy} actions={copy.actions.map((action) => ({ ...action, onPress: noop }))} />
          </State>
        );
      })}
    </Group>
  );
}

function EmptyAndLoadingStates() {
  return (
    <>
      <Group title="C56 EmptyState">
        <State label="C56 EmptyState / Empty Today (card, action)">
          <EmptyState
            icon={<Utensils />}
            headline="Log your first meal"
            body="A rough guess is fine. Type it like a message."
            actionLabel="Log a meal"
            onAction={noop}
          />
        </State>
        <State label="C56 EmptyState / Empty Places (card, no action)">
          <EmptyState icon={<MapPin />} headline="Places appear as you log" body="Type a name in 'Where?' next time you eat out." />
        </State>
        <State label="C56 EmptyState / First weigh-in (plain)">
          <EmptyState surface="plain" icon={<Scale />} headline="Your trend appears after a few weigh-ins" body="One reading a morning is plenty." />
        </State>
      </Group>
      <Group title="C57 SkeletonLoader">
        <State label="C57 SkeletonList / 4 rows, 150ms stagger (S10 Estimating)">
          <SkeletonList count={4} label="Estimating your meal" />
          <div style={css.statusLine}>Estimating… matching to your library and MyFCD</div>
        </State>
      </Group>
    </>
  );
}

function PrimerAndInstallStates() {
  return (
    <>
      <Group title="C58 PermissionPrimer">
        <State label="C58 PermissionPrimer / Location">
          <PermissionPrimer
            kind="location"
            title="Remember where you eat?"
            body="A Place's location is saved once, when you create it there, so Log can suggest your usual order. No location history is kept."
            allowLabel="Allow location"
            onAllow={noop}
            onNotNow={noop}
          />
        </State>
        <State label="C58 PermissionPrimer / Notifications">
          <PermissionPrimer
            kind="notifications"
            title="A quick check each morning?"
            body="One question about yesterday, so missed meals never count as savings. Quiet hours follow your sleep taps."
            allowLabel="Turn on reminders"
            onAllow={noop}
            onNotNow={noop}
          />
        </State>
        <State label="C58 PermissionPrimer / Camera">
          <PermissionPrimer
            kind="camera"
            title="Snap your plate?"
            body="A photo plus a few words, like kuah banjir, gives the best guess. Photos stay on this phone."
            allowLabel="Allow camera"
            onAllow={noop}
            onNotNow={noop}
          />
        </State>
        <State label="C58 PermissionPrimer / Google Drive">
          <PermissionPrimer
            kind="drive"
            title="Back up to Google Drive"
            body="Saves a weekly copy to a folder in your Google Drive. The app can only see files it creates."
            allowLabel="Connect Google Drive"
            onAllow={noop}
            onNotNow={noop}
          />
        </State>
      </Group>
      <Group title="C59 InstallPrompt">
        <State label="C59 InstallPrompt / iOS Safari">
          <InstallPrompt platform="ios" onDismiss={noop} />
        </State>
        <State label="C59 InstallPrompt / Android Chrome">
          <InstallPrompt platform="android" onInstall={noop} onDismiss={noop} />
        </State>
      </Group>
    </>
  );
}

function ConfirmStates() {
  const [open, setOpen] = useState<'entry' | 'everything' | null>(null);
  const close = () => setOpen(null);
  return (
    <Group title="C60 ConfirmDialog">
      <State label="C60 ConfirmDialog / Delete entry (destructive)">
        <ConfirmDialogPanel
          title="Delete this entry?"
          body="Roti canai + teh tarik, ~560 kcal, comes off Friday's total."
          confirmLabel="Delete"
          destructive
          onConfirm={noop}
          onCancel={noop}
        />
      </State>
      <State label="C60 ConfirmDialog / Delete everything · nothing typed">
        <ConfirmDialogPanel
          title="Delete everything?"
          body="Removes every meal, weight, Place and photo on this phone. Export first if you want a copy."
          confirmLabel="Delete everything"
          destructive
          requireTyping="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      </State>
      <State label="C60 ConfirmDialog / Delete everything · DELETE typed">
        <ConfirmDialogPanel
          title="Delete everything?"
          body="Removes every meal, weight, Place and photo on this phone. Export first if you want a copy."
          confirmLabel="Delete everything"
          destructive
          requireTyping="DELETE"
          defaultTyped="DELETE"
          onConfirm={noop}
          onCancel={noop}
        />
      </State>
      <State label="C60 ConfirmDialog / Not destructive">
        <ConfirmDialogPanel
          title="Switch off demo mode?"
          body="Sample meals stay until you clear them in Settings. The clock goes back to now."
          confirmLabel="Switch off"
          onConfirm={noop}
          onCancel={noop}
        />
      </State>
      <State label="C60 ConfirmDialog / Modal with focus trap">
        <div style={css.row}>
          <Button size="pill" variant="secondary" onClick={() => setOpen('entry')}>
            Open delete entry
          </Button>
          <Button size="pill" variant="secondary" onClick={() => setOpen('everything')}>
            Open delete everything
          </Button>
        </div>
        <ConfirmDialog
          open={open === 'entry'}
          title="Delete this entry?"
          body="Roti canai + teh tarik, ~560 kcal, comes off Friday's total."
          confirmLabel="Delete"
          destructive
          onConfirm={close}
          onCancel={close}
        />
        <ConfirmDialog
          open={open === 'everything'}
          title="Delete everything?"
          body="Removes every meal, weight, Place and photo on this phone. Export first if you want a copy."
          confirmLabel="Delete everything"
          destructive
          requireTyping="DELETE"
          onConfirm={close}
          onCancel={close}
        />
      </State>
    </Group>
  );
}

function SleepStates() {
  const [tapped, setTapped] = useState(false);
  return (
    <Group title="C61 SleepTap">
      <State label="C61 SleepTap / Shown">
        <SleepTap state="shown" onTap={noop} onUndo={noop} />
      </State>
      <State label="C61 SleepTap / Tapped">
        <SleepTap state="tapped" timeLabel="1:30am" onTap={noop} onUndo={noop} />
      </State>
      <State label="C61 SleepTap / Interactive">
        <SleepTap state={tapped ? 'tapped' : 'shown'} timeLabel="7:10pm" onTap={() => setTapped(true)} onUndo={() => setTapped(false)} />
      </State>
    </Group>
  );
}

/** /dev section: ledger, status and system components (C29–C33, C49–C50, C53–C61, SyncStatus) in every state. */
export function LedgerGallery() {
  return (
    <section style={css.section} aria-labelledby="ledger-gallery-title">
      <h2 id="ledger-gallery-title" style={css.sectionTitle}>
        Ledger, status and system
      </h2>
      <MealRowStates />
      <SlotStates />
      <TagStates />
      <CheckInStates />
      <OptionRowStates />
      <WeightStates />
      <SetupStates />
      <SettingsStates />
      <BackupStates />
      <FileBackupStates />
      <SyncStates />
      <EmptyAndLoadingStates />
      <PrimerAndInstallStates />
      <ConfirmStates />
      <SleepStates />
    </section>
  );
}
