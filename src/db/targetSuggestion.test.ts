// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { getInsightFeedback, putGoalPeriod, updateGoalPeriod } from '@/db/repo';
import { loadDemo } from '@/db/seed/demo';
import { getActiveGoal, getWeekBudget } from '@/db/selectors';
import { setDemoClock } from '@/domain/clock';
import type { GoalVersion, InsightFeedback } from '@/domain/types';
import { loadMaintenanceWorld, MAINTENANCE_WORLD as W, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';
import {
  TARGET_FEEDBACK_ID,
  TargetChangedError,
  clearTargetNoticeSeen,
  createTargetActions,
  getTargetCheck,
  getTargetView,
  markTargetNoticeSeen,
  readTargetNoticeSeen,
  type TargetChoice,
} from './targetSuggestion';

let db: KiraMakanDb;
const opened: KiraMakanDb[] = [];
let actions: ReturnType<typeof createTargetActions>;
const today = W.today;
const at = { today };
const suggested: TargetChoice = { versionId: W.ids.setupVersion, option: 'suggested', dailyKcal: 1550 };
const slower: TargetChoice = { versionId: W.ids.setupVersion, option: 'slowerPace', dailyKcal: 1825 };

async function open(opts?: MaintenanceWorldOptions, dbOpts?: Parameters<typeof createDb>[1]): Promise<void> {
  db = createDb(`target-${crypto.randomUUID()}`, dbOpts);
  opened.push(db);
  actions = createTargetActions(db);
  await loadMaintenanceWorld(db, opts);
}

beforeEach(() => {
  clearTargetNoticeSeen();
});

afterEach(async () => {
  setDemoClock(false);
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

describe('getTargetView', () => {
  beforeEach(() => open());

  it('suggests 1,550 from tomorrow, with this week prorated for each option', async () => {
    const view = await getTargetView(db, at);
    expect(view?.check.kind).toBe('suggestion');
    if (view?.check.kind !== 'suggestion') return;
    expect(view.check.estimate).toMatchObject({ maintenanceKcal: 2100, avgEatenKcal: 1822, daysUsed: 28, basis: 'weekly', window: W.window });
    expect(view.check.proposal).toMatchObject({ suggested: { dailyKcal: 1550 }, slowerPace: { paceKgPerWeek: 0.25, dailyKcal: 1825 }, noticeKey: W.expected.noticeKey });
    expect(view.current?.id).toBe(W.ids.setupVersion);
    expect(view.pending).toBeUndefined();
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ state: 'current', paceKgPerWeek: 0.5, version: { id: W.ids.setupVersion } });
    expect(view.week?.suggested?.totalKcal).toBe(12100);
    expect(view.week?.slowerPace?.totalKcal).toBe(5 * 1800 + 2 * 1825);
    expect(view.week?.pending).toBeUndefined();
    expect(view).toMatchObject({ today, tz: 'Asia/Kuala_Lumpur', rolloverHour: 5, dailyMinimumKcal: 1400 });
  });

  it('is undefined without a profile', async () => {
    await db.profile.clear();
    expect(await getTargetView(db, at)).toBeUndefined();
    expect(await getTargetCheck(db, at)).toBeUndefined();
  });

  it('never writes while reading', async () => {
    const versions = await db.goalVersions.count();
    const feedback = await db.insightFeedback.count();
    await getTargetView(db, at);
    await getTargetCheck(db, at);
    await getTargetView(db, { today: '2026-11-01' });
    expect(await db.goalVersions.count()).toBe(versions);
    expect(await db.insightFeedback.count()).toBe(feedback);
  });
});

describe('approveTarget', () => {
  beforeEach(() => open());

  it('adds a version from tomorrow with the new target, its macros and its pace', async () => {
    const setupBefore = await db.goalVersions.get(W.ids.setupVersion);
    const goalBefore = await db.goals.get(W.ids.cut);
    const { version } = await actions.approveTarget(suggested, at);
    expect(version).toMatchObject({
      goalId: W.ids.cut,
      effectiveFrom: W.tomorrow,
      dailyKcal: 1550,
      proteinG: 110,
      carbsG: 165,
      fatG: 50,
      maintenanceKcal: 2100,
      paceKgPerWeek: 0.5,
      reason: 'approvedSuggestion',
    });
    expect(await db.goalVersions.get(version.id)).toEqual(version);
    expect(await db.goalVersions.get(W.ids.setupVersion)).toEqual(setupBefore);
    expect(await db.goals.get(W.ids.cut)).toEqual(goalBefore);
  });

  it('keeps today and earlier days at 1,800 and prorates the week', async () => {
    const before = await getWeekBudget(db, today, at);
    const { version } = await actions.approveTarget(suggested, at);
    const after = await getWeekBudget(db, today, at);
    expect(after?.budget.weeklyBudgetKcal).toBe(12100);
    expect(after?.budget.days.slice(0, 5).map((d) => d.baseKcal)).toEqual([1800, 1800, 1800, 1800, 1800]);
    expect(after?.budget.days.slice(5).map((d) => d.baseKcal)).toEqual([1550, 1550]);
    expect(after?.budget.todayBaseKcal).toBe(1800);
    expect(after?.budget.leftTodayKcal).toBe(1300);
    expect(after?.budget.days.slice(0, 4).map((d) => d.countedKcal)).toEqual(before?.budget.days.slice(0, 4).map((d) => d.countedKcal));

    const saturday = await getWeekBudget(db, W.tomorrow, { today: W.tomorrow });
    expect(saturday?.budget.todayBaseKcal).toBe(1550);
    expect((await getActiveGoal(db, W.tomorrow))?.version.id).toBe(version.id);
    expect((await getActiveGoal(db, today))?.version.id).toBe(W.ids.setupVersion);
  });

  it('leaves the view on track with the pending version and its week', async () => {
    const { version } = await actions.approveTarget(suggested, at);
    const view = await getTargetView(db, at);
    expect(view?.check.kind).toBe('onTrack');
    expect(view?.pending?.id).toBe(version.id);
    expect(view?.current?.id).toBe(W.ids.setupVersion);
    expect(view?.history.map((r) => [r.state, r.version.effectiveFrom])).toEqual([
      ['pending', W.tomorrow],
      ['current', W.startedOn],
    ]);
    expect(view?.week?.pending?.totalKcal).toBe(12100);
    expect(view?.week?.suggested).toBeUndefined();
  });

  it('removes a Keep current, and its undo puts it back', async () => {
    await actions.keepCurrentTarget({ versionId: W.ids.setupVersion }, at);
    const kept = await getInsightFeedback(db, TARGET_FEEDBACK_ID);
    expect(kept?.feedback).toBe('keepCurrent');
    expect((await getTargetView(db, at))?.check.kind).toBe('kept');

    const { undo } = await actions.approveTarget(suggested, at);
    expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toBeUndefined();
    await undo();
    expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toEqual(kept);
    expect((await getTargetView(db, at))?.check.kind).toBe('kept');
  });

  it('is undone by removing the version', async () => {
    const { version, undo } = await actions.approveTarget(suggested, at);
    await undo();
    expect(await db.goalVersions.get(version.id)).toBeUndefined();
    expect((await getTargetView(db, at))?.check.kind).toBe('suggestion');
  });

  it('is undone with another device’s approval for the same day that synced in meanwhile', async () => {
    const { version, undo } = await actions.approveTarget(suggested, at);
    await db.goalVersions.put({ ...version, id: 'version-other-device', dailyKcal: 1825, paceKgPerWeek: 0.25, createdAt: '2026-10-30T11:15:00.000Z' });
    await undo();
    expect(await db.goalVersions.count()).toBe(1);
    expect((await getTargetView(db, at))?.pending).toBeUndefined();
  });

  it('refuses numbers the user didn’t see, and a second tap', async () => {
    await expect(actions.approveTarget({ ...suggested, versionId: 'another-version' }, at)).rejects.toBeInstanceOf(TargetChangedError);
    await expect(actions.approveTarget({ ...suggested, dailyKcal: 1540 }, at)).rejects.toBeInstanceOf(TargetChangedError);
    expect(await db.goalVersions.count()).toBe(1);

    await actions.approveTarget(suggested, at);
    await expect(actions.approveTarget(suggested, at)).rejects.toThrow(TargetChangedError);
    expect(await db.goalVersions.count()).toBe(2);
  });

  it('changes the pace instead: 0.25 kg a week at 1,825', async () => {
    const { version } = await actions.approveTarget(slower, at);
    expect(version).toMatchObject({ paceKgPerWeek: 0.25, dailyKcal: 1825, proteinG: 110, carbsG: 210, fatG: 60, reason: 'approvedSuggestion' });
    const saturday = await getTargetView(db, { today: W.tomorrow });
    expect(saturday?.history[0]).toMatchObject({ state: 'current', paceKgPerWeek: 0.25, version: { id: version.id } });
    expect(saturday?.history[1]).toMatchObject({ state: 'past', until: today, paceKgPerWeek: 0.5 });
    expect(saturday?.check.kind === 'onTrack' || saturday?.check.kind === 'suggestion' ? saturday.check.current.paceKgPerWeek : 0).toBe(0.25);
  });
});

describe('keepCurrentTarget', () => {
  beforeEach(() => open());

  it('remembers the answer for 4 weeks, and its undo forgets it', async () => {
    const undo = await actions.keepCurrentTarget({ versionId: W.ids.setupVersion }, at);
    expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toMatchObject({
      ruleId: 'targetSuggestion',
      feedback: 'keepCurrent',
      pausedUntil: W.expected.keptUntil,
      keptTarget: { keptOn: today, maintenanceKcal: 2100, versionId: W.ids.setupVersion },
    });
    const kept = await getTargetView(db, at);
    expect(kept?.check).toMatchObject({ kind: 'kept', kept: { keptOn: today, until: W.expected.keptUntil } });
    expect(kept?.week?.suggested?.totalKcal).toBe(12100);

    await expect(actions.keepCurrentTarget({ versionId: W.ids.setupVersion }, at)).rejects.toBeInstanceOf(TargetChangedError);

    await undo();
    expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toBeUndefined();
    expect((await getTargetView(db, at))?.check.kind).toBe('suggestion');
  });

  it('comes back on its day', async () => {
    // The same answer, given 4 weeks before today.
    const row: InsightFeedback = {
      ruleId: TARGET_FEEDBACK_ID,
      feedback: 'keepCurrent',
      at: '2026-10-02T11:00:00.000Z',
      pausedUntil: today,
      keptTarget: { keptOn: '2026-10-02', maintenanceKcal: 2100, versionId: W.ids.setupVersion },
    };
    await db.insightFeedback.put(row);
    expect((await getTargetView(db, at))?.check.kind).toBe('suggestion');
    await db.insightFeedback.put({ ...row, pausedUntil: W.tomorrow });
    expect((await getTargetView(db, at))?.check.kind).toBe('kept');
    expect((await getTargetView(db, { today: W.tomorrow }))?.check.kind).toBe('suggestion');
  });

  it('puts back an earlier answer on undo', async () => {
    const earlier: InsightFeedback = { ruleId: TARGET_FEEDBACK_ID, feedback: 'keepCurrent', at: '2026-09-01T00:00:00.000Z', pausedUntil: '2026-09-29' };
    await db.insightFeedback.put(earlier);
    const undo = await actions.keepCurrentTarget({ versionId: W.ids.setupVersion }, at);
    await undo();
    expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toEqual(earlier);
  });
});

describe('cancelPendingTarget', () => {
  beforeEach(() => open());

  it('withdraws an approval before it starts, and its undo puts it back', async () => {
    const { version } = await actions.approveTarget(suggested, at);
    const undo = await actions.cancelPendingTarget(version.id, at);
    expect(await db.goalVersions.get(version.id)).toBeUndefined();
    expect((await getTargetView(db, at))?.check.kind).toBe('suggestion');
    await undo();
    expect(await db.goalVersions.get(version.id)).toEqual(version);
  });

  /** What the other device's offline approval for the same day looks like once it has synced in (D22). */
  async function otherDeviceApproval(mine: GoalVersion): Promise<GoalVersion> {
    const theirs: GoalVersion = { ...mine, id: 'version-other-device', dailyKcal: 1825, paceKgPerWeek: 0.25, createdAt: '2026-10-30T11:15:00.000Z' };
    await db.goalVersions.put(theirs);
    return theirs;
  }

  it('withdraws both approvals two devices made for the same day, and its undo puts both back', async () => {
    const { version } = await actions.approveTarget(suggested, at);
    const theirs = await otherDeviceApproval(version);
    expect((await getTargetView(db, at))?.pending?.id).toBe(theirs.id);

    const undo = await actions.cancelPendingTarget(theirs.id, at);
    const view = await getTargetView(db, at);
    expect(view?.pending).toBeUndefined();
    expect(view?.check.kind).toBe('suggestion');
    expect((await getActiveGoal(db, W.tomorrow))?.version.id).toBe(W.ids.setupVersion);
    expect(await db.goalVersions.count()).toBe(1);

    await undo();
    expect(await db.goalVersions.get(version.id)).toEqual(version);
    expect(await db.goalVersions.get(theirs.id)).toEqual(theirs);
  });

  it('leaves another day’s approval alone', async () => {
    const { version } = await actions.approveTarget(suggested, at);
    const later: GoalVersion = { ...version, id: 'version-later', effectiveFrom: '2026-11-02', createdAt: '2026-10-30T11:15:00.000Z' };
    await db.goalVersions.put(later);
    await actions.cancelPendingTarget(version.id, at);
    expect(await db.goalVersions.get(later.id)).toEqual(later);
  });

  it('refuses a version already in force, and the setup version', async () => {
    const { version } = await actions.approveTarget(suggested, at);
    await expect(actions.cancelPendingTarget(version.id, { today: W.tomorrow })).rejects.toBeInstanceOf(TargetChangedError);
    await expect(actions.cancelPendingTarget(W.ids.setupVersion, at)).rejects.toBeInstanceOf(TargetChangedError);
    await expect(actions.cancelPendingTarget('no-such-version', at)).rejects.toBeInstanceOf(TargetChangedError);
    expect(await db.goalVersions.count()).toBe(2);
  });
});

describe('getTargetCheck states', () => {
  it('needs weigh-ins with only weekly ones', async () => {
    await open({ weighInEvery: 7 });
    expect((await getTargetCheck(db, at))?.check).toMatchObject({ kind: 'needWeighIns', weighIns: 4 });
  });

  it('is too early with a young history', async () => {
    await open({ startedOn: '2026-10-14' });
    expect((await getTargetCheck(db, at))?.check).toMatchObject({ kind: 'tooEarly', completeDays: 16 });
  });

  it('has no target while paused today', async () => {
    await open();
    await updateGoalPeriod(db, W.ids.period, { to: today });
    await putGoalPeriod(db, { id: 'period-pause', goalId: W.ids.pause, from: today });
    expect((await getTargetCheck(db, at))?.check).toEqual({ kind: 'noTarget', reason: 'paused' });
  });

  it('has no target with a switch to another goal booked for tomorrow', async () => {
    await open();
    await db.goals.put({ ...(await db.goals.get(W.ids.cut))!, id: 'goal-festive', template: 'festive', status: 'saved', name: 'Festive maintain' });
    await updateGoalPeriod(db, W.ids.period, { to: W.tomorrow });
    await putGoalPeriod(db, { id: 'period-festive', goalId: 'goal-festive', from: W.tomorrow });
    expect((await getTargetCheck(db, at))?.check).toEqual({ kind: 'noTarget', reason: 'switching' });
  });
});

describe('two versions on the same day', () => {
  beforeEach(() => open());

  it('keeps one history row per day: the later one, as the budget does', async () => {
    const base = (await db.goalVersions.get(W.ids.setupVersion))!;
    const first: GoalVersion = { ...base, id: 'version-a', effectiveFrom: W.tomorrow, dailyKcal: 1550, reason: 'approvedSuggestion', createdAt: '2026-10-30T11:00:00.000Z' };
    const second: GoalVersion = { ...first, id: 'version-b', dailyKcal: 1825, paceKgPerWeek: 0.25, createdAt: '2026-10-30T11:05:00.000Z' };
    await db.goalVersions.bulkPut([second, first]);
    const view = await getTargetView(db, at);
    const rows = view?.history.filter((r) => r.version.effectiveFrom === W.tomorrow) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version.id).toBe('version-b');
    expect((await getActiveGoal(db, W.tomorrow))?.version).toEqual(rows[0]?.version);
    expect(view?.history).toHaveLength(2);
  });
});

