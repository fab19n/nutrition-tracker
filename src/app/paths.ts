/** Route paths (ARCHITECTURE.md §8). Build links with these, never with string literals. */
export const PATHS = {
  today: '/',
  diary: '/diary',
  diaryWeek: '/diary/week',
  entry: (id: string) => `/diary/entry/${encodeURIComponent(id)}`,
  insights: '/insights',
  weekly: '/insights/weekly',
  more: '/more',
  weight: '/more/weight',
  settings: '/more/settings',
  export: '/more/export',
  places: '/more/places',
  place: (id: string) => `/more/places/${encodeURIComponent(id)}`,
  usuals: '/more/usuals',
  pots: '/more/pots',
  potNew: '/more/pots/new',
  pot: (id: string) => `/more/pots/${encodeURIComponent(id)}`,
  activity: '/more/activity',
  workoutNew: '/more/activity/new',
  /** Placeholder for screens planned in later phases (Goals, Reminders, Backups). */
  soon: (what: string) => `/more/soon/${encodeURIComponent(what)}`,
  estimating: '/log/estimating',
  review: '/log/review',
  plate: '/log/plate',
  ideas: '/ideas',
  setup: '/setup',
  dev: '/dev',
} as const;

/** Sheets open over the current tab via ?sheet=… (plus optional extra params, e.g. rule=drinks). */
export type SheetName = 'log' | 'budget' | 'makan' | 'checkin' | 'evidence';

export const SHEET_NAMES: readonly SheetName[] = ['log', 'budget', 'makan', 'checkin', 'evidence'];

/** Bottom-nav tabs. */
export type Tab = 'today' | 'diary' | 'insights' | 'more';
