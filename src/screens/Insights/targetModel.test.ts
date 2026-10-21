// @vitest-environment node
import { PATHS } from '@/app/paths';
import { createDb, type KiraMakanDb } from '@/db/db';
import { loadDemo } from '@/db/seed/demo';
import { createTargetActions, getTargetView, type TargetView } from '@/db/targetSuggestion';
import type { GoalVersion } from '@/domain/types';
import { loadMaintenanceWorld, MAINTENANCE_WORLD as W, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';
import {
  decisionToast,
  historyRows,
  pendingModel,
  screenTitle,
  startsWhen,
  statusModel,
  targetCardModel,
  weekLineOf,
  weeksOfData,
} from './targetModel';

const TZ = 'Asia/Kuala_Lumpur';
/** Fri 30 Oct, 7:10pm. */
const EVENING = new Date(W.now);
/** Sat 31 Oct, 1:30am: still Friday's logical day. */
const NIGHT = new Date('2026-10-30T17:30:00.000Z');

const opened: KiraMakanDb[] = [];

async function worldView(opts: MaintenanceWorldOptions = {}, today: string = W.today): Promise<{ db: KiraMakanDb; view: TargetView }> {
  const db = createDb(`target-model-${crypto.randomUUID()}`);
  opened.push(db);
  await loadMaintenanceWorld(db, opts);
  const view = await getTargetView(db, { today });
  if (!view) throw new Error('No view');
  return { db, view };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

describe('startsWhen', () => {
  it('says tomorrow in the evening, and the rollover time after midnight', () => {
    expect(startsWhen(W.today, EVENING, TZ, 5)).toEqual({ long: 'tomorrow (Sat)', short: 'tomorrow' });
    expect(startsWhen(W.today, NIGHT, TZ, 5)).toEqual({ long: 'at 5am (Sat)', short: '5am' });
  });
});

describe('weeksOfData', () => {
  it('counts whole weeks of complete days, 3 at least', () => {
    expect(weeksOfData(21)).toBe(3);
    expect(weeksOfData(27)).toBe(3);
    expect(weeksOfData(28)).toBe(4);
  });
});

describe('targetCardModel', () => {
  it('has every string of the full S37 card', async () => {
    const { view } = await worldView();
    const card = targetCardModel(view, { now: EVENING, variant: 'full' });
    expect(card?.props).toEqual({
      variant: 'full',
      meta: 'Based on 4 weeks',
      headline: 'Your real maintenance looks like ~2,100, not 2,350',
      working: 'You logged ~1,820 a day, and your trend dropped 0.25 kg a week.',
      workingRows: [
        { label: 'Logged', value: '~1,820 a day' },
        { label: 'Trend', value: '−0.25 kg a week ≈ +275 a day' },
        { label: 'Maintenance', value: '~2,100 a day', strong: true },
      ],
      basis:
        'From 28 complete days, Mon 28 Sep to Sun 25 Oct. Days with a guess, not counted or not confirmed are left out. Checked again on Mon 2 Nov.',
      currentKcal: '1,800',
      suggestedKcal: '1,550',
      targetNote: 'At your 0.5 kg a week pace, never below your 1,400 minimum.',
      startsNote: 'Starts tomorrow (Sat). Today and earlier days keep their target.',
      weekLine: 'This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal',
    });
    expect(card?.slowerDetail).toBe('0.25 kg a week → 1,825 a day');
    expect(card?.choices).toEqual({
      suggested: { versionId: 'version-cut-setup', option: 'suggested', dailyKcal: 1550 },
      slowerPace: { versionId: 'version-cut-setup', option: 'slowerPace', dailyKcal: 1825 },
    });
    expect(card?.kept).toBe(false);
  });

  it('is shorter on the Insights card, and starts at 5am after midnight', async () => {
    const { view } = await worldView();
    const compact = targetCardModel(view, { now: EVENING, variant: 'compact' });
    expect(compact?.props).toMatchObject({ variant: 'compact', startsNote: 'Starts tomorrow (Sat) if you approve.' });
    expect(compact?.props.workingRows).toBeUndefined();
    expect(compact?.props.weekLine).toBeUndefined();
    expect(targetCardModel(view, { now: NIGHT, variant: 'compact' })?.props.startsNote).toBe('Starts at 5am (Sat) if you approve.');
  });

  it('lists workouts in the working', async () => {
    const { view } = await worldView({ workoutKcal: 70 });
    expect(targetCardModel(view, { now: EVENING, variant: 'full' })?.props.workingRows).toContainEqual({ label: 'Workouts added', value: '−70 a day' });
  });

  it('starts with the new week on a Sunday, with no week line', async () => {
    const { view } = await worldView({}, '2026-11-01');
    const card = targetCardModel(view, { now: new Date('2026-11-01T11:10:00.000Z'), variant: 'full' });
    expect(card?.props.startsNote).toBe('Starts tomorrow (Mon), with the new week. Today and earlier days keep their target.');
    expect(card?.props.weekLine).toBeUndefined();
  });

  it('says when the minimum holds the target up', async () => {
    const { view } = await worldView({ dailyMinimumKcal: 1600 });
    expect(targetCardModel(view, { now: EVENING, variant: 'full' })?.props).toMatchObject({
      suggestedKcal: '1,600',
      targetNote: 'At your 0.5 kg a week pace it would be 1,550, so it stays at your 1,600 minimum.',
    });
    const slowerAtMinimum = await worldView({ dailyKcal: 2000, dailyMinimumKcal: 1850 });
    expect(targetCardModel(slowerAtMinimum.view, { now: EVENING, variant: 'full' })?.slowerDetail).toBe('0.25 kg a week → 1,850 a day (your minimum)');
  });

  it('words Festive maintain and Lean bulk by maintenance', async () => {
    const festive = await worldView({ template: 'festive', maintenanceKcal: 2350, dailyKcal: 2350 });
    expect(targetCardModel(festive.view, { now: EVENING, variant: 'full' })?.props.targetNote).toBe('Festive maintain eats at your maintenance.');
    const bulk = await worldView({ template: 'leanBulk', maintenanceKcal: 2350, dailyKcal: 2550 });
    expect(targetCardModel(bulk.view, { now: EVENING, variant: 'full' })?.props.targetNote).toBe('Your maintenance plus your 200 kcal surplus.');
  });

  it('notes a kept suggestion', async () => {
    const { db } = await worldView();
    await createTargetActions(db).keepCurrentTarget({ versionId: W.ids.setupVersion }, { today: W.today });
    const view = (await getTargetView(db, { today: W.today }))!;
    const card = targetCardModel(view, { now: EVENING, variant: 'full' });
    expect(card?.kept).toBe(true);
    expect(card?.props.keptNote).toBe(
      'You kept 1,800 on Fri 30 Oct. The suggestion comes back on Fri 27 Nov, or sooner if your maintenance moves by more than 100 kcal.',
    );
    expect(screenTitle(view)).toBe('Target suggestion');
  });

  it('is undefined without a suggestion', async () => {
    const { view } = await worldView({ maintenanceKcal: 2060 });
    expect(targetCardModel(view, { now: EVENING, variant: 'full' })).toBeUndefined();
    expect(screenTitle(view)).toBe('Your target');
  });
});

describe('statusModel', () => {
  it('shows the unlock progress on the demo Friday', async () => {
    const db = createDb(`target-model-demo-${crypto.randomUUID()}`);
    opened.push(db);
    await loadDemo(db);
    const view = (await getTargetView(db, { today: '2026-10-16' }))!;
    expect(screenTitle(view)).toBe('Your target');
    expect(statusModel(view, EVENING)).toEqual({
      headline: 'Your real maintenance unlocks after 21 complete days',
      progress: { label: 'Complete days in the last 4 weeks', have: 17, need: 21 },
      body: 'The app compares what you log with your weight trend. Until then, your 1,800 target uses the maintenance estimate of ~2,350.',
      caption: "Days with a guess, not counted or not confirmed don't count.",
    });
  });

  it('asks for weigh-ins: too few, or too close together', async () => {
    const few = await worldView({ weighInEvery: 7 });
    expect(statusModel(few.view, EVENING)).toEqual({
      headline: 'Your trend needs a few more weigh-ins',
      body: "4 of 8 weigh-ins in the last 4 weeks. Weigh in most mornings and the trend shows which way you're heading.",
      action: { label: 'Log a weigh-in', to: PATHS.weight },
    });
    const recent = await worldView({ weighInsFrom: '2026-10-20' });
    expect(statusModel(recent.view, EVENING)).toMatchObject({
      headline: 'Your trend needs a few more weigh-ins',
      body: 'Your weigh-ins start on Tue 20 Oct. The trend needs 2 weeks of them to show a direction.',
      action: { label: 'Log a weigh-in', to: PATHS.weight },
    });
    // 16 weigh-ins from Wed 14 Oct, but the trend's first 10 days are still settling.
    const settling = await worldView({ weighInsFrom: '2026-10-14' });
    expect(statusModel(settling.view, EVENING)).toMatchObject({
      body: 'Your weigh-ins start on Wed 14 Oct. The trend needs 17 days of them to show a direction.',
    });
  });

  it('says the target fits when maintenance is close', async () => {
    const { view } = await worldView({ maintenanceKcal: 2060 });
    expect(statusModel(view, EVENING)).toEqual({
      headline: 'Your target fits your real maintenance',
      body: 'Your real maintenance looks like ~2,100, close to the 2,060 your target uses. Nothing to change.',
      working: 'You logged ~1,820 a day, and your trend dropped 0.25 kg a week.',
      caption: 'Checked again on Mon 2 Nov.',
    });
  });

  it('is checked again tomorrow while the estimate is a daily read', async () => {
    // Started Thu 8 Oct: the weekly window has 18 complete days, so the 28 days to yesterday are read.
    const daily = { startedOn: '2026-10-08', weighInsFrom: '2026-09-07' };
    const onTrack = await worldView({ ...daily, maintenanceKcal: 2060 });
    expect(onTrack.view.check).toMatchObject({ kind: 'onTrack', estimate: { basis: 'daily' } });
    expect(statusModel(onTrack.view, EVENING)?.caption).toBe('Checked again tomorrow.');
    expect(statusModel(onTrack.view, NIGHT)?.caption).toBe('Checked again at 5am.');

    const suggestion = await worldView(daily);
    expect(targetCardModel(suggestion.view, { now: EVENING, variant: 'full' })?.props.basis).toBe(
      'From 22 complete days, Fri 2 Oct to Thu 29 Oct. Days with a guess, not counted or not confirmed are left out. Checked again tomorrow.',
    );
    expect(targetCardModel(suggestion.view, { now: NIGHT, variant: 'full' })?.props.basis).toMatch(/ Checked again at 5am\.$/);
  });

  it('explains a target held at the minimum', async () => {
    const { view } = await worldView({ dailyKcal: 1600, dailyMinimumKcal: 1600 });
    expect(statusModel(view, EVENING)).toMatchObject({
      headline: 'Your target stays at your 1,600 minimum',
      body: 'Your real maintenance looks like ~2,100, not 2,350. At your 0.5 kg a week pace the target would be 1,550, under your 1,600 daily minimum.',
      caption: 'Checked again on Mon 2 Nov.',
    });
  });

  it('explains a target that comes out the same', async () => {
    const { view } = await worldView({ dailyKcal: 1550 });
    expect(view.check).toMatchObject({ kind: 'onTrack', sameTarget: true, atMinimum: false });
    expect(statusModel(view, EVENING)).toMatchObject({
      headline: 'Your target fits your real maintenance',
      body: 'Your real maintenance looks like ~2,100, and your 1,550 target stays the same.',
    });
  });

  it('has a line for each reason there is no target', async () => {
    const { view } = await worldView();
    expect(statusModel({ ...view, check: { kind: 'noTarget', reason: 'paused' } }, EVENING)).toEqual({
      headline: 'Your goal is paused',
      body: "There's no target to adjust while it's paused.",
    });
    expect(statusModel({ ...view, check: { kind: 'noTarget', reason: 'switching' } }, EVENING)).toEqual({
      headline: 'Your goal changes tomorrow',
      body: 'Suggestions start again once the new goal is running.',
    });
    expect(statusModel({ ...view, check: { kind: 'noTarget', reason: 'noGoal' } }, EVENING)).toEqual({
      headline: 'No target yet',
      body: 'Finish setup to get a daily target.',
    });
  });

  it('is undefined for a suggestion, and while an approved target waits to start', async () => {
    const { db, view } = await worldView();
    expect(statusModel(view, EVENING)).toBeUndefined();
    await createTargetActions(db).approveTarget({ versionId: W.ids.setupVersion, option: 'suggested', dailyKcal: 1550 }, { today: W.today });
    const after = (await getTargetView(db, { today: W.today }))!;
    expect(after.check.kind).toBe('onTrack');
    expect(statusModel(after, EVENING)).toBeUndefined();
  });
});

describe('pendingModel and historyRows', () => {
  it('shows the approved target until it starts, with Keep 1,800 instead', async () => {
    const { db, view } = await worldView();
    expect(pendingModel(view, EVENING)).toBeUndefined();
    expect(historyRows(view)).toEqual([
      {
        key: W.ids.setupVersion,
        title: '1,800 a day',
        sub: 'Since Mon 7 Sep · starting estimate · maintenance ~2,350 · 0.5 kg a week',
        badge: { tone: 'accent', label: 'Now', icon: 'now' },
      },
    ]);

    const { version } = await createTargetActions(db).approveTarget({ versionId: W.ids.setupVersion, option: 'suggested', dailyKcal: 1550 }, { today: W.today });
    const after = (await getTargetView(db, { today: W.today }))!;
    expect(pendingModel(after, EVENING)).toEqual({
      headline: 'New target 1,550 starts tomorrow (Sat)',
      body: 'Today and earlier days keep 1,800.',
      weekLine: 'This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal',
      cancelLabel: 'Keep 1,800 instead',
    });
    expect(pendingModel(after, NIGHT)?.headline).toBe('New target 1,550 starts at 5am (Sat)');
    expect(historyRows(after)).toEqual([
      {
        key: version.id,
        title: '1,550 a day',
        sub: 'From Sat 31 Oct · approved suggestion · maintenance ~2,100 · 0.5 kg a week',
        badge: { tone: 'neutral', label: 'Starts Sat', icon: 'starts' },
      },
      expect.objectContaining({ title: '1,800 a day', badge: { tone: 'accent', label: 'Now', icon: 'now' } }),
    ]);

    // Saturday: the new target is in force, the setup one is history.
    const saturday = (await getTargetView(db, { today: W.tomorrow }))!;
    expect(pendingModel(saturday, EVENING)).toBeUndefined();
    expect(historyRows(saturday).map((r) => r.sub)).toEqual([
      'Since Sat 31 Oct · approved suggestion · maintenance ~2,100 · 0.5 kg a week',
      'Mon 7 Sep to Fri 30 Oct · starting estimate · maintenance ~2,350 · 0.5 kg a week',
    ]);
    expect(historyRows(saturday)[1]?.badge).toBeUndefined();
  });

  it('says when the pace changes', async () => {
    const { db } = await worldView();
    await createTargetActions(db).approveTarget({ versionId: W.ids.setupVersion, option: 'slowerPace', dailyKcal: 1825 }, { today: W.today });
    const view = (await getTargetView(db, { today: W.today }))!;
    expect(pendingModel(view, EVENING)?.body).toBe('Today and earlier days keep 1,800. Pace becomes 0.25 kg a week.');
    expect(historyRows(view)[0]?.sub).toBe('From Sat 31 Oct · approved suggestion · maintenance ~2,100 · 0.25 kg a week');
  });

  it('offers no Keep instead for a target the user set themselves', async () => {
    const { db } = await worldView();
    const setup = (await db.goalVersions.get(W.ids.setupVersion))!;
    const edit: GoalVersion = { ...setup, id: 'version-edit', effectiveFrom: W.tomorrow, dailyKcal: 1700, reason: 'manualEdit', createdAt: W.now };
    await db.goalVersions.put(edit);
    const view = (await getTargetView(db, { today: W.today }))!;
    expect(pendingModel(view, EVENING)).toMatchObject({ headline: 'New target 1,700 starts tomorrow (Sat)' });
    expect(pendingModel(view, EVENING)?.cancelLabel).toBeUndefined();
    expect(historyRows(view)[0]?.sub).toMatch(/^From Sat 31 Oct · edited by you · /);
  });

  it('leaves the pace out for goals set by maintenance', async () => {
    const { view } = await worldView({ template: 'festive', maintenanceKcal: 2350, dailyKcal: 2350 });
    expect(historyRows(view)[0]?.sub).toBe('Since Mon 7 Sep · starting estimate · maintenance ~2,350');
  });

  it('has no Now badge and reads "From" for a goal that is not in force today (S42)', async () => {
    const { view } = await worldView();
    expect(historyRows(view, { inForce: false })).toEqual([
      { key: W.ids.setupVersion, title: '1,800 a day', sub: 'From Mon 7 Sep · starting estimate · maintenance ~2,350 · 0.5 kg a week' },
    ]);
    // The default is S37's: the goal in force.
    expect(historyRows(view)).toEqual(historyRows(view, { inForce: true }));
    expect(historyRows(view)[0]?.badge?.label).toBe('Now');
  });
});

describe('weekLineOf', () => {
  it('adds up the week, and has nothing on a Sunday', () => {
    expect(weekLineOf({ startsOn: '2026-10-31', sameWeek: true, groups: [{ days: 5, kcal: 1800 }, { days: 2, kcal: 1550 }], totalKcal: 12100 })).toBe(
      'This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal',
    );
    expect(weekLineOf({ startsOn: '2026-11-07', sameWeek: true, groups: [{ days: 6, kcal: 1800 }, { days: 1, kcal: 1550 }], totalKcal: 12350 })).toBe(
      'This week: 6 days at 1,800 + 1 day at 1,550 = 12,350 kcal',
    );
    expect(weekLineOf({ startsOn: '2026-11-02', sameWeek: false, groups: [], totalKcal: 0 })).toBeUndefined();
    expect(weekLineOf(undefined)).toBeUndefined();
  });
});

describe('decisionToast', () => {
  it('says what changed, and from when', () => {
    expect(decisionToast('approve', { kcal: 1550, when: 'tomorrow' })).toBe('Target 1,550 from tomorrow');
    expect(decisionToast('approve', { kcal: 1550, when: '5am' })).toBe('Target 1,550 from 5am');
    expect(decisionToast('slowerPace', { kcal: 1825, paceKgPerWeek: 0.25, when: 'tomorrow' })).toBe('0.25 kg a week, target 1,825 from tomorrow');
    expect(decisionToast('keep', { kcal: 1800 })).toBe('Target stays at 1,800');
    expect(decisionToast('cancel', { kcal: 1800 })).toBe('Target stays at 1,800');
  });
});
