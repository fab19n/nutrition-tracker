import { useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { GoalCard } from '@/components/GoalCard/GoalCard';
import { servingsText } from '@/components/PotCard/PotCard';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { TopBar } from '@/components/TopBar/TopBar';
import { Pill } from '@/components/ui/Pill';
import { useGoalLibrary } from '@/db/goals';
import { useProfile, useToday, useWeightTrend } from '@/db/hooks';
import { useMoreSummary } from '@/db/settings';
import { addDays, compareDays, daysBetween, weekStartOf } from '@/domain/day';
import { fmtClock, fmtDayShort, fmtInt, fmtKg, fmtKgDelta, fmtSigned, fmtWeekday } from '@/domain/format';
import type { LogicalDay, Workout, WorkoutType } from '@/domain/types';
import { goalsSubLine, moreCardModel } from '@/screens/Goals/goalsModel';
import styles from './MoreScreen.module.css';

const WORKOUT_LABEL: Record<WorkoutType, string> = {
  walking: 'Walking',
  futsal: 'Futsal',
  badminton: 'Badminton',
  gym: 'Gym',
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  other: 'Workout',
};

function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** "today", "on Tue" (this week), "last Tue" (last week), else "on Mon 28 Sep". */
function workoutWhen(day: LogicalDay, today: LogicalDay): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  const thisWeek = weekStartOf(today);
  if (compareDays(day, thisWeek) >= 0) return `on ${fmtWeekday(day)}`;
  if (compareDays(day, addDays(thisWeek, -7)) >= 0) return `last ${fmtWeekday(day)}`;
  return `on ${fmtDayShort(day)}`;
}

function workoutSub(workout: Workout, today: LogicalDay): string {
  return `${WORKOUT_LABEL[workout.type]} ${workoutWhen(workout.logicalDay, today)} · ${fmtSigned(workout.netKcal)}`;
}

/** S48 More: the active goal, then Goals, Places, Usuals, Pots, Weight, Activity and Settings with live sub-lines. */
export default function MoreScreen() {
  const navigate = useNavigate();
  const today = useToday();
  const profile = useProfile();
  const library = useGoalLibrary();
  const summary = useMoreSummary(today);
  const weight = useWeightTrend();

  const goalCard = library ? moreCardModel(library) : undefined;
  const latest = weight?.latest;

  const goalsSub = library ? goalsSubLine(library) : undefined;
  let placesSub: string | undefined;
  let usualsSub: string | undefined;
  let potsSub: string | undefined;
  let activitySub: string | undefined;
  if (summary) {
    placesSub =
      summary.placeCount === 0
        ? 'Places appear as you log'
        : `${plural(summary.placeCount, 'place', 'places')}${summary.topPlace ? ` · ${summary.topPlace.name} most visited` : ''}`;
    usualsSub = summary.usualCount === 0 ? 'Meals you have often, in one tap' : plural(summary.usualCount, 'one-tap meal', 'one-tap meals');
    potsSub = summary.pot
      ? `${summary.pot.name} · ${servingsText(summary.pot.servingsLeft)} of ${fmtInt(summary.pot.servings)} left`
      : 'Cook once, log servings all week';
    activitySub = summary.lastWorkout ? workoutSub(summary.lastWorkout, today) : 'Workouts add to your weekly budget';
  }
  let weightSub: string | undefined;
  if (weight) {
    weightSub = latest
      ? `${fmtKg(latest.trendKg)} trend${weight.weekChangeKg !== null ? ` · ${fmtKgDelta(weight.weekChangeKg)} this week` : ''}`
      : 'Log your first weigh-in';
  }
  const settingsSub = profile
    ? `Day rollover ${fmtClock(profile.rolloverHour * 60, { compact: true })} · weeks start Monday`
    : undefined;

  const rows: { label: string; sub: string | undefined; to: string }[] = [
    { label: 'Goals', sub: goalsSub, to: PATHS.goals },
    { label: 'Places', sub: placesSub, to: PATHS.places },
    { label: 'Usuals', sub: usualsSub, to: PATHS.usuals },
    { label: 'Pots', sub: potsSub, to: PATHS.pots },
    { label: 'Weight', sub: weightSub, to: PATHS.weight },
    { label: 'Activity', sub: activitySub, to: PATHS.activity },
    { label: 'Settings', sub: settingsSub, to: PATHS.settings },
  ];

  return (
    <div className={styles.screen}>
      <TopBar
        title="More"
        right={
          profile?.demoMode ? (
            <Pill tone="neutral" bold size="md">
              Demo
            </Pill>
          ) : undefined
        }
      />

      {goalCard ? <GoalCard {...goalCard} headingLevel={2} className={styles.goalCard} /> : null}

      <nav className={styles.rows} aria-label="More">
        <SettingsGroup>
          {rows.map((r) => (
            <SettingsRow key={r.label} label={r.label} sub={r.sub} onPress={() => navigate(r.to)} />
          ))}
        </SettingsGroup>
      </nav>

      <p className={styles.disclaimer}>Estimates are approximate. This app isn't medical advice.</p>
    </div>
  );
}
