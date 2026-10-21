import { markUncaptured } from '@/db/capture';
import type { KiraMakanDb } from '@/db/db';
import { DEMO_NOW_ISO } from '@/domain/clock';
import { addDays } from '@/domain/day';
import type {
  DayRecord,
  Goal,
  GoalPeriod,
  GoalVersion,
  MealLog,
  OneOffBonus,
  PersonalItem,
  Place,
  Pot,
  PotIngredient,
  Profile,
  Usual,
  WeekPlan,
  WeightLog,
  Workout,
} from '@/domain/types';
import { buildGoal } from './defaults';
import { demoItem, type DemoFoodKey, type ItemSpec } from './demoFoods';
import { DEMO_IDS } from './demoIds';
import { buildDemoMeals } from './demoMeals';
import { dayRange, myt } from './time';

export { DEMO_IDS } from './demoIds';
export { DEMO_CATALOGUE_IDS, DEMO_FOODS } from './demoFoods';

/** Fri 16 Oct 2026, 7:10pm MYT: the instant the demo clock is pinned to. */
const DEMO_NOW = DEMO_NOW_ISO;
const STARTED_ON = '2026-09-28';
const SETUP_AT = myt(STARTED_ON, 9, 10);

const WEIGHT_KG = [78.6, 78.3, 78.5, 78.1, 78.2, 78.0, 79.0, 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8] as const;
const FIRST_WEIGH_IN = '2026-10-03';

/**
 * The numbers the demo world is built to produce, for assertions across the app
 * (design_handoff.md §9). Budget figures assume the 1,800 Cut target every day.
 *
 * Last week: the design shows "Budget +350 · 12,950 of 12,600" but also adds Tuesday's futsal
 * (~470) to that week. The engine always adds workouts to the budget (plan §7), so the demo
 * eats 470 more that week and keeps the design's +350: 13,420 of 13,070.
 */
export const DEMO_EXPECTED = {
  now: DEMO_NOW,
  timeZone: 'Asia/Kuala_Lumpur',
  rolloverHour: 5,
  startedOn: STARTED_ON,
  weekStart: '2026-10-12',
  lastWeekStart: '2026-10-05',
  weekBeforeStart: '2026-09-28',

  dailyKcal: 1800,
  dailyMinimumKcal: 1400,
  maintenanceKcal: 2350,
  macroTargets: { proteinG: 110, carbsG: 180, fatG: 60 },
  weeklyBudgetKcal: 12600,

  thisWeekDayKcal: { '2026-10-12': 1620, '2026-10-13': 1710, '2026-10-14': 1540, '2026-10-15': 1680 },
  today: {
    day: '2026-10-16',
    kcal: 1230,
    macros: { kcal: 1230, proteinG: 42, carbsG: 145, fatG: 52 },
    breakfast: { id: DEMO_IDS.meals.todayBreakfast, eatenAt: '2026-10-16T02:40:00.000Z', kcal: 560, priceRm: 4.8 },
    lunch: { id: DEMO_IDS.meals.todayLunch, eatenAt: '2026-10-16T06:15:00.000Z', kcal: 670, priceRm: 9.5 },
    /** 12-hour window from the 10:40am breakfast. */
    windowClosesAt: '2026-10-16T14:40:00.000Z',
  },
  savedThisWeekKcal: 650,
  eatenSoFarKcal: 7780,
  leftTodayKcal: 570,
  leftThisWeekKcal: 4820,
  makanDay: '2026-10-17',
  makanRoomKcal: 2450,

  lastWeekDayKcal: {
    '2026-10-05': 1800,
    /** The futsal day: its base is 1,800 + 470 = 2,270, so 2,150 is under. */
    '2026-10-06': 2150,
    '2026-10-07': 1660,
    '2026-10-08': 1800,
    '2026-10-09': 1790,
    '2026-10-10': 2420,
    '2026-10-11': 1050,
  },
  lastWeek: {
    loggedKcal: 12670,
    /** 7 × 1,800 + the 470 futsal. */
    weeklyBudgetKcal: 13070,
    /** Sunday is "not counted", so it counts as exactly its 1,800 base. */
    countedKcal: 13420,
    overBudgetKcal: 350,
    completeDays: 6,
    notCountedDay: '2026-10-11',
    makanDay: '2026-10-10',
    lateSupperDays: ['2026-10-09', '2026-10-10'],
    /** Teh tarik averages ~180 (3 kurang at 140, 5 normal at 200); milo ais 250. */
    drinks: { count: 11, kcal: 2170, tehTarik: 8, tehTarikKurang: 3, miloAis: 3 },
    nasiKandar: { visits: 4, kcalEach: 950, kcal: 3800, spendRm: 58 },
    focus: { label: 'Kurang manis for drinks', sub: 'About 300 kcal a week less' },
    futsal: { day: '2026-10-06', minutes: 60, netKcal: 470 },
  },
  weekBefore: { totalKcal: 12520, days: 7 },

  /**
   * The EMA (α = 0.25) of the design's readings ends at 77.99 kg ("78.0 kg"; the design's copy
   * says 77.9). This week's change is −0.43 ("−0.4 kg"); last week's is −0.11.
   */
  weights: { firstDay: FIRST_WEIGH_IN, lastDay: '2026-10-16', kg: WEIGHT_KG, latestKg: 77.8, trendKg: 77.99, weekChangeKg: -0.43, lastWeekChangeKg: -0.11 },
  pot: { name: 'Kari ayam', totalKcal: 4030, servings: 8, servingsLeft: 3, kcalPerServing: 500, expiresOn: '2026-10-18' },
  counts: { goals: 4, places: 4, usuals: 4, pots: 1, weights: 14, workouts: 1, dayRecords: 18, personalItems: 3 },
} as const;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * The design's person works from home, mostly sitting, yet starts at ~2,350 maintenance. With
 * Mifflin-St Jeor that needs the 'light' activity level (2,360, shown as ~2,350); 'sedentary'
 * would give 2,060 and a 1,510 target. The design's numbers win, so Settings shows "light".
 */
