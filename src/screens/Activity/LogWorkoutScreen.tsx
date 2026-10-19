import { useId, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { OneOffBonus, type OneOffBonusValue } from '@/components/OneOffBonus/OneOffBonus';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { WorkoutForm } from '@/components/WorkoutForm/WorkoutForm';
import { initialWorkoutValue, parseMinutes, type WorkoutFormValue } from '@/components/WorkoutForm/workoutOptions';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { logBonus, logWorkout, useWorkoutContext } from '@/db/activity';
import { netWorkoutKcal } from '@/domain/workout';
import type { LogicalDay } from '@/domain/types';
import { useInFlight } from '@/screens/inFlight';
import { useUiStore } from '@/state/ui';
import { bonusToast, dayPhrase, weekPhrase, workoutToast } from './activityModel';
import styles from './Activity.module.css';

const NO_WEIGHT_NOTE = 'Add a weigh-in first, so there is a weight to estimate from.';

/**
 * @design S29 Log workout — day (today back to Monday, never ahead), WorkoutForm with the live
 * estimate from the latest weight, Save; "Big one-off day?" opens OneOffBonus. Both save with
 * an undo toast and return to Activity.
 */
export default function LogWorkoutScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const showToast = useUiStore((s) => s.showToast);
  const context = useWorkoutContext();
  const inFlight = useInFlight();
  const bonusId = useId();

  const [typed, setTyped] = useState<WorkoutFormValue | null>(null);
  const [pickedDay, setPickedDay] = useState<LogicalDay | null>(null);
  const [tried, setTried] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);

  // Opened from Activity (or the Diary): Back and Save return there; a deep link lands on Activity.
  const hasHistory = location.key !== 'default';
  const leave = () => (hasHistory ? goBack(navigate) : navigate(PATHS.activity, { replace: true }));
  const header = <SubScreenHeader title="Log workout" onBack={leave} backLabel={hasHistory ? 'Back' : 'Back to Activity'} />;

  if (!context) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.block}>
          <SkeletonList count={2} label="Loading" />
        </div>
      </div>
    );
  }

  const { today, weightKg, days } = context;
  const options = days.options;
  const offered = (day: string | null): day is LogicalDay => day !== null && options.some((o) => o.day === day);
  // A day picked here, else ?day= from a link (when it's on offer), else today.
  const day = [pickedDay, params.get('day')].find(offered) ?? today;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.day === day));

  const value = typed ?? initialWorkoutValue(context.lastWorkout);
  const minutes = parseMinutes(value.minutesText);
  const estimate = minutes !== null && weightKg !== undefined ? netWorkoutKcal(value.type, value.intensity, minutes, weightKg) : null;

  const save = () =>
    void inFlight.run('save', async () => {
      if (minutes === null) {
        setTried(true);
        return;
      }
      try {
        const { workout, undo } = await logWorkout({ type: value.type, intensity: value.intensity, minutes, day });
        showToast(workoutToast(workout, today), () => void undo());
        leave();
      } catch {
        showToast("Couldn't save the workout. Try again.");
      }
    });

  const addBonus = (bonusValue: OneOffBonusValue) =>
    void inFlight.run('save', async () => {
      try {
        const { bonus, undo } = await logBonus({ kcal: bonusValue.kcal, reason: bonusValue.reason, day });
        showToast(bonusToast(bonus, today), () => void undo());
        leave();
      } catch {
        showToast("Couldn't add the bonus. Try again.");
      }
    });

  const saving = inFlight.busy('save');

  return (
    <div className={styles.screen}>
      {header}

      <div className={styles.block}>
        <span className={['t-section', styles.label].join(' ')} aria-hidden="true">
          Day
        </span>
        <ChipGroup
          label="Day"
          options={options}
          selectedIndex={selectedIndex}
          getLabel={(o) => o.label}
          onSelect={(i) => {
            const option = options[i];
            if (option) setPickedDay(option.day);
          }}
        />
        {days.limitNote ? (
          <p className={styles.dayNote}>
            {days.limitNote}
          </p>
        ) : null}
      </div>

      <WorkoutForm
        className={styles.block}
        value={value}
        onChange={setTyped}
        estimateKcal={estimate}
        weekLabel={weekPhrase(day, today)}
        estimateNote={weightKg === undefined ? NO_WEIGHT_NOTE : undefined}
        showErrors={tried}
      />

      <div className={styles.saveRow}>
        <Button onClick={save} disabled={saving || weightKg === undefined} aria-busy={saving ? true : undefined}>
          Save
        </Button>
      </div>

      <div className={styles.linkRow}>
        <button
          type="button"
          className={styles.link}
          aria-expanded={bonusOpen}
          aria-controls={bonusOpen ? bonusId : undefined}
          onClick={() => setBonusOpen((open) => !open)}
        >
          Big one-off day?
        </button>
      </div>
      {bonusOpen ? (
        <div className={styles.block}>
          <OneOffBonus id={bonusId} dayLabel={dayPhrase(day, today)} busy={saving} autoFocus onSubmit={addBonus} />
        </div>
      ) : null}
    </div>
  );
}
