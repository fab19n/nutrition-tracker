import { useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { servingsText } from '@/components/PotCard/PotCard';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { TopBar } from '@/components/TopBar/TopBar';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { useActiveGoal, useProfile, useToday, useWeightTrend } from '@/db/hooks';
import type { ActiveGoal } from '@/db/selectors';
import { useMoreSummary, type MoreSummary } from '@/db/settings';
import { addDays, compareDays, daysBetween, weekStartOf } from '@/domain/day';
import { fmtClock, fmtDayShort, fmtGrams, fmtInt, fmtKg, fmtKgDelta, fmtSigned, fmtWeekday } from '@/domain/format';
import type { Goal, LogicalDay, Workout, WorkoutType } from '@/domain/types';
import { fmtPaceKg } from '@/screens/Setup/fields';
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

const STATUS_LABEL: Partial<Record<Goal['status'], string>> = { saved: 'Saved', draft: 'Draft' };

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

function savedGoals(summary: MoreSummary | undefined): Goal[] {
  return (summary?.goals ?? []).filter((g) => g.status === 'saved' || g.status === 'draft');
}

/** Active goal card (S48): week of the goal, target, pace, protein, minimum; saved goals as chips. */
function GoalCard({ active, today, minimumKcal, saved }: { active: ActiveGoal; today: LogicalDay; minimumKcal: number; saved: Goal[] }) {
  const { goal, version, period, paused } = active;
  const week = Math.floor(Math.max(0, daysBetween(period.from, today)) / 7) + 1;
  const title = paused ? `${goal.name} · budget off` : `${goal.name} · ${fmtInt(version.dailyKcal)} a day`;
  const pace = goal.paceKgPerWeek === 0 ? 'Hold weight' : `${fmtPaceKg(goal.paceKgPerWeek)} a week`;
  const detail = paused
    ? 'Logging is optional. These days stay out of trends.'
    : [pace, `protein ${fmtGrams(version.proteinG)}`, `min ${fmtInt(minimumKcal)}`].join(' · ');

  return (
    <Card radius="lg" padding="16px 18px" className={styles.goalCard}>
      <div className={styles.goalHead}>
        <div className={styles.goalText}>
          <p className={styles.goalLabel}>Active goal · week {fmtInt(week)}</p>
          <h2 className={styles.goalTitle}>{title}</h2>
          <p className={styles.goalDetail}>{detail}</p>
        </div>
        <span className={styles.activeBadge}>Active</span>
      </div>
      {saved.length > 0 ? (
        <ul className={styles.savedGoals} aria-label="Saved goals">
          {saved.map((g) => (
            <li key={g.id} className={styles.savedGoal}>
              {g.name} · {STATUS_LABEL[g.status]}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** S48 More: the active goal, then Goals, Places, Usuals, Pots, Weight, Activity and Settings with live sub-lines. */
export default function MoreScreen() {
  const navigate = useNavigate();
  const today = useToday();
  const profile = useProfile();
  const active = useActiveGoal();
  const summary = useMoreSummary(today);
  const weight = useWeightTrend();

  const saved = savedGoals(summary);
  const latest = weight?.latest;

  const goalsSub = active ? `${active.goal.name} active${saved.length > 0 ? ` · ${fmtInt(saved.length)} saved` : ''}` : undefined;
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
    { label: 'Goals', sub: goalsSub, to: PATHS.soon('goals') },
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

      {active && profile ? (
        <GoalCard active={active} today={today} minimumKcal={profile.dailyMinimumKcal} saved={saved} />
      ) : null}

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
