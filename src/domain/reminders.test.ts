import { addDays, instantAt } from './day';
import {
  NOTIFICATION_URLS,
  REMINDER_KINDS,
  asleepNow,
  decideReminder,
  isQuietAt,
  logicalDayOf,
  minutesIntoLogicalDay,
  notificationPayload,
  quietWindowFor,
  reminderMessage,
  resolveReminderPrefs,
  type ReminderDayRow,
  type ReminderInput,
  type ReminderMealRow,
  type ResolvedReminderPrefs,
} from './reminders';

const TZ = 'Asia/Kuala_Lumpur';
/** Thu 22 Oct 2026. */
const TODAY = '2026-10-22';
const YESTERDAY = '2026-10-21';
const WEEK_START = '2026-10-19';
const SUNDAY = '2026-10-25';

/** Wall-clock time on a calendar date (hour 24+ reaches the next date), as an instant. */
const at = (day: string, hour: number, minute = 0, tz = TZ) => instantAt(day, hour, minute, tz);
const ms = (day: string, hour: number, minute = 0, tz = TZ) => Date.parse(at(day, hour, minute, tz));
const meal = (day: string, hour: number, minute = 0, slot = 'lunch', extra: Partial<ReminderMealRow> = {}, tz = TZ): ReminderMealRow => ({
  day,
  at: at(day, hour, minute, tz),
  slot,
  ...extra,
});
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));

function input(patch: Partial<ReminderInput> = {}, profile: ReminderInput['profile'] = {}): ReminderInput {
  return {
    profile: { timeZone: TZ, rolloverHour: 5, startedOn: '2026-09-01', ...profile },
    days: [],
    meals: [meal(addDays(TODAY, -2), 13)],
    completeDays: 0,
    periods: [],
    goals: [],
    sent: [],
    ...patch,
  };
}

const PREFS: ResolvedReminderPrefs = resolveReminderPrefs(undefined);
const quiet = (patch: Partial<Parameters<typeof quietWindowFor>[0]> = {}) =>
  quietWindowFor({ prefs: PREFS, days: [], meals: [], today: TODAY, tz: TZ, rolloverHour: 5, ...patch });

function kindOf(decision: ReturnType<typeof decideReminder>): string | null {
  return decision.due?.kind ?? null;
}

