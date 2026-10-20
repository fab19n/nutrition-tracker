import Dexie, { type Table } from 'dexie';
import { readSupabaseConfig } from '@/auth/supabase';
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
import { createCaptureMiddleware } from './capture';
import type { OutboxEntry, RowRev, SyncMeta } from './syncTypes';

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

/** Every data table except photos (a later step). All keys are strings. */
export type SyncTable = Exclude<TableName, 'photos'>;
export const SYNC_TABLES = TABLE_NAMES.filter((t): t is SyncTable => t !== 'photos');
/** Version a device has synced against; bump it (and the cursor goes back to 0 once) when a table starts syncing. */
export const SYNC_PROTOCOL = 1;

/** Sync bookkeeping (ARCHITECTURE §6.2): never exported, never captured, cleared by every wipe. */
export const SYNC_STORES = {
  syncOutbox: '[table+key], changedAt',
  syncRevs: '[table+key]',
  syncMeta: 'id',
} as const;

export interface DbOptions {
  /** Record changes for sync. Off unless the app is deployed with Supabase. */
  capture?: () => boolean;
}

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
  declare syncOutbox: Table<OutboxEntry, [string, string]>;
  declare syncRevs: Table<RowRev, [string, string]>;
  declare syncMeta: Table<SyncMeta, 'sync'>;

  constructor(name: string = DB_NAME, options: DbOptions = {}) {
    super(name);
    this.use(createCaptureMiddleware({ tables: new Set<string>(SYNC_TABLES), enabled: options.capture ?? (() => false) }));
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SYNC_STORES); // no upgrade function: existing rows are queued when the device links
  }
}

/** Factory for tests and tools (capture off unless asked for); the app uses the `db` singleton. */
export function createDb(name: string = DB_NAME, options?: DbOptions): KiraMakanDb {
  return new KiraMakanDb(name, options);
}

export const db = createDb(DB_NAME, { capture: () => readSupabaseConfig() !== null });

/**
 * Empties every table, sync bookkeeping included, in one transaction ("Delete everything",
 * leaving demo). clear() is never captured, so a wipe stays on this device.
 */
export async function clearAllTables(database: KiraMakanDb): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    await Promise.all(database.tables.map((table) => table.clear()));
  });
}

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}
