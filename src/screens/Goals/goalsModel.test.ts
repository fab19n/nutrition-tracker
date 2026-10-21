// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { createGoalActions, getGoalDetailIn, getGoalLibraryIn, getSwitchPreviewIn, type GoalDetail, type GoalLibrary, type SwitchPreview } from '@/db/goals';
import { buildGoal } from '@/db/seed/defaults';
import { DEMO_IDS, loadDemo } from '@/db/seed/demo';
import { endConditionState, goalDraftFor } from '@/domain/goals';
import type { Goal, GoalVersion } from '@/domain/types';
import {
  archiveToast,
  cancelToast,
  createToast,
  dayListLabel,
  draftFromForm,
  endHint,
  endNote,
  formFromDraft,
  formFromGoal,
  fromWhen,
  goalCardModel,
  goalsSubLine,
  macrosNote,
  mainNumberLine,
  moreCardModel,
  pausePickDefault,
  pauseUntilDefault,
  rangeLine,
  restoreToast,
  sameForm,
  saveToast,
  startsNote,
  statusCard,
  switchSheetModel,
  switchToast,
  targetFieldsChanged,
  targetWorking,
  templateDescription,
  timingLine,
  usageLine,
  withPace,
} from './goalsModel';

const G = DEMO_IDS.goals;
const TZ = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-16';
const SAT = '2026-10-17';
const at = { today: TODAY };
/** Fri 16 Oct, 7:10pm. */
const EVENING = new Date('2026-10-16T11:10:00.000Z');
/** Sat 17 Oct, 1:30am: still Friday's logical day. */
const NIGHT = new Date('2026-10-16T17:30:00.000Z');
const CTX = { today: TODAY, now: EVENING, tz: TZ, rolloverHour: 5, dailyMinimumKcal: 1400 };
const MONDAY = { until: 'monday' as const, date: pausePickDefault(TODAY) };

let db: KiraMakanDb;
let actions: ReturnType<typeof createGoalActions>;

beforeEach(async () => {
  db = createDb(`goals-model-${crypto.randomUUID()}`);
  actions = createGoalActions(db);
  await loadDemo(db);
});

afterEach(async () => {
  await db.delete();
});

async function library(today = TODAY): Promise<GoalLibrary> {
  return (await getGoalLibraryIn(db, { today }))!;
}

async function detail(id: string, today = TODAY): Promise<GoalDetail> {
  return (await getGoalDetailIn(db, id, { today }))!.detail!;
}

async function preview(id: string, today = TODAY): Promise<SwitchPreview> {
  return (await getSwitchPreviewIn(db, id, { today }))!;
}

async function pauseGoal(): Promise<void> {
  await actions.createGoal(goalDraftFor('pause', { name: 'Pause', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }), at);
}

function version(goalId: string, dailyKcal: number, proteinG = 110): GoalVersion {
  return { id: `v-${goalId}`, goalId, effectiveFrom: TODAY, dailyKcal, proteinG, carbsG: 0, fatG: 0, maintenanceKcal: 2350, reason: 'setup', createdAt: EVENING.toISOString() };
}

describe('templates', () => {
  it('describes each template with its main number', () => {
    expect(templateDescription('festive')).toBe('Hold your weight through open-house season. Main number: days in range.');
    expect(templateDescription('cut')).toBe('Lose fat at a steady pace. Main number: kcal left.');
    expect(templateDescription('pause')).toBe('Budget off for travel or sick days. Logging is optional.');
    expect(templateDescription('custom')).toBe('Your own target, pace and eating window. Main number: kcal left or protein left.');
  });
});