function buildProfile(): Profile {
  return {
    id: 'me',
    age: 30,
    sex: 'male',
    heightCm: 172,
    weightKgAtSetup: 78.6,
    activity: 'light',
    timeZone: DEMO_EXPECTED.timeZone,
    rolloverHour: DEMO_EXPECTED.rolloverHour,
    weekStartsOn: 1,
    dailyMinimumKcal: DEMO_EXPECTED.dailyMinimumKcal,
    theme: 'system',
    keepPhotos: true,
    useLocation: true,
    startedOn: STARTED_ON,
    setupCompletedAt: SETUP_AT,
    demoMode: true,
  };
}

function buildGoals(): Goal[] {
  const { goals } = DEMO_IDS;
  return [
    buildGoal('cut', { id: goals.cut, status: 'active', createdAt: SETUP_AT }),
    buildGoal('festive', { id: goals.festive, status: 'saved', createdAt: myt('2026-10-10', 21, 15) }),
    buildGoal('leanBulk', { id: goals.leanBulk, status: 'draft', createdAt: myt('2026-10-12', 22, 5) }),
    buildGoal('pause', { id: goals.pause, status: 'template', createdAt: SETUP_AT }),
  ];
}

function buildGoalVersions(goals: Goal[]): GoalVersion[] {
  const createdAt = (goalId: string): string => goals.find((g) => g.id === goalId)?.createdAt ?? SETUP_AT;
  const version = (
    id: string,
    goalId: string,
    effectiveFrom: string,
    targets: Pick<GoalVersion, 'dailyKcal' | 'proteinG' | 'carbsG' | 'fatG' | 'maintenanceKcal'>,
  ): GoalVersion => ({ id, goalId, effectiveFrom, ...targets, reason: 'setup', createdAt: createdAt(goalId) });

  const { goals: g, goalVersions: v } = DEMO_IDS;
  // Cut keeps the setup estimate (2,350) because no S37 target suggestion has been approved (it
  // unlocks after 21 complete days; the demo Friday is day 19, so S37 shows its 'unlocks' state).
  // Festive and Lean bulk were drafted on 10 and 12 Oct from an adaptive estimate of ~2,100:
  // Festive maintains at 2,100, Lean bulk adds 200.
  return [
    version(v.cut, g.cut, STARTED_ON, { dailyKcal: 1800, proteinG: 110, carbsG: 180, fatG: 60, maintenanceKcal: 2350 }),
    version(v.festive, g.festive, '2026-10-10', { dailyKcal: 2100, proteinG: 110, carbsG: 230, fatG: 70, maintenanceKcal: 2100 }),
    version(v.leanBulk, g.leanBulk, '2026-10-12', { dailyKcal: 2300, proteinG: 130, carbsG: 260, fatG: 75, maintenanceKcal: 2100 }),
  ];
}

function buildGoalPeriods(): GoalPeriod[] {
  return [{ id: DEMO_IDS.goalPeriods.cut, goalId: DEMO_IDS.goals.cut, from: STARTED_ON }];
}

