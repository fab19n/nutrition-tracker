/**
 * Settings, setup extras and the More menu's read model (S01–S07, S19, S20, S48).
 *
 * Profile changes go through `updateProfileSettings`, which only touches the profile: the
 * daily target lives in goal versions and changes through a suggestion the user approves.
 * `addRegulars` turns the setup's regulars (S05) into Usuals, including combos such as
 * "Roti canai + teh tarik" that `completeSetup` (one catalogue id per Usual) can't express.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { createActions, type SetupInput, type SetupResult } from '@/db/actions';
import { getProfile, listActivePots, listGoals, listPlaces, listUsuals, listWorkouts, putUsual, updateProfile } from '@/db/repo';
import { byId, normaliseName } from '@/data/catalogue';
import { now } from '@/domain/clock';
import { itemFromCatalogue } from '@/domain/meal';
import type { AiEstimateMode, Goal, Instant, LogicalDay, MealItem, MealSlot, Place, Pot, Profile, Usual, Workout } from '@/domain/types';

// ---------------------------------------------------------------------------
// Limits shared by setup (S02, S04, S07) and settings (S19)
// ---------------------------------------------------------------------------

export interface NumberLimit {
  min: number;
  max: number;
}

export const PROFILE_LIMITS = {
  age: { min: 16, max: 100 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 300 },
  dailyMinimumKcal: { min: 1000, max: 2500 },
} as const satisfies Record<string, NumberLimit>;

/** Daily minimum steps by this much in the steppers. */
export const DAILY_MINIMUM_STEP = 50;

/** Starting daily minimum by sex (plan §6.1; sample 1,400). */
export function defaultDailyMinimum(sex: Profile['sex'] | null | undefined): number {
  return sex === 'female' ? 1200 : 1400;
}

/** Rollover choices offered in setup and settings. */
export const ROLLOVER_HOURS = [3, 4, 5, 6] as const;

function within(value: number, limit: NumberLimit): boolean {
  return Number.isFinite(value) && value >= limit.min && value <= limit.max;
}

// ---------------------------------------------------------------------------
// Profile writes
// ---------------------------------------------------------------------------

/** What S19 can change. Weight is logged as a weigh-in (S16), never edited here. */
export type ProfileSettingsPatch = Partial<
  Pick<
    Profile,
    'age' | 'sex' | 'heightCm' | 'theme' | 'useLocation' | 'keepPhotos' | 'dailyMinimumKcal' | 'rolloverHour' | 'aiEstimates'
  >
>;

/** AI estimates choices in S19's order: When needed · Always · Off. */
export const AI_ESTIMATE_MODES = ['auto', 'always', 'off'] as const satisfies readonly AiEstimateMode[];

/** The profile's AI estimates mode; a profile from before the setting means 'auto'. */
export function aiEstimateModeOf(profile: Pick<Profile, 'aiEstimates'> | undefined): AiEstimateMode {
  return profile?.aiEstimates ?? 'auto';
}

function isAiEstimateMode(value: unknown): value is AiEstimateMode {
  return (AI_ESTIMATE_MODES as readonly unknown[]).includes(value);
}

function assertPatch(patch: ProfileSettingsPatch): void {
  if (patch.age !== undefined && (!Number.isInteger(patch.age) || !within(patch.age, PROFILE_LIMITS.age))) {
    throw new RangeError('Settings: age is out of range');
  }
  if (patch.heightCm !== undefined && !within(patch.heightCm, PROFILE_LIMITS.heightCm)) {
    throw new RangeError('Settings: height is out of range');
  }
  if (patch.dailyMinimumKcal !== undefined && !within(patch.dailyMinimumKcal, PROFILE_LIMITS.dailyMinimumKcal)) {
    throw new RangeError('Settings: daily minimum is out of range');
  }
  if (patch.rolloverHour !== undefined && (!Number.isInteger(patch.rolloverHour) || patch.rolloverHour < 0 || patch.rolloverHour > 23)) {
    throw new RangeError('Settings: rollover hour must be 0–23');
  }
  if (patch.aiEstimates !== undefined && !isAiEstimateMode(patch.aiEstimates)) {
    throw new RangeError('Settings: AI estimates must be auto, always or off');
  }
}

