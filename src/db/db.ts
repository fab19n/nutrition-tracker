import Dexie, { type Table } from 'dexie';
import type {
  DayRecord,
  Goal,
  GoalPeriod,
  GoalVersion,
  Id,
  InsightFeedback,
  Instant,
  MealLog,
  OneOffBonus,
  PersonalItem,
  Place,
  Pot,
  Profile,
  SuggestionEvent,
  Usual,
  WeekPlan,
  WeightLog,
  Workout,
} from '@/domain/types';

export const DB_NAME = 'kira-makan';

/** A meal photo and its thumbnail. Kept out of MealLog so lists stay light. */
export interface PhotoRecord {
  id: Id;
  blob: Blob;
  thumb: Blob;
  createdAt: Instant;
}

/** The row type stored in each table. */
export interface TableRows {
  profile: Profile;
  goals: Goal;
  goalVersions: GoalVersion;
  goalPeriods: GoalPeriod;
  meals: MealLog;
  weights: WeightLog;
  workouts: Workout;
  bonuses: OneOffBonus;
  days: DayRecord;
  weekPlans: WeekPlan;
  places: Place;
  usuals: Usual;
  pots: Pot;
  photos: PhotoRecord;
  insightFeedback: InsightFeedback;
  suggestionEvents: SuggestionEvent;
  personalItems: PersonalItem;
}

/** Primary key first, then indexes (ARCHITECTURE.md §6). */
export const SCHEMA_V1 = {
  profile: 'id',
  goals: 'id, status',
  goalVersions: 'id, goalId, effectiveFrom',
  goalPeriods: 'id, goalId, from',
  meals: 'id, logicalDay, eatenAt, placeId, slot',
  weights: 'id, logicalDay, measuredAt',
  workouts: 'id, logicalDay',
  bonuses: 'id, logicalDay',
  days: 'logicalDay, status',
  weekPlans: 'weekStart',
  places: 'id, name',
  usuals: 'id, placeId',
  pots: 'id, expiresOn',
  photos: 'id',
  insightFeedback: 'ruleId',
  suggestionEvents: 'id, at',
  personalItems: 'id, catalogueId, placeId',
} as const satisfies Record<keyof TableRows, string>;

export type TableName = keyof TableRows;

export const TABLE_NAMES = Object.keys(SCHEMA_V1) as TableName[];

export class KiraMakanDb extends Dexie {
  declare profile: Table<Profile, Profile['id']>;
  declare goals: Table<Goal, Id>;
  declare goalVersions: Table<GoalVersion, Id>;
  declare goalPeriods: Table<GoalPeriod, Id>;
  declare meals: Table<MealLog, Id>;
  declare weights: Table<WeightLog, Id>;
  declare workouts: Table<Workout, Id>;
  declare bonuses: Table<OneOffBonus, Id>;
  declare days: Table<DayRecord, DayRecord['logicalDay']>;
  declare weekPlans: Table<WeekPlan, WeekPlan['weekStart']>;
  declare places: Table<Place, Id>;
  declare usuals: Table<Usual, Id>;
  declare pots: Table<Pot, Id>;
  declare photos: Table<PhotoRecord, Id>;
  declare insightFeedback: Table<InsightFeedback, InsightFeedback['ruleId']>;
  declare suggestionEvents: Table<SuggestionEvent, Id>;
  declare personalItems: Table<PersonalItem, Id>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
  }
}

/** Factory for tests and tools; the app uses the `db` singleton. */
export function createDb(name: string = DB_NAME): KiraMakanDb {
  return new KiraMakanDb(name);
}

export const db = createDb();

/** Empties every table in one transaction (used by demo load, import and "delete everything"). */
export async function clearAllTables(database: KiraMakanDb): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    await Promise.all(database.tables.map((table) => table.clear()));
  });
}

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}