describe('goalCardModel (S41)', () => {
  it('has the demo’s cards', async () => {
    const lib = await library();
    expect(goalCardModel({ role: 'current', entry: lib.current! }, CTX)).toEqual({
      status: 'active',
      label: 'Active goal · week 3',
      title: 'Cut · 1,800 a day',
      detail: '−0.5 kg a week · protein 110g · min 1,400',
      badge: 'Active',
    });
    const [festive, leanBulk] = lib.saved;
    expect(goalCardModel({ role: 'saved', entry: festive! }, CTX)).toEqual({ status: 'saved', title: 'Festive maintain', detail: '2,100 a day · in range 1,890–2,310' });
    expect(goalCardModel({ role: 'saved', entry: leanBulk! }, CTX)).toEqual({ status: 'draft', title: 'Lean bulk', detail: '2,300 a day · protein 130g' });
    expect(goalCardModel({ role: 'template', template: 'pause' }, CTX)).toEqual({
      status: 'template',
      title: 'Pause',
      detail: 'Budget off for travel or sick days. Logging is optional.',
      badge: 'Template',
      openLabel: 'New goal from Pause',
    });
  });

  it('names the template above a goal called something else', () => {
    const raya = { ...buildGoal('festive', { id: 'raya', createdAt: EVENING.toISOString(), status: 'saved', name: 'Raya maintain' }) };
    expect(goalCardModel({ role: 'saved', entry: { goal: raya, version: version('raya', 2100) } }, CTX)).toMatchObject({ label: 'Festive maintain', title: 'Raya maintain' });
    const cut = buildGoal('cut', { id: 'cut2', createdAt: EVENING.toISOString(), status: 'saved', name: 'cut' });
    expect(goalCardModel({ role: 'saved', entry: { goal: cut, version: version('cut2', 1800) } }, CTX)).toEqual({
      status: 'saved',
      title: 'cut',
      detail: '1,800 a day · −0.5 kg a week · protein 110g',
    });
  });

  it('puts protein first for a Custom goal led by protein, and says hold for no pace', () => {
    const custom: Goal = { ...buildGoal('custom', { id: 'c', createdAt: EVENING.toISOString(), status: 'saved' }), heroMetric: 'proteinLeft' };
    expect(goalCardModel({ role: 'saved', entry: { goal: custom, version: version('c', 2000, 140) } }, CTX).detail).toBe('protein 140g a day · 2,000 kcal');
    const hold: Goal = { ...custom, heroMetric: 'kcalLeft', paceKgPerWeek: 0 };
    expect(goalCardModel({ role: 'saved', entry: { goal: hold, version: version('c', 2350) } }, CTX).detail).toBe('2,350 a day · hold weight · protein 110g');
  });

  it('shows a booked goal as next, from tomorrow', async () => {
    await actions.switchGoal(G.festive, at);
    const lib = await library();
    expect(goalCardModel({ role: 'next', entry: lib.next! }, CTX)).toEqual({
      status: 'next',
      label: 'Next · from tomorrow (Sat)',
      title: 'Festive maintain',
      detail: '2,100 a day · in range 1,890–2,310',
      badge: 'Starts Sat',
    });
    expect(goalCardModel({ role: 'next', entry: lib.next! }, { ...CTX, now: NIGHT }).label).toBe('Next · from 5am (Sat)');
  });

  it('shows a pause in force, and the goal it gives back', async () => {
    await pauseGoal();
    await actions.switchGoal(G.pause, { ...at, until: '2026-10-19' });
    const saturday = await library(SAT);
    const ctx = { ...CTX, today: SAT };
    expect(goalCardModel({ role: 'current', entry: saturday.current! }, ctx)).toEqual({
      status: 'active',
      label: 'Active goal · until Mon',
      title: 'Pause · budget off',
      detail: 'Logging is optional. These days stay out of trends.',
      badge: 'Active',
    });
    expect(goalCardModel({ role: 'next', entry: saturday.next! }, ctx)).toMatchObject({ label: 'Next · from Mon 19 Oct', badge: 'Starts Mon', title: 'Cut' });
    expect(moreCardModel(saturday)?.chips).toEqual(['Cut · Starts again Mon', 'Festive maintain · Saved', 'Lean bulk · Draft']);
  });

  it('shows an open pause since its first day', async () => {
    await pauseGoal();
    await actions.switchGoal(G.pause, at);
    const lib = await library('2026-10-20');
    expect(goalCardModel({ role: 'current', entry: lib.current! }, { ...CTX, today: '2026-10-20' }).label).toBe('Active goal · since Sat 17 Oct');
  });

  it('shows when an ended goal was last used', async () => {
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-01' });
    await db.goalPeriods.bulkPut([
      { id: 'p-festive', goalId: G.festive, from: '2026-10-01', to: '2026-10-05' },
      { id: 'p-cut-2', goalId: G.cut, from: '2026-10-05' },
    ]);
    await actions.archiveGoal(G.festive, at);
    const lib = await library();
    expect(goalCardModel({ role: 'ended', entry: lib.ended[0]! }, CTX)).toEqual({ status: 'ended', title: 'Festive maintain', detail: 'Used Thu 1 Oct to Sun 4 Oct' });
  });
});