function buildPlaces(): Place[] {
  const { places } = DEMO_IDS;
  return [
    {
      id: places.nasiKandar,
      name: 'Nasi kandar near home',
      type: 'mamak',
      coords: { lat: 3.1412, lng: 101.6865 },
      // Learned on 4 Oct: rice "Mamak big", kuah campur "Banjir".
      defaultVariants: { 'rice-nasi-kandar': 2, 'kuah-campur': 2 },
      oilLevel: 'high',
      typicalPriceRm: 12,
      createdAt: SETUP_AT,
    },
    {
      id: places.kedai,
      name: 'Kedai near home',
      type: 'economyRice',
      coords: { lat: 3.1405, lng: 101.6879 },
      defaultVariants: {},
      oilLevel: 'medium',
      typicalPriceRm: 9.5,
      trays: [
        'ayam-goreng-tray',
        'ayam-masak-merah',
        'ikan-goreng',
        'telur-dadar',
        'kangkung-belacan',
        'kubis-goreng',
        'terung-sambal',
        'taugeh',
        'tauhu-goreng',
        'telur-rebus',
      ],
      createdAt: SETUP_AT,
    },
    {
      id: places.medanSelera,
      name: 'Medan selera nearby',
      type: 'hawker',
      defaultVariants: {},
      createdAt: myt('2026-10-10', 19, 40),
    },
    { id: places.home, name: 'Home', type: 'home', defaultVariants: {}, createdAt: SETUP_AT },
  ];
}

function buildUsuals(): Usual[] {
  const usual = (
    id: string,
    name: string,
    foods: (DemoFoodKey | ItemSpec)[],
    useCount: number,
    extra: Pick<Usual, 'placeId' | 'slot'>,
  ): Usual => ({
    id,
    name,
    ...extra,
    // Usuals hold plain catalogue lines at the default ±15%.
    items: foods.map((food, index) => {
      const spec: ItemSpec = typeof food === 'string' ? { food } : food;
      return demoItem(`${id}-${index + 1}`, { ...spec, source: 'catalogue', uncertainty: 0.15 });
    }),
    useCount,
    createdAt: SETUP_AT,
  });

  const { usuals, places } = DEMO_IDS;
  return [
    usual(usuals.rotiCanai, 'Roti canai + teh tarik', ['rotiCanai', { food: 'tehTarik', variant: 'Normal' }], 6, {
      placeId: places.nasiKandar,
      slot: 'breakfast',
    }),
    usual(usuals.breadKayaKopi, 'Bread, kaya, kopi', ['breadKayaKopi'], 5, { placeId: places.home, slot: 'breakfast' }),
    usual(usuals.nasiLemak, 'Nasi lemak bungkus', ['nasiLemakBungkus'], 4, { slot: 'breakfast' }),
    usual(usuals.tehOAisKurang, 'Teh o ais kurang', [{ food: 'tehOAis', variant: 'Kurang' }], 3, {}),
  ];
}

function buildPot(): Pot {
  const id = DEMO_IDS.pots.kariAyam;
  const ingredient = (key: string, rest: Omit<PotIngredient, 'id'>): PotIngredient => ({ id: `${id}-${key}`, ...rest });
  return {
    id,
    name: 'Kari ayam',
    recipeText: '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang',
    ingredients: [
      ingredient('ayam', { name: 'Ayam', amount: '1 ekor', macros: { kcal: 2150, proteinG: 190, carbsG: 0, fatG: 154 }, source: 'myfcd' }),
      ingredient('santan', { name: 'Santan', amount: '1 tin', macros: { kcal: 800, proteinG: 8, carbsG: 11, fatG: 80 }, source: 'myfcd' }),
      ingredient('kentang', { name: 'Kentang', amount: '3 biji', macros: { kcal: 350, proteinG: 9, carbsG: 78, fatG: 0.5 }, source: 'usda' }),
      ingredient('rempah', { name: 'Rempah and bawang', amount: 'rempah kari, bawang', macros: { kcal: 250, proteinG: 6, carbsG: 40, fatG: 7 }, source: 'catalogue' }),
      ingredient('oil', { name: 'Cooking oil', amount: '4 tbsp', macros: { kcal: 480, proteinG: 0, carbsG: 0, fatG: 54 }, source: 'usda', isOil: true }),
    ],
    servings: 8,
    servingsLeft: 3,
    cookedOn: '2026-10-14',
    expiresOn: '2026-10-18',
    createdAt: myt('2026-10-14', 18, 30),
  };
}

function buildWeights(): WeightLog[] {
  return WEIGHT_KG.map((kg, index) => {
    const day = addDays(FIRST_WEIGH_IN, index);
    return { id: `weight-${day}`, measuredAt: myt(day, 8, 5), logicalDay: day, kg };
  });
}

function buildWorkouts(): Workout[] {
  const { futsal } = DEMO_EXPECTED.lastWeek;
  return [
    {
      id: DEMO_IDS.workouts.futsal,
      logicalDay: futsal.day,
      type: 'futsal',
      minutes: futsal.minutes,
      intensity: 'moderate',
      netKcal: futsal.netKcal,
      createdAt: myt(futsal.day, 20, 10),
    },
  ];
}

