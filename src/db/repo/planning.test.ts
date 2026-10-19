// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import {
  addSuggestionEvent,
  deleteInsightFeedback,
  deleteWeekPlan,
  getInsightFeedback,
  getSuggestionEvent,
  getWeekPlan,
  listInsightFeedback,
  listPausedRuleIds,
  listSuggestionEvents,
  listSuggestionEventsSince,
  listWeekPlansInRange,
  putInsightFeedback,
  putWeekPlan,
  setSuggestionOutcome,
  upsertWeekPlan,
} from '.';

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

describe('week plans repo', () => {
  const focus = { label: 'Kurang manis for drinks', sub: 'About 300 kcal a week less' };

  it('round-trips and queries plans', async () => {
    await putWeekPlan(db, { weekStart: '2026-10-05', focus });
    expect(await getWeekPlan(db, '2026-10-05')).toEqual({ weekStart: '2026-10-05', focus });
    expect((await listWeekPlansInRange(db, '2026-10-01', '2026-10-31')).map((p) => p.weekStart)).toEqual(['2026-10-05']);
    await deleteWeekPlan(db, '2026-10-05');
    expect(await getWeekPlan(db, '2026-10-05')).toBeUndefined();
  });

  it('upserts a makan day and a focus, and clears them with null', async () => {
    expect(await upsertWeekPlan(db, '2026-10-12', { makanDay: '2026-10-17' })).toEqual({ weekStart: '2026-10-12', makanDay: '2026-10-17' });
    expect(await upsertWeekPlan(db, '2026-10-12', { focus })).toEqual({ weekStart: '2026-10-12', makanDay: '2026-10-17', focus });
    expect(await upsertWeekPlan(db, '2026-10-12', { makanDay: null })).toEqual({ weekStart: '2026-10-12', focus });
    expect(await upsertWeekPlan(db, '2026-10-12', { focus: null })).toEqual({ weekStart: '2026-10-12' });
    expect(await getWeekPlan(db, '2026-10-12')).toEqual({ weekStart: '2026-10-12' });
  });
});

describe('insight feedback repo', () => {
  it('keeps one answer per rule and lists paused rules', async () => {
    await putInsightFeedback(db, { ruleId: 'drinks-share', feedback: 'useful', at: '2026-10-11T14:00:00.000Z' });
    await putInsightFeedback(db, { ruleId: 'long-days', feedback: 'notForMe', at: '2026-10-11T14:01:00.000Z', pausedUntil: '2026-11-08' });
    await putInsightFeedback(db, { ruleId: 'drinks-share', feedback: 'notForMe', at: '2026-10-12T14:00:00.000Z', pausedUntil: '2026-11-09' });

    expect(await listInsightFeedback(db)).toHaveLength(2);
    expect((await getInsightFeedback(db, 'drinks-share'))?.feedback).toBe('notForMe');
    expect((await listPausedRuleIds(db, '2026-10-16')).sort()).toEqual(['drinks-share', 'long-days']);
    expect(await listPausedRuleIds(db, '2026-11-08')).toEqual(['drinks-share']);
    expect(await listPausedRuleIds(db, '2026-11-09')).toEqual([]);

    await deleteInsightFeedback(db, 'long-days');
    expect(await getInsightFeedback(db, 'long-days')).toBeUndefined();
  });
});

describe('suggestion events repo', () => {
  it('adds events, lists them by time and records the outcome', async () => {
    await addSuggestionEvent(db, { id: 'e2', at: '2026-10-16T11:10:00.000Z', role: 'usual', name: 'Ayam bakar, half rice, ulam', outcome: 'shown' });
    await addSuggestionEvent(db, { id: 'e1', at: '2026-10-15T11:00:00.000Z', role: 'surprise', name: 'Mee sup ayam', outcome: 'ignored' });
    expect((await listSuggestionEvents(db)).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect((await listSuggestionEventsSince(db, '2026-10-16T00:00:00.000Z')).map((e) => e.id)).toEqual(['e2']);

    expect(await setSuggestionOutcome(db, 'e2', 'taken')).toBe(true);
    expect((await getSuggestionEvent(db, 'e2'))?.outcome).toBe('taken');
    expect(await setSuggestionOutcome(db, 'missing', 'taken')).toBe(false);
  });
});
