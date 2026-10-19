// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import type { Macros, MealLog } from '@/domain/types';
import { byId } from '@/data/catalogue';
import { computeWeekBudget } from '@/domain/budget';
import { DEMO_CATALOGUE_IDS, DEMO_EXPECTED, DEMO_IDS, buildDemoWorld, loadDemo } from './demo';
import { dayRange } from './time';

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

function mealMacros(meal: MealLog): Macros {
  return meal.items.reduce<Macros>(
    (acc, item) => ({
      kcal: acc.kcal + item.unitMacros.kcal * item.quantity,
      proteinG: acc.proteinG + item.unitMacros.proteinG * item.quantity,
      carbsG: acc.carbsG + item.unitMacros.carbsG * item.quantity,
      fatG: acc.fatG + item.unitMacros.fatG * item.quantity,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

const kcalOf = (meals: MealLog[]): number => sum(meals.map((m) => mealMacros(m).kcal));

/** Independent of the engine: MYT is UTC+8 and the day rolls over at 5am, so shift by +3h. */
const logicalDayFor = (instant: string): string => new Date(Date.parse(instant) + 3 * 3_600_000).toISOString().slice(0, 10);

/** Malaysian wall-clock minutes after midnight. */
const mytMinutes = (instant: string): number => {
  const d = new Date(Date.parse(instant) + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

const DRINK_IDS = new Set(['teh-tarik', 'milo-ais', 'teh-o-ais', 'kopi']);
const NOODLE_IDS = new Set(['mee-rebus', 'maggi-home', 'char-kuey-teow', 'bihun-goreng-mamak']);
const SNACK_IDS = new Set(['roti-canai-dhal', 'roti-telur-dhal', 'kuih-lapis', 'karipap', 'biskut', 'kaya-toast', 'kaya-toast-kopi']);

describe('demo world', () => {
  const world = buildDemoWorld();
  const mealsOn = (day: string): MealLog[] => world.meals.filter((m) => m.logicalDay === day);

  it('has the sample profile', () => {
    expect(world.profile).toMatchObject({
      id: 'me',
      age: 30,
      sex: 'male',
      heightCm: 172,
      weightKgAtSetup: 78.6,
      activity: 'light',
      timeZone: 'Asia/Kuala_Lumpur',
      rolloverHour: 5,
      weekStartsOn: 1,
      dailyMinimumKcal: 1400,
      theme: 'system',
      keepPhotos: true,
      useLocation: true,
      startedOn: '2026-09-28',
      demoMode: true,
    });
    expect(world.profile.name).toBeUndefined();
    expect(world.profile.setupCompletedAt).toMatch(/^2026-09-28T/);
  });

  it('has the goal library with versions and the Cut period', () => {
    const status = Object.fromEntries(world.goals.map((g) => [g.id, g.status]));
    expect(status).toEqual({
      [DEMO_IDS.goals.cut]: 'active',
      [DEMO_IDS.goals.festive]: 'saved',
      [DEMO_IDS.goals.leanBulk]: 'draft',
      [DEMO_IDS.goals.pause]: 'template',
    });
    const byGoal = Object.fromEntries(world.goalVersions.map((v) => [v.goalId, v]));
    expect(byGoal[DEMO_IDS.goals.cut]).toMatchObject({ effectiveFrom: '2026-09-28', dailyKcal: 1800, proteinG: 110, carbsG: 180, fatG: 60, maintenanceKcal: 2350, reason: 'setup' });
    expect(byGoal[DEMO_IDS.goals.festive]).toMatchObject({ dailyKcal: 2100, proteinG: 110, carbsG: 230, fatG: 70, maintenanceKcal: 2100 });
    expect(byGoal[DEMO_IDS.goals.leanBulk]).toMatchObject({ dailyKcal: 2300, proteinG: 130, carbsG: 260, fatG: 75, maintenanceKcal: 2100 });
    expect(byGoal[DEMO_IDS.goals.pause]).toBeUndefined();
    expect(world.goalPeriods).toEqual([{ id: DEMO_IDS.goalPeriods.cut, goalId: DEMO_IDS.goals.cut, from: '2026-09-28' }]);
  });

  it('logs this week at 1,620 / 1,710 / 1,540 / 1,680 with 3–4 meals a day', () => {
    for (const [day, kcal] of Object.entries(DEMO_EXPECTED.thisWeekDayKcal)) {
      expect(kcalOf(mealsOn(day)), day).toBe(kcal);
      expect(mealsOn(day).length).toBeGreaterThanOrEqual(3);
      expect(mealsOn(day).length).toBeLessThanOrEqual(4);
    }
  });

  it("has today's two meals exactly as designed", () => {
    const today = mealsOn('2026-10-16');
    expect(today.map((m) => m.id)).toEqual([DEMO_IDS.meals.todayBreakfast, DEMO_IDS.meals.todayLunch]);
    const [breakfast, lunch] = today;

    expect(breakfast).toMatchObject({
      eatenAt: '2026-10-16T02:40:00.000Z',
      slot: 'breakfast',
      name: 'Roti canai + teh tarik',
      method: 'text',
      placeId: DEMO_IDS.places.nasiKandar,
      priceRm: 4.8,
    });
    expect(breakfast?.text).toBeTruthy();
    expect(breakfast?.items.map((i) => [i.name, i.unitMacros.kcal * i.quantity])).toEqual([
      ['Roti canai + dhal', 360],
      ['Teh tarik', 200],
    ]);

    expect(lunch).toMatchObject({
      eatenAt: '2026-10-16T06:15:00.000Z',
      slot: 'lunch',
      name: 'Economy rice',
      method: 'plate',
      placeId: DEMO_IDS.places.kedai,
      priceRm: 9.5,
    });
    expect(lunch?.items.map((i) => [i.name, i.unitMacros.kcal * i.quantity])).toEqual([
      ['Rice', 200],
      ['Ayam masak merah', 250],
      ['Kangkung belacan', 90],
      ['Kubis goreng', 70],
      ['Kuah on rice', 60],
    ]);
    expect(lunch?.items[0]?.variants?.[lunch.items[0].selectedVariant ?? -1]?.label).toBe('1 scoop');
    expect(lunch?.items[4]?.variants?.[lunch.items[4].selectedVariant ?? -1]?.label).toBe('Some');

    const b = mealMacros(breakfast as MealLog);
    const l = mealMacros(lunch as MealLog);
    expect([b.kcal, b.proteinG, b.carbsG]).toEqual([560, 14, 70]);
    expect(b.fatG).toBeCloseTo(22, 5);
    expect([l.kcal, l.proteinG, l.carbsG]).toEqual([670, 28, 75]);
    expect(l.fatG).toBeCloseTo(30, 5);
    expect(kcalOf(today)).toBe(DEMO_EXPECTED.today.kcal);
    expect(world.days.find((d) => d.logicalDay === '2026-10-16')).toBeUndefined();
  });

  it('adds up to the design budget for this week', () => {
    const finished = Object.values(DEMO_EXPECTED.thisWeekDayKcal);
    const saved = sum(finished.map((k) => DEMO_EXPECTED.dailyKcal - k));
    const eatenToday = kcalOf(mealsOn('2026-10-16'));
    expect(saved).toBe(DEMO_EXPECTED.savedThisWeekKcal);
    expect(sum(finished) + eatenToday).toBe(DEMO_EXPECTED.eatenSoFarKcal);
    expect(DEMO_EXPECTED.dailyKcal - eatenToday).toBe(DEMO_EXPECTED.leftTodayKcal);
    expect(DEMO_EXPECTED.weeklyBudgetKcal - DEMO_EXPECTED.eatenSoFarKcal).toBe(DEMO_EXPECTED.leftThisWeekKcal);
    // Today is under budget, so Saturday gets its own 1,800 plus everything saved.
    expect(DEMO_EXPECTED.dailyKcal + saved).toBe(DEMO_EXPECTED.makanRoomKcal);
  });

  it('logs last week with a makan Saturday over and a Sunday not counted', () => {
    for (const [day, kcal] of Object.entries(DEMO_EXPECTED.lastWeekDayKcal)) {
      expect(kcalOf(mealsOn(day)), day).toBe(kcal);
    }
    const lastWeekDays = dayRange('2026-10-05', '2026-10-11');
    const records = world.days.filter((d) => lastWeekDays.includes(d.logicalDay));
    expect(records).toHaveLength(7);
    expect(records.filter((d) => d.status === 'complete')).toHaveLength(DEMO_EXPECTED.lastWeek.completeDays);
    expect(records.find((d) => d.logicalDay === '2026-10-11')?.status).toBe('notCounted');

    const logged = kcalOf(world.meals.filter((m) => lastWeekDays.includes(m.logicalDay)));
    expect(logged).toBe(DEMO_EXPECTED.lastWeek.loggedKcal);
  });

  it('gives the engine the design’s +350 for last week, with the futsal in the budget', () => {
    const lastWeekDays = dayRange(DEMO_EXPECTED.lastWeekStart, '2026-10-11');
    const status = new Map(world.days.map((d) => [d.logicalDay, d.status]));
    const budget = computeWeekBudget({
      days: lastWeekDays.map((day) => ({
        day,
        targetKcal: DEMO_EXPECTED.dailyKcal,
        eatenKcal: kcalOf(mealsOn(day)),
        workoutKcal: sum(world.workouts.filter((w) => w.logicalDay === day).map((w) => w.netKcal)),
        bonusKcal: 0,
        status: status.get(day) ?? null,
      })),
      today: DEMO_EXPECTED.today.day,
      dailyMinimumKcal: DEMO_EXPECTED.dailyMinimumKcal,
    });
    expect(budget.weeklyBudgetKcal).toBe(DEMO_EXPECTED.lastWeek.weeklyBudgetKcal);
    expect(sum(budget.days.map((d) => d.countedKcal))).toBe(DEMO_EXPECTED.lastWeek.countedKcal);
    expect(-budget.savedKcal).toBe(DEMO_EXPECTED.lastWeek.overBudgetKcal);
    // Only the makan Saturday goes over; the futsal Tuesday stays under its 2,270.
    expect(budget.days.filter((d) => d.kind === 'over').map((d) => d.day)).toEqual([DEMO_EXPECTED.lastWeek.makanDay]);
    expect(budget.days.at(-1)?.kind).toBe('notCounted');
  });

  describe('last week, as the weekly review sees it', () => {
    const lastWeek = world.meals.filter((m) => m.logicalDay >= '2026-10-05' && m.logicalDay <= '2026-10-11');
    const items = lastWeek.flatMap((m) => m.items.map((item) => ({ meal: m, item, kcal: item.unitMacros.kcal * item.quantity })));

    it('has 8 teh tarik (3 kurang) and 3 milo ais, ~2,200 kcal of drinks', () => {
      const drinks = items.filter(({ item }) => DRINK_IDS.has(item.catalogueId ?? ''));
      const tehTarik = drinks.filter(({ item }) => item.catalogueId === 'teh-tarik');
      const kurang = tehTarik.filter(({ item }) => item.variants?.[item.selectedVariant ?? -1]?.id === 'kurang');
      expect(drinks).toHaveLength(DEMO_EXPECTED.lastWeek.drinks.count);
      expect(tehTarik).toHaveLength(8);
      expect(kurang).toHaveLength(DEMO_EXPECTED.lastWeek.drinks.tehTarikKurang);
      expect(drinks.filter(({ item }) => item.catalogueId === 'milo-ais')).toHaveLength(3);
      expect(sum(drinks.map((d) => d.kcal))).toBe(DEMO_EXPECTED.lastWeek.drinks.kcal);
      expect(Math.round(DEMO_EXPECTED.lastWeek.drinks.kcal / 100) * 100).toBe(2200);
      const avgTehTarik = sum(tehTarik.map((d) => d.kcal)) / tehTarik.length;
      expect(avgTehTarik).toBeGreaterThanOrEqual(170);
      expect(avgTehTarik).toBeLessThanOrEqual(190);
    });

    it('has 4 nasi kandar nights at 950 each, RM 58', () => {
      const visits = lastWeek.filter((m) => m.placeId === DEMO_IDS.places.nasiKandar);
      expect(visits).toHaveLength(4);
      expect(visits.every((m) => m.slot === 'dinner' && mealMacros(m).kcal === 950)).toBe(true);
      expect(sum(visits.map((m) => m.priceRm ?? 0))).toBe(DEMO_EXPECTED.lastWeek.nasiKandar.spendRm);
    });

    it('has late suppers after 11pm on Friday and Saturday', () => {
      for (const day of DEMO_EXPECTED.lastWeek.lateSupperDays) {
        const supper = lastWeek.find((m) => m.logicalDay === day && m.slot === 'supper');
        expect(supper, day).toBeDefined();
        const minutes = mytMinutes(supper?.eatenAt ?? '');
        expect(minutes >= 23 * 60 || minutes < 5 * 60).toBe(true);
      }
      // The Friday supper is after midnight, on the next calendar day.
      const friday = lastWeek.find((m) => m.logicalDay === '2026-10-09' && m.slot === 'supper');
      expect(friday?.eatenAt).toBe('2026-10-09T16:30:00.000Z');
    });

    it('splits roughly like the design: rice 38%, home 18%, drinks 17%, noodles 14%, snacks 13%', () => {
      const group = ({ meal, item }: (typeof items)[number]): string => {
        const id = item.catalogueId ?? '';
        if (DRINK_IDS.has(id)) return 'drinks';
        if (NOODLE_IDS.has(id)) return 'noodles';
        if (SNACK_IDS.has(id)) return 'snacks';
        return meal.placeId === DEMO_IDS.places.home ? 'home' : 'rice';
      };
      const total = sum(items.map((i) => i.kcal));
      const share = (name: string): number => (100 * sum(items.filter((i) => group(i) === name).map((i) => i.kcal))) / total;
      const design = { rice: 38, home: 18, drinks: 17, noodles: 14, snacks: 13 };
      for (const [name, pct] of Object.entries(design)) {
        expect(Math.abs(share(name) - pct), name).toBeLessThanOrEqual(1.5);
      }
    });
  });

  it('gives the timing baselines ≥ 5 samples per main slot around 9:30, 1:30 and 8:45', () => {
    // The 28 days before Fri 16 Oct start on Fri 18 Sep.
    const history = world.meals.filter((m) => m.logicalDay >= '2026-09-18' && m.logicalDay < '2026-10-16');
    const times = (slot: MealLog['slot']): number[] => history.filter((m) => m.slot === slot).map((m) => mytMinutes(m.eatenAt));
    expect(times('breakfast').length).toBeGreaterThanOrEqual(5);
    expect(times('lunch').length).toBeGreaterThanOrEqual(5);
    expect(times('dinner').length).toBeGreaterThanOrEqual(5);
    expect(median(times('breakfast'))).toBe(9 * 60 + 30);
    expect(median(times('lunch'))).toBe(13 * 60 + 30);
    expect(median(times('dinner'))).toBeGreaterThanOrEqual(20 * 60 + 30);
    expect(median(times('dinner'))).toBeLessThanOrEqual(21 * 60);
    // Breakfast at 10:40am is more than an hour after the usual time ("Late for you").
    expect(10 * 60 + 40 - median(times('breakfast'))).toBeGreaterThan(60);
  });

  it('averages ~1,800 the week before', () => {
    const days = dayRange('2026-09-28', '2026-10-04');
    const total = kcalOf(world.meals.filter((m) => days.includes(m.logicalDay)));
    expect(total).toBe(DEMO_EXPECTED.weekBefore.totalKcal);
    expect(Math.abs(total / 7 - 1800)).toBeLessThan(50);
  });

  it('keeps every logical day consistent with the 5am rollover', () => {
    for (const meal of world.meals) expect(meal.logicalDay, meal.id).toBe(logicalDayFor(meal.eatenAt));
    for (const weight of world.weights) expect(weight.logicalDay).toBe(logicalDayFor(weight.measuredAt));
  });

  it('stores plausible item snapshots and macros', () => {
    for (const meal of world.meals) {
      const { kcal, proteinG, carbsG, fatG } = mealMacros(meal);
      const fromMacros = 4 * proteinG + 4 * carbsG + 9 * fatG;
      expect(Math.abs(fromMacros - kcal) / kcal, meal.id).toBeLessThanOrEqual(0.15);
      expect(meal.finished).toBe('all');
      expect(meal.syncState).toBe('local');
      for (const item of meal.items) {
        expect([0.15, 0.25]).toContain(item.uncertainty);
        expect(item.quantity).toBeGreaterThan(0);
        expect(item.id.startsWith(meal.id)).toBe(true);
        if (item.variants) expect(item.variants[item.selectedVariant ?? -1]?.macros).toEqual(item.unitMacros);
      }
    }
    expect(new Set(world.meals.map((m) => m.id)).size).toBe(world.meals.length);
  });

  it('has 14 weigh-ins at ~8:05am from 3 to 16 Oct', () => {
    expect(world.weights.map((w) => w.kg)).toEqual([...DEMO_EXPECTED.weights.kg]);
    expect(world.weights.map((w) => w.logicalDay)).toEqual(dayRange('2026-10-03', '2026-10-16'));
    expect(world.weights.every((w) => mytMinutes(w.measuredAt) === 8 * 60 + 5)).toBe(true);
  });

  it('has the places with learned defaults and trays', () => {
    const places = Object.fromEntries(world.places.map((p) => [p.id, p]));
    expect(world.places).toHaveLength(4);
    expect(places[DEMO_IDS.places.nasiKandar]).toMatchObject({
      name: 'Nasi kandar near home',
      type: 'mamak',
      defaultVariants: { 'rice-nasi-kandar': 2, 'kuah-campur': 2 },
      oilLevel: 'high',
      typicalPriceRm: 12,
    });
    expect(places[DEMO_IDS.places.kedai]).toMatchObject({ name: 'Kedai near home', type: 'economyRice', oilLevel: 'medium', typicalPriceRm: 9.5 });
    expect(places[DEMO_IDS.places.kedai]?.trays).toHaveLength(10);
    expect(places[DEMO_IDS.places.medanSelera]).toMatchObject({ name: 'Medan selera nearby', type: 'hawker' });
    expect(places[DEMO_IDS.places.home]).toMatchObject({ name: 'Home', type: 'home' });
  });

  it('has the four usuals with catalogue lines', () => {
    const kcal = Object.fromEntries(world.usuals.map((u) => [u.name, sum(u.items.map((i) => i.unitMacros.kcal * i.quantity))]));
    expect(kcal).toEqual({ 'Roti canai + teh tarik': 560, 'Bread, kaya, kopi': 380, 'Nasi lemak bungkus': 490, 'Teh o ais kurang': 60 });
    for (const item of world.usuals.flatMap((u) => u.items)) {
      expect(item.source).toBe('catalogue');
      expect(item.uncertainty).toBe(0.15);
    }
  });

  it('has the kari ayam pot, the futsal workout and the week plans', () => {
    const [pot] = world.pots;
    expect(world.pots).toHaveLength(1);
    expect(pot).toMatchObject({ name: 'Kari ayam', servings: 8, servingsLeft: 3, cookedOn: '2026-10-14', expiresOn: '2026-10-18' });
    expect(pot?.recipeText).toBe('1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang');
    expect(pot?.ingredients.map((i) => [i.name, i.macros.kcal])).toEqual([
      ['Ayam', 2150],
      ['Santan', 800],
      ['Kentang', 350],
      ['Rempah and bawang', 250],
      ['Cooking oil', 480],
    ]);
    expect(pot?.ingredients.find((i) => i.isOil)?.amount).toBe('4 tbsp');
    const total = sum(pot?.ingredients.map((i) => i.macros.kcal) ?? []);
    expect(total).toBe(DEMO_EXPECTED.pot.totalKcal);
    expect(Math.round(total / 8 / 10) * 10).toBe(DEMO_EXPECTED.pot.kcalPerServing);

    expect(world.workouts).toEqual([
      expect.objectContaining({ logicalDay: '2026-10-06', type: 'futsal', minutes: 60, intensity: 'moderate', netKcal: 470 }),
    ]);
    expect(world.weekPlans).toEqual([
      { weekStart: '2026-10-12', makanDay: '2026-10-17' },
      { weekStart: '2026-10-05', makanDay: '2026-10-10', focus: { label: 'Kurang manis for drinks', sub: 'About 300 kcal a week less' } },
    ]);
  });

  it('only references catalogue items that exist, with the same portion chips', () => {
    for (const id of DEMO_CATALOGUE_IDS) expect(byId(id), id).toBeDefined();
    for (const place of world.places) {
      for (const id of place.trays ?? []) expect(byId(id), id).toBeDefined();
      for (const [id, index] of Object.entries(place.defaultVariants)) expect(byId(id)?.variants[index], id).toBeDefined();
    }
    const nasiKandar = world.places.find((p) => p.id === DEMO_IDS.places.nasiKandar);
    expect(byId('rice-nasi-kandar')?.variants[nasiKandar?.defaultVariants['rice-nasi-kandar'] ?? -1]?.label).toBe('Mamak big');
    expect(byId('kuah-campur')?.variants[nasiKandar?.defaultVariants['kuah-campur'] ?? -1]?.label).toBe('Banjir');

    const chipItems = [...world.meals.flatMap((m) => m.items), ...world.usuals.flatMap((u) => u.items)].filter((i) => i.variants);
    for (const item of chipItems) {
      expect(item.variants?.map((v) => v.label), item.name).toEqual(byId(item.catalogueId ?? '')?.variants.map((v) => v.label));
    }
  });

  it('confirms every finished day and leaves today open', () => {
    expect(world.days.map((d) => d.logicalDay)).toEqual(dayRange('2026-09-28', '2026-10-15'));
    expect(world.days.filter((d) => d.status !== 'complete').map((d) => d.logicalDay)).toEqual(['2026-10-11']);
  });
});

describe('loadDemo', () => {
  let db: KiraMakanDb;

  beforeEach(() => {
    db = createDb(`demo-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('clears and fills every table', async () => {
    await db.bonuses.put({ id: 'stale', logicalDay: '2026-01-01', kcal: 100, reason: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    await loadDemo(db);
    await loadDemo(db);

    expect(await db.profile.count()).toBe(1);
    expect(await db.goals.count()).toBe(DEMO_EXPECTED.counts.goals);
    expect(await db.places.count()).toBe(DEMO_EXPECTED.counts.places);
    expect(await db.usuals.count()).toBe(DEMO_EXPECTED.counts.usuals);
    expect(await db.pots.count()).toBe(DEMO_EXPECTED.counts.pots);
    expect(await db.weights.count()).toBe(DEMO_EXPECTED.counts.weights);
    expect(await db.workouts.count()).toBe(DEMO_EXPECTED.counts.workouts);
    expect(await db.days.count()).toBe(DEMO_EXPECTED.counts.dayRecords);
    expect(await db.personalItems.count()).toBe(DEMO_EXPECTED.counts.personalItems);
    expect(await db.bonuses.count()).toBe(0);

    const totals = new Map<string, number>();
    for (const meal of await db.meals.toArray()) {
      totals.set(meal.logicalDay, (totals.get(meal.logicalDay) ?? 0) + mealMacros(meal).kcal);
    }
    for (const [day, kcal] of Object.entries({ ...DEMO_EXPECTED.thisWeekDayKcal, ...DEMO_EXPECTED.lastWeekDayKcal })) {
      expect(totals.get(day), day).toBe(kcal);
    }
    expect(totals.get('2026-10-16')).toBe(1230);
  });
});
