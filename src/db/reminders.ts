/**
 * Reminders (S38, S40, decision §10.19): the synced preferences, S38's read model and the target
 * suggestion's push mark.
 *
 * Everything lives in existing synced rows, so no table or protocol changes: the preferences are
 * `profile.reminders` (every field optional, a missing one is its default), a target suggestion
 * waiting for its push is the insightFeedback row 'targetNotice', and the one some device has seen is
 * the row 'targetNoticeSeen'. The server reads them from the account's copy; which device has
 * notifications on lives in Supabase and on the device (src/push). Reading never writes.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { getInsightFeedback, getProfile, listDayRecordsInRange, listMealsInRange, putInsightFeedback, updateProfile } from '@/db/repo';
import { now } from '@/domain/clock';
import { addDays } from '@/domain/day';
import {
  GAP_NUDGE_UNLOCK_DAYS,
  HISTORY_DAYS,
  gapNudgesUnlocked,
  isCheckInSetting,
  isQuietSetting,
  quietWindowFor,
  resolveReminderPrefs,
  type QuietWindow,
  type ResolvedReminderPrefs,
} from '@/domain/reminders';
import type { InsightFeedback, Instant, LogicalDay, ReminderSettings } from '@/domain/types';

/** The insightFeedback row that marks a target suggestion for its push. */
export const TARGET_NOTICE_ID = 'targetNotice';
/** The insightFeedback row naming the suggestion some device has seen: its push is never sent. */
export const TARGET_NOTICE_SEEN_ID = 'targetNoticeSeen';

/** What S38 changes: any field; `quiet: null` goes back to the sleep taps. */
export type ReminderSettingsPatch = Partial<Omit<ReminderSettings, 'quiet'>> & { quiet?: ReminderSettings['quiet'] | null };

const FLAGS = ['checkIn', 'gapNudges', 'weeklyReview', 'targetSuggestion'] as const;

function assertPatch(patch: ReminderSettingsPatch): void {
  for (const flag of FLAGS) {
    const value = patch[flag];
    if (value !== undefined && typeof value !== 'boolean') throw new RangeError(`Reminders: ${flag} must be on or off`);
  }
  if (patch.checkInAtMin !== undefined && !isCheckInSetting(patch.checkInAtMin)) {
    throw new RangeError('Reminders: the check-in time must be a quarter hour from 6am to 12pm');
  }
  if (patch.quiet !== undefined && patch.quiet !== null && !isQuietSetting(patch.quiet)) {
    throw new RangeError('Reminders: quiet hours must be quarter hours that start and end at different times');
  }
}

/** Merges into profile.reminders in one transaction (read, merge, write). Returns what is stored now. */
export async function updateReminderSettingsIn(db: KiraMakanDb, patch: ReminderSettingsPatch): Promise<ReminderSettings> {
  assertPatch(patch);
  return db.transaction('rw', db.profile, async () => {
    const profile = await getProfile(db);
    if (!profile) throw new Error('Reminders: no profile yet');
    const next: ReminderSettings = { ...profile.reminders };
    for (const flag of FLAGS) {
      const value = patch[flag];
      if (value !== undefined) next[flag] = value;
    }
    if (patch.checkInAtMin !== undefined) next.checkInAtMin = patch.checkInAtMin;
    if (patch.quiet === null) delete next.quiet;
    else if (patch.quiet !== undefined) next.quiet = { fromMin: patch.quiet.fromMin, untilMin: patch.quiet.untilMin };
    await updateProfile(db, { reminders: next });
    return next;
  });
}

export const updateReminderSettings = (patch: ReminderSettingsPatch): Promise<ReminderSettings> => updateReminderSettingsIn(appDb, patch);

// ---------------------------------------------------------------------------
// S38's read model
// ---------------------------------------------------------------------------

export interface ReminderView {
  prefs: ResolvedReminderPrefs;
  /** The window used now (custom or auto). */
  quiet: QuietWindow;
  /** What auto would be (for the sheet's "Right now …"), even when custom is on. */
  autoQuiet: QuietWindow;
  gap: { unlocked: boolean; have: number; need: number };
  demo: boolean;
  tz: string;
  rolloverHour: number;
}