describe('the S48 card and the Goals row', () => {
  it('lists the saved goals as chips', async () => {
    const lib = await library();
    expect(moreCardModel(lib)).toEqual({
      status: 'active',
      label: 'Active goal · week 3',
      title: 'Cut · 1,800 a day',
      detail: '−0.5 kg a week · protein 110g · min 1,400',
      badge: 'Active',
      chips: ['Festive maintain · Saved', 'Lean bulk · Draft'],
    });
    expect(goalsSubLine(lib)).toBe('Cut active · 2 saved');
  });

  it('puts a booked goal first', async () => {
    await actions.switchGoal(G.festive, at);
    const lib = await library();
    expect(moreCardModel(lib)?.chips).toEqual(['Festive maintain · Starts Sat', 'Lean bulk · Draft']);
    expect(goalsSubLine(lib)).toBe('Cut active · Festive maintain from Sat');
  });

  it('says only the goal when nothing is saved, and nothing without a goal', async () => {
    const lib = await library();
    expect(goalsSubLine({ ...lib, saved: [] })).toBe('Cut active');
    const { current: _current, ...none } = lib;
    expect(goalsSubLine(none)).toBeUndefined();
    expect(moreCardModel(none)).toBeUndefined();
  });
});

describe('form hints', () => {
  const base = { maintenanceKcal: 2350, rangePct: 0.1, dailyMinimumKcal: 1400 };

  it('works out each kind of target', () => {
    expect(targetWorking({ ...base, template: 'festive', dailyKcal: 2350, paceKgPerWeek: 0 })).toBe('Maintenance ~2,350 · in range 2,120–2,590');
    expect(targetWorking({ ...base, template: 'festive', dailyKcal: 2100, paceKgPerWeek: 0, maintenanceKcal: 2100 })).toBe('Maintenance ~2,100 · in range 1,890–2,310');
    expect(targetWorking({ ...base, template: 'leanBulk', dailyKcal: 2300, paceKgPerWeek: -0.25, maintenanceKcal: 2100 })).toBe('Maintenance ~2,100 + 200 surplus');
    expect(targetWorking({ ...base, template: 'leanBulk', dailyKcal: 2000, paceKgPerWeek: -0.25, maintenanceKcal: 2100 })).toBe('100 under your ~2,100 maintenance');
    expect(targetWorking({ ...base, template: 'cut', dailyKcal: 1800, paceKgPerWeek: 0.5 })).toBe('Maintenance ~2,350 − 550 for 0.5 kg a week');
    expect(targetWorking({ ...base, template: 'custom', dailyKcal: 2350, paceKgPerWeek: 0 })).toBe('Your maintenance ~2,350');
    expect(targetWorking({ ...base, template: 'cut', dailyKcal: 1400, paceKgPerWeek: 0.75, maintenanceKcal: 1900 })).toBe('Held at your 1,400 daily minimum');
    expect(targetWorking({ ...base, template: 'cut', dailyKcal: 1850, paceKgPerWeek: 0.5 })).toBe('500 under your ~2,350 maintenance, about 0.45 kg a week');
    expect(targetWorking({ ...base, template: 'cut', dailyKcal: 1700, paceKgPerWeek: 0.5 })).toBe('650 under your ~2,350 maintenance, about 0.6 kg a week');
    expect(targetWorking({ ...base, template: 'cut', dailyKcal: 2350, paceKgPerWeek: 0.5 })).toBe('At your ~2,350 maintenance');
    expect(targetWorking({ ...base, template: 'custom', dailyKcal: 2500, paceKgPerWeek: 0.25 })).toBe('150 over your ~2,350 maintenance');
    expect(targetWorking({ ...base, template: 'pause', dailyKcal: 0, paceKgPerWeek: 0 })).toBe('');
  });

  it('says how carbs and fat follow, and the Festive band', () => {
    expect(macrosNote(1800, 110)).toBe('Carbs 205g and fat 60g follow from the rest.');
    // A stored target says its own split (the demo's 1,800 is 180g carbs and 60g fat).
    expect(macrosNote(1800, 110, { carbsG: 180, fatG: 60 })).toBe('Carbs 180g and fat 60g follow from the rest.');
    expect(rangeLine(2100, 0.1)).toBe('In range: 1,890–2,310 kcal');
    expect(rangeLine(2100, 0.05)).toBe('In range: 2,000–2,210 kcal');
  });

  it('says when a target change starts, only for a goal with history', async () => {
    const cut = await detail(G.cut);
    expect(startsNote(cut, EVENING)).toBe('Target changes start tomorrow (Sat). Today keeps 1,800.');
    expect(startsNote(cut, NIGHT)).toBe('Target changes start at 5am (Sat). Today keeps 1,800.');
    expect(startsNote(await detail(G.festive), EVENING)).toBeUndefined();

    await actions.switchGoal(G.festive, at);
    const usedCut = await detail(G.cut, SAT);
    expect(usedCut.role).toBe('saved');
    expect(startsNote(usedCut, new Date('2026-10-17T11:10:00.000Z'))).toBe('Target changes start tomorrow (Sun).');
  });

  it('says how far an end is', () => {
    const at16 = { today: TODAY, paceKgPerWeek: 0.5 };
    expect(endHint({ kind: 'none' })).toBeUndefined();
    expect(endHint(endConditionState({ date: '2026-10-31' }, at16))).toBe('Ends Sat 31 Oct · 15 days to go');
    expect(endHint(endConditionState({ date: SAT }, at16))).toBe('Ends Sat 17 Oct · 1 day to go');
    expect(endHint(endConditionState({ date: TODAY }, at16))).toBe('Reached on Fri 16 Oct');
    expect(endHint(endConditionState({ weightKg: 75 }, { ...at16, trendKg: 77.99 }))).toBe('Your trend is 78.0 kg now');
    expect(endHint(endConditionState({ weightKg: 78 }, { ...at16, trendKg: 77.99 }))).toBe('Reached: your trend is 78.0 kg');
    expect(endHint(endConditionState({ weightKg: 75 }, at16))).toBe('No trend yet. Weigh in to track it.');
  });
});

