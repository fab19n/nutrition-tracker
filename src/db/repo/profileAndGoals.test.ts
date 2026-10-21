// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { buildGoal } from '@/db/seed/defaults';
import type { GoalVersion, Profile } from '@/domain/types';
import {
  addGoalVersion,
  deleteGoal,
  deleteProfile,
  getActiveGoal,
  getGoal,
  getProfile,
  goalPeriodOn,
  goalPeriodsInRange,
  goalVersionOn,
  latestGoalVersion,
  listGoalPeriods,
  listGoals,
  listGoalsByStatus,
  listGoalVersions,
  putGoal,
  putGoalPeriod,
  saveProfile,
  updateGoal,
  updateGoalPeriod,
  updateProfile,
} from '.';

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

const T = '2026-09-28T01:10:00.000Z';

const profile: Profile = {
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
  useLocation: false,
  startedOn: '2026-09-28',
};

describe('profile repo', () => {
  it('saves, reads, updates and deletes the single profile', async () => {
    expect(await getProfile(db)).toBeUndefined();
    expect(await updateProfile(db, { theme: 'dark' })).toBe(false);

    await saveProfile(db, profile);
    expect(await getProfile(db)).toEqual(profile);

    expect(await updateProfile(db, { theme: 'dark', name: 'Faiz' })).toBe(true);
    expect(await getProfile(db)).toMatchObject({ theme: 'dark', name: 'Faiz', age: 30 });

    await deleteProfile(db);
    expect(await getProfile(db)).toBeUndefined();
  });
});

describe('goals repo', () => {
  const cut = buildGoal('cut', { id: 'g-cut', status: 'active', createdAt: T });
  const festive = buildGoal('festive', { id: 'g-festive', status: 'saved', createdAt: '2026-10-10T13:00:00.000Z' });

  const version = (id: string, effectiveFrom: string, dailyKcal: number, createdAt = T): GoalVersion => ({
    id,
    goalId: cut.id,
    effectiveFrom,
    dailyKcal,
    proteinG: 110,
    carbsG: 180,
    fatG: 60,
    maintenanceKcal: 2350,
    reason: 'setup',
    createdAt,
  });

  it('round-trips goals and finds them by status', async () => {
    await putGoal(db, festive);
    await putGoal(db, cut);
    expect(await getGoal(db, cut.id)).toEqual(cut);
    expect((await listGoals(db)).map((g) => g.id)).toEqual([cut.id, festive.id]);
    expect((await listGoalsByStatus(db, 'saved')).map((g) => g.id)).toEqual([festive.id]);
    expect((await getActiveGoal(db))?.id).toBe(cut.id);

    expect(await updateGoal(db, cut.id, { status: 'ended' })).toBe(true);
    expect(await getActiveGoal(db)).toBeUndefined();
    expect(await updateGoal(db, 'missing', { status: 'ended' })).toBe(false);
  });

  it('keeps versions append-only and picks the one in force on a day', async () => {
    await putGoal(db, cut);
    await addGoalVersion(db, version('v2', '2026-10-19', 1550, '2026-10-18T13:00:00.000Z'));
    await addGoalVersion(db, version('v1', '2026-09-28', 1800));
    await expect(addGoalVersion(db, version('v1', '2026-09-28', 1700))).rejects.toThrow();

    expect((await listGoalVersions(db, cut.id)).map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(await goalVersionOn(db, cut.id, '2026-09-27')).toBeUndefined();
    expect((await goalVersionOn(db, cut.id, '2026-10-16'))?.dailyKcal).toBe(1800);
    expect((await goalVersionOn(db, cut.id, '2026-10-19'))?.dailyKcal).toBe(1550);
    expect((await latestGoalVersion(db, cut.id))?.id).toBe('v2');
  });

  it('finds the period covering a day, with an exclusive end', async () => {
    await putGoalPeriod(db, { id: 'p1', goalId: cut.id, from: '2026-09-28' });
    // Switch to Festive from Saturday: Cut ends (exclusive) where Festive starts.
    expect(await updateGoalPeriod(db, 'p1', { to: '2026-10-17' })).toBe(true);
    await putGoalPeriod(db, { id: 'p2', goalId: festive.id, from: '2026-10-17' });

    expect(await goalPeriodOn(db, '2026-09-27')).toBeUndefined();
    expect((await goalPeriodOn(db, '2026-10-16'))?.id).toBe('p1');
    expect((await goalPeriodOn(db, '2026-10-17'))?.id).toBe('p2');
    expect((await goalPeriodOn(db, '2027-01-01'))?.id).toBe('p2');
    expect((await goalPeriodsInRange(db, '2026-10-12', '2026-10-18')).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect((await goalPeriodsInRange(db, '2026-10-17', '2026-10-18')).map((p) => p.id)).toEqual(['p2']);
    expect((await listGoalPeriods(db)).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('resolves two periods from the same day by when they were booked (the later wins)', async () => {
    await putGoalPeriod(db, { id: 'p1', goalId: cut.id, from: '2026-09-28', to: '2026-10-17' });
    // Two switches booked offline for Saturday; the id order is the other way round on purpose.
    await putGoalPeriod(db, { id: 'p-b', goalId: festive.id, from: '2026-10-17', createdAt: '2026-10-16T11:00:00.000Z' });
    await putGoalPeriod(db, { id: 'p-a', goalId: 'g-lean-bulk', from: '2026-10-17', createdAt: '2026-10-16T11:05:00.000Z' });
    // A row from before createdAt existed loses to both.
    await putGoalPeriod(db, { id: 'p-z', goalId: 'g-old', from: '2026-10-17' });

    expect((await listGoalPeriods(db)).map((p) => p.id)).toEqual(['p1', 'p-z', 'p-b', 'p-a']);
    expect((await goalPeriodOn(db, '2026-10-17'))?.id).toBe('p-a');
    expect((await goalPeriodOn(db, '2026-10-16'))?.id).toBe('p1');

    await updateGoalPeriod(db, 'p-b', { createdAt: '2026-10-16T11:10:00.000Z' });
    expect((await goalPeriodOn(db, '2026-10-17'))?.id).toBe('p-b');
  });

  it('deletes a goal together with its versions and periods', async () => {
    await putGoal(db, cut);
    await putGoal(db, festive);
    await addGoalVersion(db, version('v1', '2026-09-28', 1800));
    await putGoalPeriod(db, { id: 'p1', goalId: cut.id, from: '2026-09-28' });

    await deleteGoal(db, cut.id);
    expect(await getGoal(db, cut.id)).toBeUndefined();
    expect(await listGoalVersions(db, cut.id)).toEqual([]);
    expect(await listGoalPeriods(db)).toEqual([]);
    expect(await getGoal(db, festive.id)).toBeDefined();
  });
});