describe('quiet hours', () => {
  it('is 11pm to 8am without data', () => {
    const w = quiet();
    expect(w).toEqual({ fromMin: 1380, untilMin: 480, source: 'default' });
    expect(isQuietAt(w, 1379)).toBe(false);
    expect(isQuietAt(w, 1380)).toBe(true);
    expect(isQuietAt(w, 479)).toBe(true);
    expect(isQuietAt(w, 480)).toBe(false);
  });

  it('uses your own hours as they are, across midnight or within a day', () => {
    expect(quiet({ prefs: { quiet: { fromMin: 1380, untilMin: 480 } } })).toEqual({ fromMin: 1380, untilMin: 480, source: 'custom' });
    const sameDay = quiet({ prefs: { quiet: { fromMin: 780, untilMin: 900 } } });
    expect(sameDay).toEqual({ fromMin: 780, untilMin: 900, source: 'custom' });
    expect(isQuietAt(sameDay, 779)).toBe(false);
    expect(isQuietAt(sameDay, 800)).toBe(true);
    expect(isQuietAt(sameDay, 900)).toBe(false);
  });

  it('follows three sleep taps, and ends an hour before your first meal', () => {
    const tapDays = days('2026-10-10', 3);
    const rows: ReminderDayRow[] = tapDays.map((day, i) => ({ day, status: 'complete', sleepAt: at(day, 25, i * 30) }));
    const meals = days('2026-10-10', 5).map((day) => meal(day, 10, 40, 'breakfast'));
    // 1:00, 1:30 and 2:00am: the median 1:30 minus 30 min; 10:40 minus an hour is 9:40, rounded to 9:45.
    expect(quiet({ days: rows, meals })).toEqual({ fromMin: 60, untilMin: 585, source: 'sleepTaps' });
  });

  it('with two taps, follows your meals: an hour after the last, an hour before the first', () => {
    const rows: ReminderDayRow[] = days('2026-10-10', 2).map((day) => ({ day, status: 'complete', sleepAt: at(day, 25) }));
    const meals = days('2026-10-10', 5).flatMap((day) => [meal(day, 10, 30, 'breakfast'), meal(day, 23, 30, 'supper')]);
    expect(quiet({ days: rows, meals })).toEqual({ fromMin: 30, untilMin: 570, source: 'meals' });
  });

  it('ignores guesses and days outside the last 28', () => {
    const meals = [
      ...days('2026-10-10', 5).map((day) => meal(day, 10, 30, 'breakfast', { guess: true })),
      ...days('2026-09-01', 5).map((day) => meal(day, 10, 30, 'breakfast')),
    ];
    expect(quiet({ meals }).source).toBe('default');
  });

  it('keeps the window between 6 and 14 hours long', () => {
    const short = days('2026-10-10', 5).flatMap((day) => [meal(day, 9, 0, 'breakfast'), meal(day, 27, 0, 'supper')]);
    // 4am to 8am grows to 4am to 10am.
    expect(quiet({ meals: short })).toEqual({ fromMin: 240, untilMin: 600, source: 'meals' });
    const long = days('2026-10-10', 5).flatMap((day) => [meal(day, 9, 0, 'breakfast'), meal(day, 13, 0, 'lunch')]);
    // 2pm to 8am (18 hours) shrinks to 6pm to 8am.
    expect(quiet({ meals: long })).toEqual({ fromMin: 1080, untilMin: 480, source: 'meals' });
  });

  it('is asleep after a Going to sleep tap, until a meal is logged after it', () => {
    const rows: ReminderDayRow[] = [{ day: TODAY, status: 'unconfirmed', sleepAt: at(TODAY, 24, 40) }];
    expect(asleepNow({ days: rows, meals: [], today: TODAY, nowMs: ms(TODAY, 27) })).toBe(true);
    expect(asleepNow({ days: rows, meals: [meal(TODAY, 25, 30, 'supper')], today: TODAY, nowMs: ms(TODAY, 27) })).toBe(false);
    expect(asleepNow({ days: rows, meals: [], today: TODAY, nowMs: ms(TODAY, 24, 30) })).toBe(false);
    expect(asleepNow({ days: rows, meals: [], today: YESTERDAY, nowMs: ms(TODAY, 27) })).toBe(false);
  });

  it('puts a 4am tap on a different logical day with rollover 3 than with rollover 5', () => {
    const tap = ms('2026-10-23', 4);
    expect(logicalDayOf(tap, TZ, 3)).toBe('2026-10-23');
    expect(logicalDayOf(tap, TZ, 5)).toBe('2026-10-22');
    expect(minutesIntoLogicalDay(tap, TZ, 3)).toBe(60);
    expect(minutesIntoLogicalDay(tap, TZ, 5)).toBe(1380);
  });
});

