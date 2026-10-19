/** Fixed ids in the demo world, so screens, tests and resets always point at the same rows. */
export const DEMO_IDS = {
  goals: {
    cut: 'goal-cut',
    festive: 'goal-festive',
    leanBulk: 'goal-lean-bulk',
    pause: 'goal-pause',
  },
  goalVersions: {
    cut: 'goal-version-cut-1',
    festive: 'goal-version-festive-1',
    leanBulk: 'goal-version-lean-bulk-1',
  },
  goalPeriods: {
    cut: 'goal-period-cut-1',
  },
  places: {
    nasiKandar: 'place-nasi-kandar',
    kedai: 'place-kedai',
    medanSelera: 'place-medan-selera',
    home: 'place-home',
  },
  usuals: {
    rotiCanai: 'usual-roti-canai',
    breadKayaKopi: 'usual-bread-kaya-kopi',
    nasiLemak: 'usual-nasi-lemak',
    tehOAisKurang: 'usual-teh-o-ais-kurang',
  },
  pots: {
    kariAyam: 'pot-kari-ayam',
  },
  workouts: {
    futsal: 'workout-futsal-2026-10-06',
  },
  meals: {
    todayBreakfast: 'meal-2026-10-16-breakfast',
    todayLunch: 'meal-2026-10-16-lunch',
  },
} as const;

export type DemoPlaceKey = keyof typeof DEMO_IDS.places;