/** Writes profile settings only (never the goal or its target). Returns the updated profile. */
export async function updateProfileSettings(patch: ProfileSettingsPatch, database: KiraMakanDb = appDb): Promise<Profile> {
  assertPatch(patch);
  const clean: ProfileSettingsPatch = { ...patch };
  if (clean.dailyMinimumKcal !== undefined) clean.dailyMinimumKcal = Math.round(clean.dailyMinimumKcal);
  if (clean.heightCm !== undefined) clean.heightCm = Math.round(clean.heightCm * 10) / 10;
  return database.transaction('rw', database.profile, async () => {
    const updated = await updateProfile(database, clean);
    const profile = updated ? await getProfile(database) : undefined;
    if (!profile) throw new Error('Settings: no profile yet (setup not done)');
    return profile;
  });
}

// ---------------------------------------------------------------------------
// Setup: regulars become Usuals
// ---------------------------------------------------------------------------

export interface RegularFood {
  catalogueId: string;
  /** Variant index; the catalogue default when left out. */
  variant?: number;
}

export interface RegularPick {
  /** Usual name: "Roti canai + teh tarik". */
  name: string;
  foods: RegularFood[];
  slot?: MealSlot;
}

function withOriginal(item: MealItem): MealItem {
  const original: NonNullable<MealItem['original']> = { quantity: item.quantity, unitMacros: { ...item.unitMacros } };
  if (item.selectedVariant !== undefined) original.selectedVariant = item.selectedVariant;
  return { ...item, original };
}

/**
 * Saves each regular as a Usual of plain catalogue lines. Unknown catalogue ids are dropped;
 * a regular whose name matches an existing Usual is skipped, so running it twice adds nothing.
 */
export async function addRegulars(regulars: readonly RegularPick[], database: KiraMakanDb = appDb): Promise<Usual[]> {
  const stamp = now().toISOString();
  return database.transaction('rw', database.usuals, async () => {
    const taken = new Set((await listUsuals(database)).map((u) => normaliseName(u.name)));
    const added: Usual[] = [];
    for (const regular of regulars) {
      const key = normaliseName(regular.name);
      if (!key || taken.has(key)) continue;
      const items = regular.foods.flatMap((food) => {
        const entry = byId(food.catalogueId);
        return entry ? [withOriginal(itemFromCatalogue(entry, food.variant === undefined ? {} : { variant: food.variant }))] : [];
      });
      if (items.length === 0) continue;
      const usual: Usual = { id: newId(), name: regular.name.trim(), items, useCount: 0, createdAt: stamp };
      if (regular.slot) usual.slot = regular.slot;
      await putUsual(database, usual);
      taken.add(key);
      added.push(usual);
    }
    return added;
  });
}

/**
 * Setup's Done (S07): `completeSetup` (profile, Cut goal and version, Places, weigh-in), then
 * the regulars as Usuals.
 */
export async function finishSetup(
  input: Omit<SetupInput, 'regulars'>,
  regulars: readonly RegularPick[],
  database: KiraMakanDb = appDb,
): Promise<SetupResult> {
  const result = await createActions(database).completeSetup({ ...input, regulars: [] });
  await addRegulars(regulars, database);
  return result;
}

// ---------------------------------------------------------------------------
// More menu (S48)
// ---------------------------------------------------------------------------

export interface MoreSummary {
  goals: Goal[];
  placeCount: number;
  /** The Place with the most logged meals, if any meal has a Place. */
  topPlace?: Place;
  usualCount: number;
  /** The pot that clears soonest. */
  pot?: Pot;
  potCount: number;
  lastWorkout?: Workout;
}

