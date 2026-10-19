import type { ActivityEntry } from '@/db/activity';
import type { OneOffBonus, Workout } from '@/domain/types';
import {
  bonusName,
  bonusToast,
  closedWeekDelete,
  dayPhrase,
  deleteLabel,
  entryDay,
  entryKcal,
  entryTitle,
  plusKcal,
  weekHeading,
  weekName,
  weekPhrase,
  workoutSummary,
  workoutToast,
} from './activityModel';

const TODAY = '2026-10-16'; // Fri

const FUTSAL: Workout = { id: 'w1', logicalDay: '2026-10-06', type: 'futsal', minutes: 60, intensity: 'moderate', netKcal: 470, createdAt: '2026-10-06T12:10:00.000Z' };
const HIKE: OneOffBonus = { id: 'b1', logicalDay: '2026-10-10', kcal: 300, reason: 'A hike', createdAt: '2026-10-10T10:00:00.000Z' };

const futsalEntry: ActivityEntry = { kind: 'workout', id: FUTSAL.id, day: FUTSAL.logicalDay, kcal: 470, createdAt: FUTSAL.createdAt, workout: FUTSAL };
const hikeEntry: ActivityEntry = { kind: 'bonus', id: HIKE.id, day: HIKE.logicalDay, kcal: 300, createdAt: HIKE.createdAt, bonus: HIKE };

describe('activity copy', () => {
  it('heads weeks with the kcal they gained', () => {
    expect(plusKcal(0)).toBe('+0');
    expect(plusKcal(1470)).toBe('+1,470');
    expect(weekHeading({ kind: 'thisWeek', weekStart: '2026-10-12', weekEnd: '2026-10-18', addedKcal: 0 })).toBe('This week · +0');
    expect(weekHeading({ kind: 'lastWeek', weekStart: '2026-10-05', weekEnd: '2026-10-11', addedKcal: 470 })).toBe('Last week · +470');
    expect(weekName({ kind: 'older', weekStart: '2026-09-28', weekEnd: '2026-10-04' })).toBe('28 Sep–4 Oct');
  });

  it('says whose budget a day feeds', () => {
    expect(weekPhrase('2026-10-14', TODAY)).toBe('this week');
    expect(weekPhrase('2026-10-11', TODAY)).toBe('last week');
    expect(weekPhrase('2026-10-01', TODAY)).toBe('the week of 28 Sep–4 Oct');
  });

  it('names days for rows and for the bonus field', () => {
    expect(entryDay(TODAY, TODAY)).toBe('Today');
    expect(entryDay('2026-10-15', TODAY)).toBe('Yesterday');
    expect(entryDay('2026-10-06', TODAY)).toBe('Tue');
    expect(dayPhrase(TODAY, TODAY)).toBe('today');
    expect(dayPhrase('2026-10-15', TODAY)).toBe('yesterday');
    expect(dayPhrase('2026-10-13', TODAY)).toBe('on Tue');
  });

  it('titles workouts and bonuses', () => {
    expect(workoutSummary(FUTSAL)).toBe('Futsal 60 min, moderate');
    expect(workoutSummary({ type: 'other', minutes: 30, intensity: 'easy' })).toBe('Workout 30 min, easy');
    expect(bonusName(HIKE)).toBe('A hike');
    expect(bonusName({ reason: '  ' })).toBe('One-off bonus');
    expect(entryTitle(futsalEntry, TODAY)).toBe('Tue · Futsal 60 min, moderate');
    expect(entryTitle(hikeEntry, TODAY)).toBe('Sat · A hike');
  });

  it('marks workout kcal as estimates and bonuses as set amounts', () => {
    expect(entryKcal(futsalEntry)).toBe('~470');
    expect(entryKcal(hikeEntry)).toBe('+300');
    expect(deleteLabel(futsalEntry, TODAY)).toBe('Delete Futsal, Tue, ~470 kcal');
    expect(deleteLabel(hikeEntry, TODAY)).toBe('Delete bonus, Sat, A hike, +300 kcal');
  });

  it('writes the save toasts', () => {
    expect(workoutToast({ ...FUTSAL, logicalDay: TODAY }, TODAY)).toBe('Futsal · ~470 kcal added to this week');
    expect(workoutToast({ ...FUTSAL, logicalDay: '2026-10-11' }, TODAY)).toBe('Futsal · ~470 kcal added to last week');
    expect(bonusToast({ ...HIKE, logicalDay: TODAY }, TODAY)).toBe('A hike · +300 kcal added to this week');
    expect(bonusToast({ reason: '', kcal: 250, logicalDay: TODAY }, TODAY)).toBe('One-off bonus · +250 kcal added to this week');
  });

  it('explains a delete from a closed week', () => {
    expect(closedWeekDelete(futsalEntry, TODAY)).toEqual({
      title: 'Delete from last week?',
      body: "Futsal, Tue, ~470 kcal. Last week has closed, so this changes its budget and weekly review. This week's budget stays the same. You can undo straight after.",
    });
    const olderHike: ActivityEntry = { ...hikeEntry, day: '2026-10-03', bonus: { ...HIKE, logicalDay: '2026-10-03', reason: '' } };
    expect(closedWeekDelete(olderHike, TODAY)).toEqual({
      title: 'Delete from the week of 28 Sep–4 Oct?',
      body: "One-off bonus, Sat, +300 kcal. The week of 28 Sep–4 Oct has closed, so this changes its budget and weekly review. This week's budget stays the same. You can undo straight after.",
    });
  });
});