describe('morning check-in', () => {
  it('goes at 10am when yesterday is not confirmed and you logged recently', () => {
    expect(decideReminder(input(), ms(TODAY, 9, 59))).toEqual({ due: null, reason: 'nothingDue' });
    const decision = decideReminder(input(), ms(TODAY, 10));
    expect(decision.due).toEqual({
      kind: 'checkIn',
      localDate: TODAY,
      title: 'Quick check',
      body: "Was yesterday's log complete?",
      url: '/?sheet=checkin',
      ttlSeconds: 14400,
      topic: 'km-checkIn',
    });
  });

  it.each(['complete', 'guess', 'notCounted', 'paused'])('says nothing when yesterday is %s', (status) => {
    expect(decideReminder(input({ days: [{ day: YESTERDAY, status }] }), ms(TODAY, 10)).due).toBeNull();
  });

  it('asks about an unconfirmed yesterday, or one with no record', () => {
    expect(kindOf(decideReminder(input({ days: [{ day: YESTERDAY, status: 'unconfirmed' }] }), ms(TODAY, 10)))).toBe('checkIn');
    expect(kindOf(decideReminder(input({ days: [] }), ms(TODAY, 10)))).toBe('checkIn');
  });

  it('says nothing about a day before the app was in use', () => {
    expect(decideReminder(input({ meals: [meal(TODAY, 9)] }, { startedOn: TODAY }), ms(TODAY, 10)).due).toBeNull();
  });

  it('says nothing about a day in a Pause, with a tie broken by when the switch was booked', () => {
    const goals = [
      { id: 'cut', template: 'cut' },
      { id: 'pause', template: 'pause' },
    ];
    const pausedLater = [
      { id: 'a', goalId: 'cut', from: YESTERDAY, createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'b', goalId: 'pause', from: YESTERDAY, createdAt: '2026-10-20T00:00:00.000Z' },
    ];
    expect(decideReminder(input({ periods: pausedLater, goals }), ms(TODAY, 10)).due).toBeNull();
    const cutLater = [
      { id: 'a', goalId: 'cut', from: YESTERDAY, createdAt: '2026-10-20T00:00:00.000Z' },
      { id: 'b', goalId: 'pause', from: YESTERDAY, createdAt: '2026-10-01T00:00:00.000Z' },
    ];
    expect(kindOf(decideReminder(input({ periods: cutLater, goals }), ms(TODAY, 10)))).toBe('checkIn');
    const ended = [{ id: 'b', goalId: 'pause', from: '2026-10-01', to: YESTERDAY }];
    expect(kindOf(decideReminder(input({ periods: ended, goals }), ms(TODAY, 10)))).toBe('checkIn');
  });

  it('follows your settings: off, an earlier time, and quiet hours that run past it', () => {
    expect(decideReminder(input({}, { reminders: { checkIn: false } }), ms(TODAY, 10)).due).toBeNull();
    expect(kindOf(decideReminder(input({}, { reminders: { checkInAtMin: 480 } }), ms(TODAY, 8)))).toBe('checkIn');
    const late = { reminders: { checkInAtMin: 480, quiet: { fromMin: 1380, untilMin: 585 } } };
    expect(decideReminder(input({}, late), ms(TODAY, 8))).toEqual({ due: null, reason: 'quiet' });
    expect(kindOf(decideReminder(input({}, late), ms(TODAY, 9, 45)))).toBe('checkIn');
  });

  it('goes within 8 hours of the time only', () => {
    expect(kindOf(decideReminder(input(), ms(TODAY, 17, 59)))).toBe('checkIn');
    expect(decideReminder(input(), ms(TODAY, 18)).due).toBeNull();
  });

  it("doesn't nag a break: nothing logged in 3 days", () => {
    expect(decideReminder(input({ meals: [meal(addDays(TODAY, -4), 13)] }), ms(TODAY, 10)).due).toBeNull();
    expect(decideReminder(input({ meals: [meal(addDays(TODAY, -2), 13, 0, 'lunch', { guess: true })] }), ms(TODAY, 10)).due).toBeNull();
  });

  it('is never proposed twice for a day: the next kind is considered', () => {
    const targetNotice = { key: 'v1:2026-10-19', weekStart: WEEK_START, weeks: 4, markedAt: at(TODAY, 8) };
    const sent = [{ kind: 'checkIn', date: TODAY, at: at(TODAY, 10) }];
    expect(kindOf(decideReminder(input({ sent, targetNotice }), ms(TODAY, 12)))).toBe('targetSuggestion');
  });

  it('follows the profile zone: London in summer time, New York', () => {
    const london = { timeZone: 'Europe/London' };
    const londonMeals = [meal(addDays(TODAY, -2), 13, 0, 'lunch', {}, 'Europe/London')];
    expect(decideReminder(input({ meals: londonMeals }, london), Date.parse('2026-10-22T08:59:00.000Z')).due).toBeNull();
    const due = decideReminder(input({ meals: londonMeals }, london), Date.parse('2026-10-22T09:00:00.000Z')).due;
    expect(due).toMatchObject({ kind: 'checkIn', localDate: TODAY });

    const ny = { timeZone: 'America/New_York' };
    const nyMeals = [meal(addDays(TODAY, -2), 13, 0, 'lunch', {}, 'America/New_York')];
    // 1:59pm UTC is 9:59am in New York.
    expect(decideReminder(input({ meals: nyMeals }, ny), Date.parse('2026-10-22T13:59:00.000Z')).due).toBeNull();
    expect(decideReminder(input({ meals: nyMeals }, ny), Date.parse('2026-10-22T14:00:00.000Z')).due).toMatchObject({ kind: 'checkIn', localDate: TODAY });
    // 3am UTC on the 23rd is 11am on the 23rd in Kuala Lumpur, and still 11pm on the 22nd in New York.
    expect(logicalDayOf(Date.parse('2026-10-23T03:00:00.000Z'), 'America/New_York', 5)).toBe(TODAY);
    expect(logicalDayOf(Date.parse('2026-10-23T03:00:00.000Z'), TZ, 5)).toBe('2026-10-23');
  });
});