export async function getMoreSummary(today: LogicalDay, database: KiraMakanDb = appDb): Promise<MoreSummary> {
  const [goals, places, usuals, pots, workouts, placeKeys] = await Promise.all([
    listGoals(database),
    listPlaces(database),
    listUsuals(database),
    listActivePots(database, today),
    listWorkouts(database),
    database.meals.orderBy('placeId').keys(),
  ]);
  const visits = new Map<string, number>();
  for (const key of placeKeys) {
    if (typeof key === 'string') visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  let topPlace: Place | undefined;
  let best = 0;
  for (const place of places) {
    const count = visits.get(place.id) ?? 0;
    if (count > best) {
      best = count;
      topPlace = place;
    }
  }
  const summary: MoreSummary = { goals, placeCount: places.length, usualCount: usuals.length, potCount: pots.length };
  if (topPlace) summary.topPlace = topPlace;
  const pot = pots[0];
  if (pot) summary.pot = pot;
  const lastWorkout = workouts[0];
  if (lastWorkout) summary.lastWorkout = lastWorkout;
  return summary;
}

export function useMoreSummary(today: LogicalDay): MoreSummary | undefined {
  return useLiveQuery(() => getMoreSummary(today), [today]);
}

// ---------------------------------------------------------------------------
// Last export (S20): a per-device convenience, so it lives in localStorage
// ---------------------------------------------------------------------------

export type ExportKind = 'json' | 'csv';

export interface LastExport {
  at: string;
  kind: ExportKind;
}

const LAST_EXPORT_KEY = 'kira-makan:last-export';
/** The newest full backup (JSON) on this device, as an ISO string: a CSV export never counts. */
const LAST_BACKUP_KEY = 'kira-makan:last-backup';

export function readLastExport(): LastExport | null {
  try {
    const raw = window.localStorage.getItem(LAST_EXPORT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { at, kind } = parsed as Record<string, unknown>;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
    if (kind !== 'json' && kind !== 'csv') return null;
    return { at, kind };
  } catch {
    return null;
  }
}

/** Records an export. A full backup (JSON) also becomes the last backup (see readLastBackupAt). */
export function writeLastExport(value: LastExport): void {
  try {
    window.localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: the date just isn't remembered.
  }
  if (value.kind === 'json') writeLastBackupAt(value.at);
}

/** Forgets both records (Delete everything, leaving demo). */
export function clearLastExport(): void {
  try {
    window.localStorage.removeItem(LAST_EXPORT_KEY);
  } catch {
    // Nothing to clear.
  }
  try {
    window.localStorage.removeItem(LAST_BACKUP_KEY);
  } catch {
    // Nothing to clear.
  }
}

function isInstant(value: unknown): value is Instant {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/**
 * When the newest full backup (JSON) was made here, or the file a restore came from (the monthly
 * nudge, S39). Falls back to the last export when that was a JSON one, for a device that exported
 * before this record existed. Null when there is none.
 */
export function readLastBackupAt(): Instant | null {
  try {
    const raw = window.localStorage.getItem(LAST_BACKUP_KEY);
    if (isInstant(raw)) return raw;
  } catch {
    // Storage blocked: fall back to the export record.
  }
  const last = readLastExport();
  return last?.kind === 'json' ? last.at : null;
}

export function writeLastBackupAt(at: Instant): void {
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, at);
  } catch {
    // Private mode or storage blocked: the date just isn't remembered.
  }
}

/**
 * A restore leaves this device holding exactly the file's state, so the file's export date is a
 * backup date. Keeps the later of that and the one on record; an empty or unreadable date is ignored.
 */
export function noteRestoredBackup(exportedAt: Instant): void {
  if (!isInstant(exportedAt)) return;
  const current = readLastBackupAt();
  if (current !== null && Date.parse(current) >= Date.parse(exportedAt)) return;
  writeLastBackupAt(exportedAt);
}