describe('sync capture', () => {
  it('queues the new version, and its undo is a delete that syncs too', async () => {
    await open({}, { capture: () => true });
    await db.syncOutbox.clear();
    const { version, undo } = await actions.approveTarget(suggested, at);
    expect(await db.syncOutbox.get(['goalVersions', version.id])).toBeDefined();
    const queued = await db.syncOutbox.get(['goalVersions', version.id]);
    await undo();
    const after = await db.syncOutbox.get(['goalVersions', version.id]);
    expect(after).toBeDefined();
    expect(after?.nonce).not.toBe(queued?.nonce);
    expect(await db.goalVersions.get(version.id)).toBeUndefined();
  });

  it('queues nothing on the demo clock', async () => {
    await open({}, { capture: () => true });
    await db.syncOutbox.clear();
    setDemoClock(true);
    // The demo clock is a different day, so the action is told which day it is.
    await actions.keepCurrentTarget({ versionId: W.ids.setupVersion }, at);
    const { version } = await actions.approveTarget(suggested, at);
    expect(await db.goalVersions.get(version.id)).toBeDefined();
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

describe('the demo world', () => {
  it('unlocks after 21 complete days: 17 so far on the demo Friday', async () => {
    db = createDb(`target-demo-${crypto.randomUUID()}`);
    opened.push(db);
    await loadDemo(db);
    setDemoClock(true);
    const view = await getTargetView(db, { today: '2026-10-16' });
    expect(view?.check).toMatchObject({ kind: 'tooEarly', completeDays: 17, needDays: 21 });
    expect(view?.history).toHaveLength(1);
    expect(view?.history[0]).toMatchObject({ state: 'current', paceKgPerWeek: 0.5 });
  });
});

describe('the notice store', () => {
  it('remembers the last key seen', () => {
    expect(readTargetNoticeSeen()).toBeNull();
    markTargetNoticeSeen('k');
    expect(readTargetNoticeSeen()).toBe('k');
    clearTargetNoticeSeen();
    expect(readTargetNoticeSeen()).toBeNull();
  });

  it('keeps it in memory when storage refuses to write', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    markTargetNoticeSeen('version-cut-setup:2026-10-26');
    expect(storage.setItem).toHaveBeenCalled();
    expect(readTargetNoticeSeen()).toBe('version-cut-setup:2026-10-26');
  });
});