describe('the form', () => {
  it('round-trips a goal through the form', async () => {
    const goal = (await db.goals.get(G.cut))!;
    const v = (await db.goalVersions.get(DEMO_IDS.goalVersions.cut))!;
    const form = formFromGoal(goal, v);
    expect(form).toMatchObject({
      name: 'Cut',
      dailyKcal: 1800,
      proteinG: 110,
      paceKgPerWeek: 0.5,
      windowHours: 12,
      fixedWindow: { on: false, start: '10:00', end: '20:00' },
      sleepGap: { on: true, hours: 2 },
      grazing: { on: true, occasions: 5 },
      insightsOff: [],
      end: { kind: 'none', date: '', weightKg: '' },
    });
    const draft = draftFromForm(form, 'cut', goal);
    expect(draft).toEqual({
      name: 'Cut',
      template: 'cut',
      heroMetric: 'kcalLeft',
      paceKgPerWeek: 0.5,
      dailyKcal: 1800,
      proteinG: 110,
      timing: { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 },
      insightsOff: [],
    });
    expect(sameForm(formFromGoal({ ...goal, ...draft, timing: draft.timing }, v), form)).toBe(true);
  });

  it('reads a typed weight with a comma, fixed hours and turned-off rules', () => {
    const custom = buildGoal('custom', { id: 'c', createdAt: EVENING.toISOString(), status: 'saved' });
    const form = formFromGoal(custom, version('c', 1800));
    const edited = {
      ...form,
      heroMetric: 'proteinLeft' as const,
      fixedWindow: { on: true, start: '10:00', end: '20:30' },
      sleepGap: { on: false, hours: 2 },
      grazing: { on: false, occasions: 5 },
      insightsOff: ['timing' as const],
      end: { kind: 'weight' as const, date: '', weightKg: '78,6' },
    };
    const draft = draftFromForm(edited, 'custom', custom);
    expect(draft.heroMetric).toBe('proteinLeft');
    expect(draft.timing).toEqual({ maxWindowHours: 12, fixedWindow: { startMin: 600, endMin: 1230 } });
    expect(draft.endCondition).toEqual({ weightKg: 78.6 });
    expect(draft.insightsOff).toEqual(['timing']);
    expect(formFromGoal({ ...custom, timing: draft.timing, endCondition: { weightKg: 78.6 } }, version('c', 1800))).toMatchObject({
      fixedWindow: { on: true, start: '10:00', end: '20:30' },
      end: { kind: 'weight', weightKg: '78.6' },
    });
    expect(draftFromForm({ ...edited, end: { kind: 'weight', date: '', weightKg: 'abc' } }, 'custom', custom).endCondition?.weightKg).toBeNaN();
    expect(draftFromForm({ ...edited, end: { kind: 'date', date: '2026-12-01', weightKg: '' } }, 'custom', custom).endCondition).toEqual({ date: '2026-12-01' });
    // Only Custom picks a main number or fixed hours.
    expect(draftFromForm(edited, 'cut').heroMetric).toBe('kcalLeft');
    expect(draftFromForm(edited, 'cut').timing.fixedWindow).toBeUndefined();
  });

  it('keeps a Pause draft to its name', () => {
    const draft = draftFromForm(formFromDraft(goalDraftFor('pause', { name: 'Pause', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 })), 'pause');
    expect(draft).toEqual({ name: 'Pause', template: 'pause', heroMetric: 'none', paceKgPerWeek: 0, timing: {}, insightsOff: [] });
  });

  it('builds the S43 form from a template draft', () => {
    const form = formFromDraft(goalDraftFor('festive', { name: 'Festive maintain 2', maintenanceKcal: 2350, weightKg: 77.99, dailyMinimumKcal: 1400 }));
    expect(form).toMatchObject({ name: 'Festive maintain 2', dailyKcal: 2350, proteinG: 110, rangePct: 0.1, windowHours: 14, sleepGap: { on: false }, grazing: { on: true, occasions: 6 } });
  });

  it('compares forms, insight groups in any order', () => {
    const form = formFromDraft(goalDraftFor('cut', { name: 'Cut', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
    expect(sameForm(form, { ...form })).toBe(true);
    expect(sameForm({ ...form, insightsOff: ['food', 'timing'] }, { ...form, insightsOff: ['timing', 'food'] })).toBe(true);
    expect(sameForm(form, { ...form, name: 'Cut 2' })).toBe(false);
    expect(sameForm(form, { ...form, end: { ...form.end, kind: 'date' } })).toBe(false);
    expect(targetFieldsChanged(form, { ...form, name: 'x' })).toBe(false);
    expect(targetFieldsChanged(form, { ...form, proteinG: 115 })).toBe(true);
  });

  it('sets the target a pace gives', () => {
    const form = formFromDraft(goalDraftFor('cut', { name: 'Cut', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
    expect(withPace(form, 0.25, { template: 'cut', maintenanceKcal: 2350, dailyMinimumKcal: 1400 })).toMatchObject({ paceKgPerWeek: 0.25, dailyKcal: 2075 });
    expect(withPace(form, 0.75, { template: 'cut', maintenanceKcal: 1900, dailyMinimumKcal: 1400 }).dailyKcal).toBe(1400);
    expect(withPace(form, 0, { template: 'custom', maintenanceKcal: 2350, dailyMinimumKcal: 1400 }).dailyKcal).toBe(2350);
  });

  it('drops a weight end when the pace becomes Hold, and keeps any other end', () => {
    const ctx = { template: 'custom', maintenanceKcal: 2350, dailyMinimumKcal: 1400 } as const;
    const form = formFromDraft(goalDraftFor('custom', { name: 'Custom', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }));
    const weight = { ...form, paceKgPerWeek: 0.25, end: { kind: 'weight' as const, date: '', weightKg: '75' } };
    const held = withPace(weight, 0, ctx);
    expect(held.end.kind).toBe('none');
    expect(draftFromForm(held, 'custom').endCondition).toBeUndefined();
    expect(withPace(weight, 0.5, ctx).end).toEqual(weight.end);
    const dated = { ...weight, end: { kind: 'date' as const, date: '2026-12-01', weightKg: '' } };
    expect(withPace(dated, 0, ctx).end).toEqual(dated.end);
  });

  it('shows a stored weight end on a Hold goal as no end', () => {
    const goal = { ...buildGoal('custom', { id: 'g-hold', createdAt: EVENING.toISOString(), status: 'saved' }), paceKgPerWeek: 0, endCondition: { weightKg: 75 } };
    expect(formFromGoal(goal, undefined).end.kind).toBe('none');
    expect(formFromGoal({ ...goal, paceKgPerWeek: 0.25 }, undefined).end).toEqual({ kind: 'weight', date: '', weightKg: '75' });
  });
});

describe('the switch sheet (S44)', () => {
  it('lists paused days', () => {
    expect(dayListLabel(['2026-10-17'])).toBe('Sat');
    expect(dayListLabel(['2026-10-17', '2026-10-18'])).toBe('Sat and Sun');
    expect(dayListLabel(['2026-10-14', '2026-10-15', '2026-10-16'])).toBe('Wed–Fri');
    expect(dayListLabel(['2026-10-12', '2026-10-14', '2026-10-16'])).toBe('Mon, Wed and Fri');
    expect(dayListLabel([])).toBe('');
  });

  it('says the timing rules', () => {
    expect(timingLine(buildGoal('cut', { id: 'a', createdAt: '' }))).toBe('Timing: 12-hour eating window, last meal 2 h before sleep, more than 5 eating occasions flagged.');
    expect(timingLine(buildGoal('festive', { id: 'a', createdAt: '' }))).toBe('Timing: 14-hour eating window, more than 6 eating occasions flagged.');
    expect(timingLine({ template: 'custom', timing: { fixedWindow: { startMin: 600, endMin: 1200 }, maxWindowHours: 12 } })).toBe('Timing: eating window 10am–8pm.');
    expect(timingLine(buildGoal('pause', { id: 'a', createdAt: '' }))).toBeUndefined();
  });

  it('says what the main number becomes, or that it stays', async () => {
    const from = (await preview(G.festive)).from;
    const festive = buildGoal('festive', { id: 'f', createdAt: '' });
    const cut = buildGoal('cut', { id: 'c', createdAt: '' });
    expect(mainNumberLine(festive, version('f', 2100), from)).toBe('Main number becomes days in range (2,100 ± 10%).');
    expect(mainNumberLine(buildGoal('leanBulk', { id: 'l', createdAt: '' }), version('l', 2300, 130), from)).toBe('Main number becomes protein left, 130g.');
    expect(mainNumberLine(cut, version('c', 1650), from)).toBe('Main number stays kcal left, 1,650 a day.');
    expect(mainNumberLine(buildGoal('pause', { id: 'p', createdAt: '' }), undefined, from)).toBe('Budget off. Logging is optional, and these days stay out of trends.');
    expect(mainNumberLine(cut, version('c', 1650), undefined)).toBe('Main number becomes kcal left, 1,650 a day.');
  });

  it('describes a switch to Festive maintain from Friday evening', async () => {
    expect(switchSheetModel(await preview(G.festive), MONDAY, EVENING)).toEqual({
      goalName: 'Festive maintain',
      startsLine: 'Starts tomorrow (Sat). Past days keep the goal they had.',
      week: { lead: 'This week: 5 days at 1,800 + 2 days at 2,100 = ', total: '13,200 kcal' },
      changes: ['Main number becomes days in range (2,100 ± 10%).', 'Timing: 14-hour eating window, more than 6 eating occasions flagged.'],
      confirmLabel: 'Switch from tomorrow',
    });
  });

  it('describes Lean bulk, and what a switch replaces', async () => {
    const lean = switchSheetModel(await preview(G.leanBulk), MONDAY, EVENING);
    expect(lean.changes[0]).toBe('Main number becomes protein left, 130g.');
    expect(lean.week).toEqual({ lead: 'This week: 5 days at 1,800 + 2 days at 2,300 = ', total: '13,600 kcal' });
    expect(lean.replaces).toBeUndefined();
    await actions.switchGoal(G.festive, at);
    expect(switchSheetModel(await preview(G.leanBulk), MONDAY, EVENING).replaces).toBe('This replaces Festive maintain from Sat.');
  });

  it('runs a pause to Monday, a picked day or the next switch', async () => {
    await pauseGoal();
    const p = await preview(G.pause);
    const monday = switchSheetModel(p, MONDAY, EVENING);
    expect(monday.untilModel).toEqual({
      options: [
        { id: 'monday', label: 'Mon 19 Oct' },
        { id: 'date', label: 'Pick a date' },
        { id: 'open', label: 'Until I switch back' },
      ],
      selected: 'monday',
      date: '2026-10-24',
      minDate: '2026-10-18',
      maxDate: '2026-12-16',
      line: 'Cut starts again on Mon 19 Oct.',
    });
    expect(monday.untilDay).toBe('2026-10-19');
    expect(monday.week).toEqual({ lead: 'This week: 5 days at 1,800 = ', total: '9,000 kcal', tail: '. Sat and Sun: budget off.' });
    expect(monday.changes).toEqual(['Budget off. Logging is optional, and these days stay out of trends.']);

    const picked = switchSheetModel(p, { until: 'date', date: '2026-11-02' }, EVENING);
    expect(picked.untilModel?.line).toBe('Cut starts again on Mon 2 Nov.');
    expect(picked.untilDay).toBe('2026-11-02');
    expect(picked.week?.tail).toBe('. Sat and Sun: budget off.');

    const open = switchSheetModel(p, { until: 'open', date: '2026-10-24' }, EVENING);
    expect(open.untilModel?.line).toBe('Runs until you switch to another goal.');
    expect(open.untilDay).toBeUndefined();

    const outside = switchSheetModel(p, { until: 'date', date: '2027-01-01' }, EVENING);
    expect(outside.untilModel?.error).toBe('Pick a day between Sun 18 Oct and Wed 16 Dec');
    expect(outside.untilDay).toBeUndefined();
  });

  it('describes going back from a pause to Cut', async () => {
    await pauseGoal();
    await actions.switchGoal(G.pause, at);
    const sheet = switchSheetModel(await preview(G.cut, SAT), MONDAY, new Date('2026-10-17T11:10:00.000Z'));
    expect(sheet.changes[0]).toBe('Main number becomes kcal left, 1,800 a day.');
    expect(sheet.startsLine).toBe('Starts tomorrow (Sun). Past days keep the goal they had.');
    // Mon–Fri kept their target and Sunday has Cut again; the paused Saturday doesn't split the group.
    expect(sheet.week).toEqual({ lead: 'This week: 6 days at 1,800 = ', total: '10,800 kcal', tail: '. Sat: budget off.' });
  });

  it('starts a Sunday switch with the new week, and has no week line', async () => {
    const sheet = switchSheetModel(await preview(G.festive, '2026-10-18'), MONDAY, new Date('2026-10-18T11:10:00.000Z'));
    expect(sheet.startsLine).toBe('Starts tomorrow (Mon), with the new week. Past days keep the goal they had.');
    expect(sheet.week).toBeUndefined();
  });

  it('starts at the rollover after midnight', async () => {
    const sheet = switchSheetModel(await preview(G.festive), MONDAY, NIGHT);
    expect(sheet.startsLine).toBe('Starts at 5am (Sat). Past days keep the goal they had.');
    expect(sheet.confirmLabel).toBe('Switch from 5am');
  });

  it('defaults a pause to the Monday after the week tomorrow is in', () => {
    expect(pauseUntilDefault('2026-10-16')).toBe('2026-10-19');
    expect(pauseUntilDefault('2026-10-18')).toBe('2026-10-26');
    expect(pausePickDefault('2026-10-16')).toBe('2026-10-24');
  });
});

describe('S42 status, usage and the end note', () => {
  it('describes each role', async () => {
    const cut = await detail(G.cut);
    expect(statusCard(cut, EVENING)).toEqual({ headline: 'Your goal now · week 3', lines: [] });
    expect(statusCard(await detail(G.festive), EVENING)).toBeUndefined();

    await actions.switchGoal(G.festive, at);
    expect(statusCard(await detail(G.festive), EVENING)).toEqual({
      headline: 'Starts tomorrow (Sat)',
      lines: ['Today and earlier days keep Cut.'],
      cancelLabel: 'Keep Cut instead',
    });
    expect(statusCard(await detail(G.cut), EVENING)).toEqual({
      headline: 'Your goal now · week 3',
      lines: ['Festive maintain starts tomorrow (Sat).'],
      cancelLabel: 'Keep Cut instead',
    });
  });

  it('says when a pending target starts', async () => {
    await actions.saveGoalEdits(G.cut, { ...draftFromForm(formFromGoal((await db.goals.get(G.cut))!, (await db.goalVersions.get(DEMO_IDS.goalVersions.cut))!), 'cut'), dailyKcal: 1850 }, at);
    expect(statusCard(await detail(G.cut), EVENING)?.lines).toEqual(['1,850 starts tomorrow (Sat). Today keeps 1,800.']);
  });

  it('describes a pause and the goal it gives back', async () => {
    await pauseGoal();
    await actions.switchGoal(G.pause, { ...at, until: '2026-10-19' });
    const saturday = new Date('2026-10-17T11:10:00.000Z');
    // While the pause runs, it can go on and Cut can start early, whatever day it is.
    expect(statusCard(await detail(G.pause, SAT), saturday)).toEqual({
      headline: 'Paused until Mon',
      lines: ['Budget off. Logging is optional, and these days stay out of trends.', 'Cut starts again on Mon 19 Oct.'],
      cancelLabel: 'Keep Pause instead',
    });
    expect(statusCard(await detail(G.cut, SAT), saturday)).toEqual({
      headline: 'Starts again on Mon 19 Oct',
      lines: ['Today and earlier days keep Pause.'],
      cancelLabel: 'Keep Pause instead',
    });
    // On the pause's last day, Cut starts tomorrow and the pause can still go on.
    const sunday = new Date('2026-10-18T11:10:00.000Z');
    expect(statusCard(await detail(G.pause, '2026-10-18'), sunday)?.cancelLabel).toBe('Keep Pause instead');
  });

  it('describes an ended goal', async () => {
    await db.goals.update(G.leanBulk, { status: 'ended' });
    expect(statusCard(await detail(G.leanBulk), EVENING)).toEqual({ headline: 'Ended', lines: ['Past days keep it. Restore it to use it again.'] });
  });

  it('says how the goal has been used', async () => {
    expect(usageLine(await detail(G.cut))).toBe('In use since Mon 28 Sep');
    expect(usageLine(await detail(G.festive))).toBe('Not used yet. Its target starts the day you switch to it.');
    // Pause has no target to start.
    expect(usageLine(await detail(G.pause))).toBe('Not used yet. It starts the day you switch to it.');
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-01' });
    await db.goalPeriods.bulkPut([
      { id: 'p-festive', goalId: G.festive, from: '2026-10-01', to: '2026-10-05' },
      { id: 'p-cut-2', goalId: G.cut, from: '2026-10-05', to: '2026-10-08' },
      { id: 'p-festive-2', goalId: G.festive, from: '2026-10-08', to: '2026-10-10' },
      { id: 'p-cut-3', goalId: G.cut, from: '2026-10-10' },
    ]);
    expect(usageLine(await detail(G.festive))).toBe('Used 2 times · Last used Thu 8 Oct to Fri 9 Oct');
    await db.goalPeriods.delete('p-festive-2');
    expect(usageLine(await detail(G.festive))).toBe('Last used Thu 1 Oct to Sun 4 Oct');
  });

  it('notes a reached end and what to switch to', async () => {
    await db.goals.update(G.cut, { endCondition: { date: TODAY } });
    const end = (await library()).end!;
    expect(endNote(end)).toEqual({ lead: 'You reached your end date, Fri 16 Oct.', rest: 'Switch to Festive maintain to hold your weight.', actionLabel: 'See Festive maintain' });
    expect(endNote({ ...end, maintain: { kind: 'template' } })).toEqual({
      lead: 'You reached your end date, Fri 16 Oct.',
      rest: 'A maintain goal holds your weight from here.',
      actionLabel: 'Set up a maintain goal',
    });
    const { maintain: _maintain, ...festive } = end;
    expect(endNote({ ...festive, state: { kind: 'weight', weightKg: 75, reached: true, trendKg: 74.9 } })).toEqual({ lead: 'Your trend reached 75.0 kg.', rest: 'Pick what comes next.' });
    expect((await detail(G.cut)).maintain).toEqual({ kind: 'goal', goal: expect.objectContaining({ id: G.festive }) });
  });
});

describe('toasts', () => {
  const festive = buildGoal('festive', { id: 'f', createdAt: '' });
  const pause = buildGoal('pause', { id: 'p', createdAt: '' });

  it('says what a switch did', () => {
    expect(switchToast(festive, SAT, undefined, TODAY, EVENING, TZ, 5)).toBe('Festive maintain from tomorrow (Sat)');
    expect(switchToast(festive, SAT, undefined, TODAY, NIGHT, TZ, 5)).toBe('Festive maintain from 5am (Sat)');
    expect(switchToast(pause, SAT, '2026-10-19', TODAY, EVENING, TZ, 5)).toBe('Paused from tomorrow (Sat) until Mon');
    expect(switchToast(pause, SAT, undefined, TODAY, EVENING, TZ, 5)).toBe('Paused from tomorrow (Sat)');
    expect(switchToast(pause, SAT, '2026-11-02', TODAY, EVENING, TZ, 5)).toBe('Paused from tomorrow (Sat) until Mon 2 Nov');
    expect(fromWhen(TODAY, NIGHT, TZ, 5)).toBe('5am (Sat)');
  });

  it('says what the other actions did', () => {
    const cut = buildGoal('cut', { id: 'c', createdAt: '' });
    expect(cancelToast(cut)).toBe('Cut stays your goal');
    expect(archiveToast(buildGoal('leanBulk', { id: 'l', createdAt: '' }))).toBe('Archived · Lean bulk');
    expect(restoreToast(buildGoal('leanBulk', { id: 'l', createdAt: '' }))).toBe('Restored · Lean bulk');
    expect(createToast({ ...festive, name: 'Festive maintain 2' })).toBe('Saved · Festive maintain 2');
    expect(saveToast({ version: version('c', 1850), startsOn: SAT }, 'tomorrow')).toBe('Saved · 1,850 a day from tomorrow');
    expect(saveToast({ version: version('c', 1850) }, 'tomorrow')).toBe('Saved');
    expect(saveToast({}, 'tomorrow')).toBe('Saved');
  });
});
