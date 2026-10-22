import type { GoalTemplate } from '@/domain/types';

/** Route paths (ARCHITECTURE.md §8). Build links with these, never with string literals. */
export const PATHS = {
  today: '/',
  diary: '/diary',
  diaryWeek: '/diary/week',
  /** S49 Search: find any meal by name, item or Place (?q=, ?slot=, ?place=). */
  search: '/diary/search',
  entry: (id: string) => `/diary/entry/${encodeURIComponent(id)}`,
  insights: '/insights',
  weekly: '/insights/weekly',
  /** S37 Target suggestion (and the target history). */
  target: '/insights/target',
  /** S34 Top dishes check: your 30 most-logged dishes, once. */
  dishes: '/insights/dishes',
  /** S35 Timing detail: one day's timing and the week's grid (?day=YYYY-MM-DD, default today). */
  timing: '/insights/timing',
  more: '/more',
  weight: '/more/weight',
  settings: '/more/settings',
  export: '/more/export',
  /** S39 Backups: sync state, Export now, Restore from a file. */
  backups: '/more/backups',
  /** S38 Reminders: this device's notifications and what to send. */
  reminders: '/more/reminders',
  places: '/more/places',
  place: (id: string) => `/more/places/${encodeURIComponent(id)}`,
  usuals: '/more/usuals',
  pots: '/more/pots',
  potNew: '/more/pots/new',
  pot: (id: string) => `/more/pots/${encodeURIComponent(id)}`,
  activity: '/more/activity',
  workoutNew: '/more/activity/new',
  /** S41 Goals library. */
  goals: '/more/goals',
  /** S43 New goal, with a template chip picked. */
  goalNew: (template?: GoalTemplate) => (template ? `/more/goals/new?template=${template}` : '/more/goals/new'),
  /** S42 Goal detail / edit. */
  goal: (id: string) => `/more/goals/${encodeURIComponent(id)}`,
  /** Placeholder for screens planned in later phases. */
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