describe('gap nudges', () => {
  interface GapWorld {
    complete?: number;
    lunch?: [number, number] | null;
    dinner?: [number, number] | null;
    breakfast?: [number, number] | null;
    extra?: (day: string) => ReminderMealRow[];
    today?: ReminderMealRow[];
    reminders?: unknown;
    status?: string;
  }

  /** The `complete` days before today each with the usual meals, and `today`'s meals. */
  function gapWorld(w: GapWorld = {}): ReminderInput {
    const count = w.complete ?? 14;
    const history = days(addDays(TODAY, -count), count);
    const usual = (day: string): ReminderMealRow[] => [
      ...(w.breakfast ? [meal(day, w.breakfast[0], w.breakfast[1], 'breakfast')] : []),
      ...(w.lunch === null ? [] : [meal(day, ...(w.lunch ?? [13, 30]), 'lunch')]),
      ...(w.dinner === null ? [] : [meal(day, ...(w.dinner ?? [20, 30]), 'dinner')]),
      ...(w.extra?.(day) ?? []),
    ];
    return input(
      {
        days: history.map((day) => ({ day, status: w.status ?? 'complete' })),
        meals: [...history.flatMap(usual), ...(w.today ?? [meal(TODAY, 13, 0, 'lunch')])],
        completeDays: w.status === undefined || w.status === 'complete' ? count : 0,
      },
      w.reminders === undefined ? {} : { reminders: w.reminders },
    );
  }

  it('switches on at 14 complete days', () => {
    expect(decideReminder(gapWorld({ complete: 13 }), ms(TODAY, 21, 15)).due).toBeNull();
    expect(kindOf(decideReminder(gapWorld({ complete: 14 }), ms(TODAY, 21, 15)))).toBe('gap');
  });

  it('nudges about dinner 6+ hours after lunch, once its usual time has passed by 45 minutes', () => {
    expect(decideReminder(gapWorld(), ms(TODAY, 21, 14)).due).toBeNull();
    expect(decideReminder(gapWorld(), ms(TODAY, 21, 15)).due).toEqual({
      kind: 'gap',
      localDate: TODAY,
      title: '8 hours since your last log',
      body: 'Dinner time for you?',
      url: '/',
      ttlSeconds: 3600,
      topic: 'km-gap',
    });
  });

  it('says nothing once dinner is logged, or under 6 hours after the last meal', () => {
    expect(decideReminder(gapWorld({ today: [meal(TODAY, 13, 0, 'lunch'), meal(TODAY, 20, 0, 'dinner')] }), ms(TODAY, 21, 15)).due).toBeNull();
    expect(decideReminder(gapWorld({ today: [meal(TODAY, 13, 0, 'lunch'), meal(TODAY, 16, 0, 'snack')] }), ms(TODAY, 21, 15)).due).toBeNull();
  });

  it('with nothing logged today, nudges an hour after the usual breakfast', () => {
    const world = gapWorld({ breakfast: [10, 30], today: [] });
    expect(decideReminder(world, ms(TODAY, 11, 29)).due).toBeNull();
    expect(decideReminder(world, ms(TODAY, 11, 30)).due).toMatchObject({
      kind: 'gap',
      title: 'Nothing logged yet today',
      body: 'Breakfast time for you?',
    });
  });

  it('stops being useful 3 hours after the usual time', () => {
    const world = gapWorld({ reminders: { quiet: { fromMin: 120, untilMin: 480 } } });
    expect(kindOf(decideReminder(world, ms(TODAY, 23, 30)))).toBe('gap');
    expect(decideReminder(world, ms(TODAY, 23, 45))).toEqual({ due: null, reason: 'nothingDue' });
  });

  it('never nudges toward a snack or a supper', () => {
    const snack = gapWorld({ dinner: null, lunch: [12, 0], extra: (day) => [meal(day, 19, 30, 'snack')], today: [meal(TODAY, 12, 0, 'lunch')] });
    expect(decideReminder(snack, ms(TODAY, 20, 30))).toEqual({ due: null, reason: 'nothingDue' });
    const supper = gapWorld({
      dinner: null,
      lunch: [12, 0],
      extra: (day) => [meal(day, 22, 0, 'supper')],
      today: [meal(TODAY, 12, 0, 'lunch')],
      reminders: { quiet: { fromMin: 120, untilMin: 480 } },
    });
    expect(decideReminder(supper, ms(TODAY, 23))).toEqual({ due: null, reason: 'nothingDue' });
  });

  it("doesn't count a slot that's on fewer than half the days as usual", () => {
    const world = gapWorld({ dinner: null, extra: (day) => (day >= addDays(TODAY, -6) ? [meal(day, 20, 30, 'dinner')] : []) });
    expect(decideReminder(world, ms(TODAY, 21, 15))).toEqual({ due: null, reason: 'nothingDue' });
  });

  it('learns the usual times from complete days only', () => {
    const world = gapWorld({ status: 'unconfirmed' });
    world.completeDays = 14;
    expect(decideReminder(world, ms(TODAY, 21, 15)).due).toBeNull();
  });

  it('says nothing in quiet hours, after a sleep tap, on a paused day, when off, or once sent today', () => {
    const world = gapWorld();
    const now = ms(TODAY, 21, 15);
    expect(decideReminder({ ...world, profile: { ...world.profile, reminders: { quiet: { fromMin: 1260, untilMin: 480 } } } }, now)).toEqual({
      due: null,
      reason: 'quiet',
    });
    expect(decideReminder({ ...world, days: [...world.days, { day: TODAY, status: 'unconfirmed', sleepAt: at(TODAY, 21) }] }, now)).toEqual({
      due: null,
      reason: 'asleep',
    });
    expect(decideReminder({ ...world, days: [...world.days, { day: TODAY, status: 'paused' }] }, now).due).toBeNull();
    expect(decideReminder({ ...world, profile: { ...world.profile, reminders: { gapNudges: false } } }, now).due).toBeNull();
    expect(decideReminder({ ...world, sent: [{ kind: 'gap', date: TODAY, at: at(TODAY, 18) }] }, now).due).toBeNull();
  });
});