/** The preferences with their defaults, the quiet window and the gap nudges' progress. Undefined without a profile. */
export async function getReminderViewIn(db: KiraMakanDb, today: LogicalDay): Promise<ReminderView | undefined> {
  const profile = await getProfile(db);
  if (!profile) return undefined;
  const from = addDays(today, -HISTORY_DAYS);
  const to = addDays(today, -1);
  const [records, meals, complete] = await Promise.all([
    listDayRecordsInRange(db, from, to),
    listMealsInRange(db, from, to),
    db.days.where('status').equals('complete').primaryKeys(),
  ]);
  const days = records.map((r) => ({ day: r.logicalDay, status: r.status, ...(r.sleepAt ? { sleepAt: r.sleepAt } : {}) }));
  const mealRows = meals.map((m) => ({ day: m.logicalDay, at: m.eatenAt, slot: m.slot, guess: m.isGuess === true }));
  const have = complete.filter((day) => day >= profile.startedOn && day < today).length;

  const prefs = resolveReminderPrefs(profile.reminders);
  const context = { days, meals: mealRows, today, tz: profile.timeZone, rolloverHour: profile.rolloverHour };
  return {
    prefs,
    quiet: quietWindowFor({ prefs, ...context }),
    autoQuiet: quietWindowFor({ prefs: { quiet: null }, ...context }),
    gap: { unlocked: gapNudgesUnlocked(have), have, need: GAP_NUDGE_UNLOCK_DAYS },
    demo: profile.demoMode === true,
    tz: profile.timeZone,
    rolloverHour: profile.rolloverHour,
  };
}

/** S38: re-read when the data changes or the (demo-aware) day rolls over. */
export function useReminderView(): ReminderView | undefined {
  const today = useToday();
  return useLiveQuery(() => getReminderViewIn(appDb, today), [today]);
}

// ---------------------------------------------------------------------------
// The target suggestion's push mark (synced; the in-app notice's "seen" stays per device)
//
// "Seen" lives in its own row as well as on the mark. Sync settles a row by the later edit (§6.2), and a
// device that opens Today before its first pull marks the suggestion on its stale copy, overwriting a
// mark another device had already seen. Only seeing writes 'targetNoticeSeen', so that never undoes it.
// ---------------------------------------------------------------------------

/**
 * Marks a showing suggestion for its push, once per key. False (nothing written) in demo mode, when
 * the same key is already marked (so the mark's time stays the first one) or already seen.
 */
export async function markTargetPendingIn(
  db: KiraMakanDb,
  mark: { key: string; weekStart: LogicalDay; weeks: number },
  at: Instant = now().toISOString(),
): Promise<boolean> {
  return db.transaction('rw', [db.profile, db.insightFeedback], async () => {
    const profile = await getProfile(db);
    if (!profile || profile.demoMode === true) return false;
    const seen = await getInsightFeedback(db, TARGET_NOTICE_SEEN_ID);
    if (seen?.targetNoticeSeen?.key === mark.key) return false;
    const existing = await getInsightFeedback(db, TARGET_NOTICE_ID);
    if (existing?.targetNotice?.key === mark.key) return false;
    const row: InsightFeedback = {
      ruleId: TARGET_NOTICE_ID,
      feedback: 'notice',
      at,
      targetNotice: { key: mark.key, weekStart: mark.weekStart, weeks: mark.weeks, markedAt: at },
    };
    await putInsightFeedback(db, row);
    return true;
  });
}

/**
 * This device has seen the notice for `key`, so its push is never sent: the seen row names it (even
 * before any mark, which then never gets written) and a mark for it gets its seenAt. Idempotent; true
 * when this call wrote anything.
 */
export async function markTargetSeenIn(db: KiraMakanDb, key: string, at: Instant = now().toISOString()): Promise<boolean> {
  // Seen already (S37 re-renders, every decision): a plain read, so no write lock holds up the screens.
  const [seenBefore, markBefore] = await db.insightFeedback.bulkGet([TARGET_NOTICE_SEEN_ID, TARGET_NOTICE_ID]);
  const markWaits = markBefore?.targetNotice?.key === key && markBefore.targetNotice.seenAt === undefined;
  if (seenBefore?.targetNoticeSeen?.key === key && !markWaits) return false;
  return db.transaction('rw', [db.profile, db.insightFeedback], async () => {
    const profile = await getProfile(db);
    if (!profile || profile.demoMode === true) return false;
    let wrote = false;
    const seen = await getInsightFeedback(db, TARGET_NOTICE_SEEN_ID);
    if (seen?.targetNoticeSeen?.key !== key) {
      await putInsightFeedback(db, { ruleId: TARGET_NOTICE_SEEN_ID, feedback: 'notice', at, targetNoticeSeen: { key, seenAt: at } });
      wrote = true;
    }
    const row = await getInsightFeedback(db, TARGET_NOTICE_ID);
    const mark = row?.targetNotice;
    if (row && mark && mark.key === key && mark.seenAt === undefined) {
      await putInsightFeedback(db, { ...row, targetNotice: { ...mark, seenAt: at } });
      wrote = true;
    }
    return wrote;
  });
}

export const markTargetPending = (mark: { key: string; weekStart: LogicalDay; weeks: number }): Promise<boolean> =>
  markTargetPendingIn(appDb, mark);
export const markTargetSeen = (key: string): Promise<boolean> => markTargetSeenIn(appDb, key);
