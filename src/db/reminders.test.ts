// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { getInsightFeedback } from '@/db/repo';
import { buildDemoWorld, DEMO_EXPECTED, loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { addDays, instantAt } from '@/domain/day';
import { decideReminder, type ReminderInput } from '@/domain/reminders';
import type { DayRecord, MealLog, Profile } from '@/domain/types';
import {
  TARGET_NOTICE_ID,
  TARGET_NOTICE_SEEN_ID,
  getReminderViewIn,
  markTargetPendingIn,
  markTargetSeenIn,
  updateReminderSettingsIn,
} from './reminders';

const TODAY = '2026-10-22';
const opened: KiraMakanDb[] = [];

function open(opts?: Parameters<typeof createDb>[1]): KiraMakanDb {
  const db = createDb(`reminders-${crypto.randomUUID()}`, opts);
  opened.push(db);
  return db;
}

function profile(patch: Partial<Profile> = {}): Profile {
  const { demoMode: _demo, ...base } = buildDemoWorld().profile;
  return { ...base, startedOn: '2026-09-01', ...patch };
}

function mealAt(day: string, hour: number, minute = 0, slot: MealLog['slot'] = 'lunch'): MealLog {
  const demo = buildDemoWorld().meals[0] as MealLog;
  const eatenAt = instantAt(day, hour, minute);
  return { ...demo, id: `${day}-${slot}-${hour}`, logicalDay: day, eatenAt, slot, isGuess: false, createdAt: eatenAt, updatedAt: eatenAt };
}

afterEach(async () => {
  setDemoClock(false);
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

describe('updateReminderSettings', () => {
  it('merges into profile.reminders and keeps the rest of the profile', async () => {
    const db = open();
    await db.profile.put(profile({ reminders: { weeklyReview: false } }));
    expect(await updateReminderSettingsIn(db, { checkIn: false, checkInAtMin: 540 })).toEqual({ weeklyReview: false, checkIn: false, checkInAtMin: 540 });
    await updateReminderSettingsIn(db, { quiet: { fromMin: 1380, untilMin: 480 } });
    const stored = await db.profile.get('me');
    expect(stored?.reminders).toEqual({ weeklyReview: false, checkIn: false, checkInAtMin: 540, quiet: { fromMin: 1380, untilMin: 480 } });
    expect(stored?.age).toBe(30);
    expect(stored?.startedOn).toBe('2026-09-01');
  });

  it('goes back to the sleep taps with quiet: null', async () => {
    const db = open();
    await db.profile.put(profile({ reminders: { quiet: { fromMin: 0, untilMin: 420 }, gapNudges: false } }));
    await updateReminderSettingsIn(db, { quiet: null });
    expect((await db.profile.get('me'))?.reminders).toEqual({ gapNudges: false });
  });

  it('refuses values S38 never offers, and writes nothing', async () => {
    const db = open();
    await db.profile.put(profile());
    const bad = [
      { checkIn: 'yes' as unknown as boolean },
      { checkInAtMin: 430 },
      { checkInAtMin: 300 },
      { checkInAtMin: 735 },
      { quiet: { fromMin: 480, untilMin: 480 } },
      { quiet: { fromMin: 1380, untilMin: 1440 } },
      { quiet: { fromMin: 10, untilMin: 480 } },
    ];
    for (const patch of bad) await expect(updateReminderSettingsIn(db, patch)).rejects.toBeInstanceOf(RangeError);
    expect((await db.profile.get('me'))?.reminders).toBeUndefined();
  });

  it('needs a profile', async () => {
    await expect(updateReminderSettingsIn(open(), { checkIn: false })).rejects.toThrow('Reminders: no profile yet');
  });

  it('is a synced write: the profile is queued for the account', async () => {
    const db = open({ capture: () => true });
    await db.profile.put(profile());
    await db.syncOutbox.clear();
    await updateReminderSettingsIn(db, { targetSuggestion: false });
    expect((await db.syncOutbox.toArray()).map((e) => `${e.table}/${e.key}`)).toEqual(['profile/me']);
  });
});

describe('getReminderViewIn', () => {
  it('starts with the defaults on an empty history', async () => {
    const db = open();
    await db.profile.put(profile({ startedOn: TODAY }));
    expect(await getReminderViewIn(db, TODAY)).toEqual({
      prefs: { checkIn: true, checkInAtMin: 600, gapNudges: true, weeklyReview: true, targetSuggestion: true, quiet: null },
      quiet: { fromMin: 1380, untilMin: 480, source: 'default' },
      autoQuiet: { fromMin: 1380, untilMin: 480, source: 'default' },
      gap: { unlocked: false, have: 0, need: 14 },
      demo: false,
      tz: 'Asia/Kuala_Lumpur',
      rolloverHour: 5,
    });
  });

  it('unlocks gap nudges in the demo world and reads quiet hours from its meals', async () => {
    const db = open();
    await loadDemo(db);
    const view = await getReminderViewIn(db, DEMO_EXPECTED.today.day);
    expect(view?.gap).toEqual({ unlocked: true, have: 17, need: 14 });
    expect(view?.quiet.source).toBe('meals');
    expect(view?.demo).toBe(true);
  });

  it('follows three sleep taps, and keeps showing the auto window under custom hours', async () => {
    const db = open();
    await db.profile.put(profile({ reminders: { quiet: { fromMin: 1320, untilMin: 420 } } }));
    const tapped: DayRecord[] = [0, 1, 2].map((i) => {
      const day = addDays(TODAY, -3 + i);
      return { logicalDay: day, status: 'complete', sleepAt: instantAt(day, 25, 0) };
    });
    await db.days.bulkPut(tapped);
    const view = await getReminderViewIn(db, TODAY);
    expect(view?.quiet).toEqual({ fromMin: 1320, untilMin: 420, source: 'custom' });
    expect(view?.autoQuiet).toEqual({ fromMin: 30, untilMin: 480, source: 'sleepTaps' });
  });

  it('counts complete days from the first day of use to yesterday only', async () => {
    const db = open();
    await db.profile.put(profile({ startedOn: '2026-10-10' }));
    await db.days.bulkPut([
      { logicalDay: '2026-10-09', status: 'complete' },
      { logicalDay: '2026-10-10', status: 'complete' },
      { logicalDay: '2026-10-11', status: 'unconfirmed' },
      { logicalDay: '2026-10-12', status: 'guess' },
      { logicalDay: '2026-10-21', status: 'complete' },
      { logicalDay: TODAY, status: 'complete' },
    ]);
    await db.meals.bulkPut([mealAt('2026-10-21', 13)]);
    expect((await getReminderViewIn(db, TODAY))?.gap).toEqual({ unlocked: false, have: 2, need: 14 });
  });

  it('is undefined without a profile, and writes nothing', async () => {
    const db = open({ capture: () => true });
    expect(await getReminderViewIn(db, TODAY)).toBeUndefined();
    await db.profile.put(profile());
    await db.syncOutbox.clear();
    await getReminderViewIn(db, TODAY);
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

/**
 * What send-reminders would decide from these rows (push_context reads the same two), at noon on
 * Thu 22 Oct: with no meals nothing else can be due, so this is the target suggestion's push.
 */
async function targetPushDue(db: KiraMakanDb): Promise<boolean> {
  const targetNotice = (await getInsightFeedback(db, TARGET_NOTICE_ID))?.targetNotice;
  const targetNoticeSeen = (await getInsightFeedback(db, TARGET_NOTICE_SEEN_ID))?.targetNoticeSeen;
  const input: ReminderInput = {
    profile: { timeZone: 'Asia/Kuala_Lumpur', rolloverHour: 5, startedOn: '2026-09-01' },
    days: [],
    meals: [],
    completeDays: 0,
    periods: [],
    goals: [],
    sent: [],
    ...(targetNotice ? { targetNotice } : {}),
    ...(targetNoticeSeen ? { targetNoticeSeen } : {}),
  };
  return decideReminder(input, Date.parse('2026-10-22T04:00:00.000Z')).due?.kind === 'targetSuggestion';
}

describe('the target suggestion mark', () => {
  const mark = { key: 'version-1:2026-10-19', weekStart: '2026-10-19', weeks: 4 };

  it('is written once per key, keeping the first time', async () => {
    const db = open();
    await db.profile.put(profile());
    expect(await markTargetPendingIn(db, mark, '2026-10-22T01:00:00.000Z')).toBe(true);
    expect(await markTargetPendingIn(db, mark, '2026-10-22T05:00:00.000Z')).toBe(false);
    expect(await getInsightFeedback(db, TARGET_NOTICE_ID)).toEqual({
      ruleId: 'targetNotice',
      feedback: 'notice',
      at: '2026-10-22T01:00:00.000Z',
      targetNotice: { ...mark, markedAt: '2026-10-22T01:00:00.000Z' },
    });
    expect(await targetPushDue(db)).toBe(true);
  });

  it('is replaced by a new suggestion', async () => {
    const db = open();
    await db.profile.put(profile());
    await markTargetPendingIn(db, mark, '2026-10-22T01:00:00.000Z');
    await markTargetSeenIn(db, mark.key, '2026-10-22T02:00:00.000Z');
    const next = { key: 'version-2:2026-10-26', weekStart: '2026-10-26', weeks: 5 };
    expect(await markTargetPendingIn(db, next, '2026-10-26T01:00:00.000Z')).toBe(true);
    expect((await getInsightFeedback(db, TARGET_NOTICE_ID))?.targetNotice).toEqual({ ...next, markedAt: '2026-10-26T01:00:00.000Z' });
  });

  it('is never written in demo mode', async () => {
    const db = open();
    await loadDemo(db);
    expect(await markTargetPendingIn(db, mark)).toBe(false);
    expect(await markTargetSeenIn(db, mark.key)).toBe(false);
    expect(await getInsightFeedback(db, TARGET_NOTICE_ID)).toBeUndefined();
    expect(await getInsightFeedback(db, TARGET_NOTICE_SEEN_ID)).toBeUndefined();
  });

  it('marked, then seen: seen on the mark and in its own row, once', async () => {
    const db = open();
    await db.profile.put(profile());
    await markTargetPendingIn(db, mark, '2026-10-22T01:00:00.000Z');
    expect(await markTargetSeenIn(db, 'version-0:2026-10-12', '2026-10-22T02:00:00.000Z')).toBe(true);
    expect((await getInsightFeedback(db, TARGET_NOTICE_ID))?.targetNotice?.seenAt).toBeUndefined();
    expect(await targetPushDue(db)).toBe(true);

    expect(await markTargetSeenIn(db, mark.key, '2026-10-22T03:00:00.000Z')).toBe(true);
    expect(await markTargetSeenIn(db, mark.key, '2026-10-22T04:00:00.000Z')).toBe(false);
    expect((await getInsightFeedback(db, TARGET_NOTICE_ID))?.targetNotice?.seenAt).toBe('2026-10-22T03:00:00.000Z');
    expect(await getInsightFeedback(db, TARGET_NOTICE_SEEN_ID)).toEqual({
      ruleId: 'targetNoticeSeen',
      feedback: 'notice',
      at: '2026-10-22T03:00:00.000Z',
      targetNoticeSeen: { key: mark.key, seenAt: '2026-10-22T03:00:00.000Z' },
    });
    expect(await targetPushDue(db)).toBe(false);
  });

  it('seen, then marked (S37 opened before Today): never marked, so never pushed', async () => {
    const db = open();
    await db.profile.put(profile());
    expect(await markTargetSeenIn(db, mark.key, '2026-10-22T00:30:00.000Z')).toBe(true);
    expect(await markTargetPendingIn(db, mark, '2026-10-22T01:00:00.000Z')).toBe(false);
    expect(await getInsightFeedback(db, TARGET_NOTICE_ID)).toBeUndefined();
    expect(await targetPushDue(db)).toBe(false);
  });

  it('a mark written over a seen one (another device, before its first pull) still never pushes', async () => {
    const db = open();
    await db.profile.put(profile());
    await markTargetPendingIn(db, mark, '2026-10-22T00:30:00.000Z');
    await markTargetSeenIn(db, mark.key, '2026-10-22T00:40:00.000Z');
    // The later edit wins the mark row: last week's copy, marked again, without seenAt.
    await db.insightFeedback.put({ ruleId: TARGET_NOTICE_ID, feedback: 'notice', at: '2026-10-22T01:00:00.000Z', targetNotice: { ...mark, markedAt: '2026-10-22T01:00:00.000Z' } });
    expect(await targetPushDue(db)).toBe(false);
  });

  it('is a synced write, the seen row included', async () => {
    const db = open({ capture: () => true });
    await db.profile.put(profile());
    await db.syncOutbox.clear();
    await markTargetPendingIn(db, mark, '2026-10-22T01:00:00.000Z');
    await markTargetSeenIn(db, mark.key, '2026-10-22T03:00:00.000Z');
    expect((await db.syncOutbox.toArray()).map((e) => `${e.table}/${e.key}`).sort()).toEqual(['insightFeedback/targetNotice', 'insightFeedback/targetNoticeSeen']);
  });
});