describe('weekly review', () => {
  const week = (patch: Partial<ReminderInput> = {}, profile: ReminderInput['profile'] = {}) =>
    input({ days: [{ day: '2026-10-24', status: 'complete' }], meals: [meal('2026-10-21', 13), meal('2026-10-24', 13)], ...patch }, profile);

  it('goes on Sunday from 8pm, for the week starting Monday', () => {
    expect(decideReminder(week(), ms(SUNDAY, 19, 59)).due).toBeNull();
    expect(decideReminder(week(), ms(SUNDAY, 20)).due).toEqual({
      kind: 'weeklyReview',
      localDate: WEEK_START,
      title: 'Your week is ready',
      body: 'See how it went and pick one thing to try next week.',
      url: '/insights/weekly',
      ttlSeconds: 14400,
      topic: 'km-weeklyReview',
    });
    expect(decideReminder(week({ days: [{ day: '2026-10-23', status: 'complete' }] }), ms('2026-10-24', 20)).due).toBeNull();
  });

  it('still counts after midnight before the rollover, if quiet hours allow', () => {
    const now = ms('2026-10-26', 1);
    expect(decideReminder(week({}, { reminders: { quiet: { fromMin: 180, untilMin: 540 } } }), now).due).toMatchObject({
      kind: 'weeklyReview',
      localDate: WEEK_START,
    });
    expect(decideReminder(week(), now)).toEqual({ due: null, reason: 'quiet' });
  });

  it('waits for day 7, a meal this week, and your setting', () => {
    expect(decideReminder(week({}, { startedOn: '2026-10-20' }), ms(SUNDAY, 20)).due).toBeNull();
    expect(kindOf(decideReminder(week({}, { startedOn: '2026-10-19' }), ms(SUNDAY, 20)))).toBe('weeklyReview');
    expect(decideReminder(week({ meals: [meal('2026-10-17', 13)] }), ms(SUNDAY, 20)).due).toBeNull();
    expect(decideReminder(week({}, { reminders: { weeklyReview: false } }), ms(SUNDAY, 20)).due).toBeNull();
    expect(decideReminder(week({ sent: [{ kind: 'weeklyReview', date: WEEK_START, at: at(SUNDAY, 9) }] }), ms(SUNDAY, 20)).due).toBeNull();
  });

  it('follows New York: Sunday 8pm there is Monday midnight UTC', () => {
    const ny = { timeZone: 'America/New_York' };
    const meals = [meal('2026-10-24', 13, 0, 'lunch', {}, 'America/New_York')];
    expect(decideReminder(week({ meals }, ny), Date.parse('2026-10-26T00:00:00.000Z')).due).toMatchObject({
      kind: 'weeklyReview',
      localDate: WEEK_START,
    });
  });
});

