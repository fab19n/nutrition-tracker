/**
 * Live-query hooks for screens. Each wraps a selector or repository read in `useLiveQuery`,
 * so a screen re-renders whenever the rows behind it change. Every hook returns undefined
 * while loading (and, for single rows, when there is nothing there).
 *
 * Queries that depend on "today" take it as a dependency, so they re-run when the logical
 * day rolls over or demo mode pins the clock, not on every minute tick.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import { db } from '@/db/db';
import {
  getMeal,
  getPlace,
  getProfile,
  getWeekPlan,
  listActivePots,
  listMealsInRange,
  listPersonalItems,
  listPlaces,
  listUsuals,
  listWorkoutsInRange,
} from '@/db/repo';
import { isDemoClock, now, setDemoClock } from '@/domain/clock';
import { addDays } from '@/domain/day';
import type { SlotBaselines } from '@/domain/timing';
import type { Id, LogicalDay, MealLog, PersonalItem, Place, Pot, Profile, Usual, WeekPlan, Workout } from '@/domain/types';
import {
  getActiveGoal,
  getCheckIn,
  getDaySummary,
  getFestiveDaysInRange,
  getProteinLeft,
  getSlotBaselines,
  getWeekBudget,
  getWeightTrend,
  todayFor,
  type ActiveGoal,
  type CheckIn,
  type DaySummary,
  type FestiveDaysInRange,
  type ProteinLeft,
  type WeekBudgetView,
  type WeightTrendView,
} from './selectors';

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;

/** One shared timer for every useNow: ticks on each minute boundary and when the app comes back into view. */
const minuteTicker = (() => {
  let tick = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    tick += 1;
    for (const listener of listeners) listener();
  };
  const schedule = (): void => {
    timer = setTimeout(() => {
      emit();
      schedule();
    }, MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE));
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') emit();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) {
        schedule();
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearTimeout(timer);
        timer = undefined;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      };
    },
    getSnapshot: (): number => tick,
  };
})();

export function useProfile(): Profile | undefined {
  return useLiveQuery(() => getProfile(db), []);
}

/** False when setup hasn't run yet (route to S01); undefined while loading. */
export function useHasProfile(): boolean | undefined {
  return useLiveQuery(async () => (await getProfile(db)) !== undefined, []);
}

/**
 * The current moment, re-rendering every minute. Demo-aware: the clock is pinned while the
 * stored profile is in demo mode (synced here so a reload stays on the demo Friday).
 */
function useClock(): { now: Date; profile: Profile | undefined } {
  const tick = useSyncExternalStore(minuteTicker.subscribe, minuteTicker.getSnapshot, minuteTicker.getSnapshot);
  const profile = useProfile();
  const demo = profile?.demoMode === true;
  // Idempotent sync of the clock module with stored state; it must happen before now() below.
  if (profile && isDemoClock() !== demo) setDemoClock(demo);
  // tick and demo are the reasons to read the clock again.
  const current = useMemo(() => now(), [tick, demo]);
  return { now: current, profile };
}

export function useNow(): Date {
  return useClock().now;
}

export function useToday(): LogicalDay {
  const { now: current, profile } = useClock();
  return todayFor(profile, current);
}

// ---------------------------------------------------------------------------
// Budget, day and goal read models
// ---------------------------------------------------------------------------

export function useActiveGoal(day?: LogicalDay): ActiveGoal | undefined {
  const today = useToday();
  const target = day ?? today;
  return useLiveQuery(() => getActiveGoal(db, target), [target]);
}

export function useDaySummary(day: LogicalDay): DaySummary | undefined {
  return useLiveQuery(() => getDaySummary(db, day), [day]);
}

/** When you usually eat each slot, judged from the days before `day` (default today). */
export function useSlotBaselines(day?: LogicalDay): SlotBaselines | undefined {
  const today = useToday();
  const target = day ?? today;
  return useLiveQuery(() => getSlotBaselines(db, target), [target]);
}

/** The budget week containing `day` (default today). */
export function useWeekBudget(day?: LogicalDay): WeekBudgetView | undefined {
  const today = useToday();
  return useLiveQuery(() => getWeekBudget(db, day, { today }), [day, today]);
}

export function useWeightTrend(): WeightTrendView | undefined {
  const today = useToday();
  return useLiveQuery(() => getWeightTrend(db, { today }), [today]);
}

/** The morning check-in: the newest day still waiting, or `day` when given (the Diary's "Check"). */
export function useCheckIn(day?: LogicalDay): CheckIn | undefined {
  const today = useToday();
  return useLiveQuery(() => getCheckIn(db, day ? { today, day } : { today }), [today, day]);
}

export function useProteinLeft(day?: LogicalDay): ProteinLeft | undefined {
  const today = useToday();
  const target = day ?? today;
  return useLiveQuery(() => getProteinLeft(db, target), [target]);
}

export function useFestiveDaysInRange(from: LogicalDay, to: LogicalDay): FestiveDaysInRange | undefined {
  const today = useToday();
  return useLiveQuery(() => getFestiveDaysInRange(db, from, to, { today }), [from, to, today]);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Meals with a logical day in [from, to] (both inclusive), in the order they were eaten. */
export function useMealsInRange(from: LogicalDay, to: LogicalDay): MealLog[] | undefined {
  return useLiveQuery(() => listMealsInRange(db, from, to), [from, to]);
}

export function useMeal(id: Id | undefined): MealLog | undefined {
  return useLiveQuery(() => (id ? getMeal(db, id) : undefined), [id]);
}

/** How many meals are logged, all time (the backup nudge needs a diary worth saving). */
export function useMealCount(): number | undefined {
  return useLiveQuery(() => db.meals.count(), []);
}

/** Alphabetical. */
export function usePlaces(): Place[] | undefined {
  return useLiveQuery(() => listPlaces(db), []);
}

export function usePlace(id: Id | undefined): Place | undefined {
  return useLiveQuery(() => (id ? getPlace(db, id) : undefined), [id]);
}

/** In your order: the manual order from S23 first, then most used (see `compareUsualOrder`). */
export function useUsuals(): Usual[] | undefined {
  return useLiveQuery(() => listUsuals(db), []);
}

/** Pots still in the fridge today, soonest to clear first. */
export function usePots(): Pot[] | undefined {
  const today = useToday();
  return useLiveQuery(() => listActivePots(db, today), [today]);
}

/** Workouts in the budget week starting `weekStart`. */
export function useWorkouts(weekStart: LogicalDay): Workout[] | undefined {
  return useLiveQuery(() => listWorkoutsInRange(db, weekStart, addDays(weekStart, 6)), [weekStart]);
}

export function useWeekPlan(weekStart: LogicalDay): WeekPlan | undefined {
  return useLiveQuery(() => getWeekPlan(db, weekStart), [weekStart]);
}

/** Layer-1 corrections, for the estimator's context. */
export function usePersonalItems(): PersonalItem[] | undefined {
  return useLiveQuery(() => listPersonalItems(db), []);
}