/** Every finished day is confirmed at the next morning's check-in. Today has no record yet. */
function buildDayRecords(): DayRecord[] {
  return dayRange(STARTED_ON, addDays(DEMO_EXPECTED.today.day, -1)).map((day) => ({
    logicalDay: day,
    status: day === DEMO_EXPECTED.lastWeek.notCountedDay ? 'notCounted' : 'complete',
    confirmedAt: myt(addDays(day, 1), 9, 0),
  }));
}

function buildWeekPlans(): WeekPlan[] {
  return [
    { weekStart: DEMO_EXPECTED.weekStart, makanDay: DEMO_EXPECTED.makanDay },
    { weekStart: DEMO_EXPECTED.lastWeekStart, makanDay: DEMO_EXPECTED.lastWeek.makanDay, focus: { ...DEMO_EXPECTED.lastWeek.focus } },
  ];
}

function buildPersonalItems(): PersonalItem[] {
  const fromFood = (
    id: string,
    spec: ItemSpec,
    scope: PersonalItem['scope'],
    corrections: number,
    createdAt: string,
    placeId?: string,
  ): PersonalItem => {
    const item = demoItem(id, spec);
    const personal: PersonalItem = {
      id,
      name: item.name,
      scope,
      unitMacros: item.unitMacros,
      uncertainty: item.uncertainty,
      corrections,
      createdAt,
      updatedAt: createdAt,
    };
    if (item.catalogueId) personal.catalogueId = item.catalogueId;
    if (item.variants) personal.variants = item.variants;
    if (item.selectedVariant !== undefined) personal.selectedVariant = item.selectedVariant;
    if (placeId) personal.placeId = placeId;
    return personal;
  };

  const nasiKandar = DEMO_IDS.places.nasiKandar;
  const learnedAt = myt('2026-10-04', 20, 50);
  return [
    fromFood('personal-nasi-kandar-rice', { food: 'nasiKandarRice', variant: 'Mamak big' }, 'place', 2, learnedAt, nasiKandar),
    fromFood('personal-nasi-kandar-kuah', { food: 'kuahCampur', variant: 'Banjir' }, 'place', 2, learnedAt, nasiKandar),
    fromFood('personal-teh-o-ais', { food: 'tehOAis', variant: 'Kurang' }, 'dish', 3, myt('2026-10-01', 9, 32)),
  ];
}

export interface DemoWorld {
  profile: Profile;
  goals: Goal[];
  goalVersions: GoalVersion[];
  goalPeriods: GoalPeriod[];
  meals: MealLog[];
  weights: WeightLog[];
  workouts: Workout[];
  bonuses: OneOffBonus[];
  days: DayRecord[];
  weekPlans: WeekPlan[];
  places: Place[];
  usuals: Usual[];
  pots: Pot[];
  personalItems: PersonalItem[];
}

/** The whole sample world as plain rows (no database), freshly built on every call. */
export function buildDemoWorld(): DemoWorld {
  const goals = buildGoals();
  return {
    profile: buildProfile(),
    goals,
    goalVersions: buildGoalVersions(goals),
    goalPeriods: buildGoalPeriods(),
    meals: buildDemoMeals(),
    weights: buildWeights(),
    workouts: buildWorkouts(),
    bonuses: [],
    days: buildDayRecords(),
    weekPlans: buildWeekPlans(),
    places: buildPlaces(),
    usuals: buildUsuals(),
    pots: [buildPot()],
    personalItems: buildPersonalItems(),
  };
}

/** Clears every table and fills it with the demo world, in one transaction. */
export async function loadDemo(database: KiraMakanDb): Promise<DemoWorld> {
  const world = buildDemoWorld();
  await database.transaction('rw', database.tables, async () => {
    // Sample data never syncs; clearing every table also drops this device's sync state.
    markUncaptured();
    await Promise.all(database.tables.map((table) => table.clear()));
    await database.profile.put(world.profile);
    await database.goals.bulkPut(world.goals);
    await database.goalVersions.bulkPut(world.goalVersions);
    await database.goalPeriods.bulkPut(world.goalPeriods);
    await database.meals.bulkPut(world.meals);
    await database.weights.bulkPut(world.weights);
    await database.workouts.bulkPut(world.workouts);
    await database.bonuses.bulkPut(world.bonuses);
    await database.days.bulkPut(world.days);
    await database.weekPlans.bulkPut(world.weekPlans);
    await database.places.bulkPut(world.places);
    await database.usuals.bulkPut(world.usuals);
    await database.pots.bulkPut(world.pots);
    await database.personalItems.bulkPut(world.personalItems);
  });
  return world;
}