describe('target suggestion', () => {
  const mark = { key: 'version-1:2026-10-19', weekStart: WEEK_START, weeks: 4, markedAt: at(TODAY, 9) };
  const target = (patch: Partial<typeof mark> & { seenAt?: string } = {}, profile: ReminderInput['profile'] = {}) =>
    input({ days: [{ day: YESTERDAY, status: 'complete' }], meals: [meal(YESTERDAY, 13)], targetNotice: { ...mark, ...patch } }, profile);

  it('goes 2 hours after the mark, in the daytime', () => {
    expect(decideReminder(target(), ms(TODAY, 12)).due).toEqual({
      kind: 'targetSuggestion',
      localDate: WEEK_START,
      title: 'New target suggestion',
      body: 'Based on 4 weeks of data.',
      url: '/insights/target',
      ttlSeconds: 43200,
      topic: 'km-targetSuggestion',
    });
  });

  it('never goes once seen, too soon, too late in the day, for last week, or when off', () => {
    expect(decideReminder(target({ seenAt: at(TODAY, 10) }), ms(TODAY, 12)).due).toBeNull();
    expect(decideReminder(target({ markedAt: at(TODAY, 11) }), ms(TODAY, 12)).due).toBeNull();
    expect(decideReminder(target(), ms(TODAY, 21, 30)).due).toBeNull();
    expect(decideReminder(target({ weekStart: '2026-10-12', markedAt: at('2026-10-16', 9) }), ms(TODAY, 12)).due).toBeNull();
    expect(decideReminder(target({}, { reminders: { targetSuggestion: false } }), ms(TODAY, 12)).due).toBeNull();
  });

  it('never goes once any device has seen it, even when a later mark lost its seenAt', () => {
    // A device that marked it again before its first pull overwrote the seen mark; the seen row stays.
    const seenElsewhere = target();
    seenElsewhere.targetNoticeSeen = { key: mark.key, seenAt: at(TODAY, 8) };
    expect(decideReminder(seenElsewhere, ms(TODAY, 12))).toEqual({ due: null, reason: 'nothingDue' });

    const seenAnother = target();
    seenAnother.targetNoticeSeen = { key: 'version-0:2026-10-12', seenAt: at('2026-10-13', 8) };
    expect(kindOf(decideReminder(seenAnother, ms(TODAY, 12)))).toBe('targetSuggestion');
  });

  it('says 3 weeks when the mark has no count', () => {
    const world = target();
    world.targetNotice = { key: mark.key, weekStart: WEEK_START, markedAt: mark.markedAt };
    expect(decideReminder(world, ms(TODAY, 12)).due?.body).toBe('Based on 3 weeks of data.');
  });
});

describe('order, spacing and odd input', () => {
  it('sends the check-in before a target suggestion', () => {
    const world = input({ targetNotice: { key: 'v:1', weekStart: WEEK_START, weeks: 4, markedAt: at(TODAY, 8) } });
    expect(kindOf(decideReminder(world, ms(TODAY, 12)))).toBe('checkIn');
  });

  it('keeps an hour between reminders', () => {
    expect(decideReminder(input({ sent: [{ kind: 'gap', date: YESTERDAY, at: at(TODAY, 9, 30) }] }), ms(TODAY, 10))).toEqual({
      due: null,
      reason: 'spacing',
    });
  });

  it('lets a gap nudge go 2 hours after the check-in', () => {
    const history = days(addDays(TODAY, -14), 14);
    const world = input({
      days: history.map((day) => ({ day, status: 'complete' })),
      meals: [...history.flatMap((day) => [meal(day, 13, 30), meal(day, 20, 30, 'dinner')]), meal(TODAY, 13)],
      completeDays: 14,
      sent: [{ kind: 'checkIn', date: TODAY, at: at(TODAY, 19, 15) }],
    });
    expect(kindOf(decideReminder(world, ms(TODAY, 21, 15)))).toBe('gap');
  });

  it('skips a user without a profile, in demo mode, or with a zone it does not know', () => {
    expect(decideReminder({ ...input(), profile: undefined }, ms(TODAY, 10))).toEqual({ due: null, reason: 'noProfile' });
    expect(decideReminder(input({}, { startedOn: undefined }), ms(TODAY, 10))).toEqual({ due: null, reason: 'noProfile' });
    expect(decideReminder(input({}, { demoMode: true }), ms(TODAY, 10))).toEqual({ due: null, reason: 'demo' });
    expect(decideReminder(input({}, { timeZone: 'Not/AZone' }), ms(TODAY, 10))).toEqual({ due: null, reason: 'badContext' });
    expect(decideReminder(input({}, { startedOn: 'soon' }), ms(TODAY, 10))).toEqual({ due: null, reason: 'badContext' });
  });

  it('reads an impossible rollover hour as 5am', () => {
    // Monday 4:30am is still Sunday night with a 5am rollover.
    const world = input(
      { meals: [meal('2026-10-24', 13)] },
      { rolloverHour: 30, reminders: { quiet: { fromMin: 360, untilMin: 540 } } },
    );
    expect(decideReminder(world, ms('2026-10-26', 4, 30)).due).toMatchObject({ kind: 'weeklyReview', localDate: WEEK_START });
  });
});

describe('resolveReminderPrefs', () => {
  const DEFAULTS = { checkIn: true, checkInAtMin: 600, gapNudges: true, weeklyReview: true, targetSuggestion: true, quiet: null };

  it('fills in the defaults for anything missing or odd', () => {
    expect(resolveReminderPrefs(undefined)).toEqual(DEFAULTS);
    expect(resolveReminderPrefs('on')).toEqual(DEFAULTS);
    expect(resolveReminderPrefs([])).toEqual(DEFAULTS);
    expect(resolveReminderPrefs({ checkIn: 'no', gapNudges: 0, weeklyReview: null, targetSuggestion: 'false' })).toEqual(DEFAULTS);
    expect(resolveReminderPrefs({ checkInAtMin: 430 }).checkInAtMin).toBe(600);
    expect(resolveReminderPrefs({ checkInAtMin: 300 }).checkInAtMin).toBe(600);
    expect(resolveReminderPrefs({ checkInAtMin: '540' }).checkInAtMin).toBe(600);
    expect(resolveReminderPrefs({ quiet: { fromMin: 480, untilMin: 480 } }).quiet).toBeNull();
    expect(resolveReminderPrefs({ quiet: { fromMin: 1380, untilMin: 1450 } }).quiet).toBeNull();
    expect(resolveReminderPrefs({ quiet: { fromMin: 1381, untilMin: 480 } }).quiet).toBeNull();
  });

  it('keeps what is set', () => {
    expect(
      resolveReminderPrefs({ checkIn: false, checkInAtMin: 540, gapNudges: false, weeklyReview: false, targetSuggestion: false, quiet: { fromMin: 0, untilMin: 420 } }),
    ).toEqual({ checkIn: false, checkInAtMin: 540, gapNudges: false, weeklyReview: false, targetSuggestion: false, quiet: { fromMin: 0, untilMin: 420 } });
  });
});

describe('messages', () => {
  const messages = [
    ...REMINDER_KINDS.map((kind) => reminderMessage(kind, { slot: 'lunch', weeks: 4 })),
    reminderMessage('gap', { slot: 'dinner', hours: 7.9 }),
    reminderMessage('test'),
  ];

  it.each(messages.flatMap((m) => [m.title, m.body]))('"%s" follows the copy rules', (text) => {
    expect(text).not.toMatch(/!|please|successfully/i);
    expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
    expect(text.charAt(0)).toMatch(/[A-Z0-9]/);
  });

  it('says how long it has been, in whole hours', () => {
    expect(reminderMessage('gap', { slot: 'dinner', hours: 7.9 })).toEqual({ title: '7 hours since your last log', body: 'Dinner time for you?' });
    expect(reminderMessage('test')).toEqual({ title: 'Test notification', body: 'Reminders from Kira Makan show up like this.' });
  });

  it('builds the payload the worker reads', () => {
    expect(JSON.parse(notificationPayload('checkIn', reminderMessage('checkIn')))).toEqual({
      v: 1,
      kind: 'checkIn',
      title: 'Quick check',
      body: "Was yesterday's log complete?",
      url: NOTIFICATION_URLS.checkIn,
    });
  });
});
