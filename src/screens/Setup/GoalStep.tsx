import { SetupStep } from '@/components/SetupStep/SetupStep';
import { OptionGroup } from '@/components/OptionRow/OptionRow';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Chip';
import { DAILY_MINIMUM_STEP, PROFILE_LIMITS } from '@/db/settings';
import { fmtApprox, fmtInt, fmtKcal } from '@/domain/format';
import { dailyTargetFor, deficitForPace, startingMaintenance } from '@/domain/targets';
import { PACE_OPTIONS, bodyOf, dailyMinimumOf, type StepProps } from './draft';
import { Stepper } from './Stepper';
import styles from './Setup.module.css';

const PACE_LABELS: Record<(typeof PACE_OPTIONS)[number], string> = { 0.25: '0.25 kg', 0.5: '0.5 kg', 0.75: '0.75 kg' };

const GOAL_OPTIONS = [{ id: 'cut', label: 'Cut', sub: 'Lose fat at a steady pace. Other goals live in More.' }] as const;

/** Starting maintenance and the Cut target for the answers so far (S04's live result). */
export function setupTargets(draft: StepProps['draft']): { maintenanceKcal: number; dailyKcal: number; atMinimum: boolean } | null {
  const body = bodyOf(draft);
  if (!body || !draft.activity) return null;
  const maintenanceKcal = startingMaintenance({ ...body, activity: draft.activity });
  const minimum = dailyMinimumOf(draft);
  const dailyKcal = dailyTargetFor({ template: 'cut', paceKgPerWeek: draft.paceKgPerWeek }, maintenanceKcal, minimum);
  return { maintenanceKcal, dailyKcal, atMinimum: maintenanceKcal - deficitForPace(draft.paceKgPerWeek) < minimum };
}

/** S04 Goal and pace: Cut pre-selected, pace chips, the live target and the daily minimum. */
export function GoalStep({ step, total, draft, update, onNext, onBack }: StepProps) {
  const targets = setupTargets(draft);
  const minimum = dailyMinimumOf(draft);

  return (
    <SetupStep
      step={step}
      total={total}
      title="Goal and pace"
      helper="The result updates as you change the pace."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={!targets}
    >
      <div className={styles.stack}>
        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden="true">
            Goal
          </span>
          <OptionGroup label="Goal" size="lg" options={GOAL_OPTIONS} value="cut" onChange={() => {}} />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden="true">
            Pace, per week
          </span>
          <ChipGroup
            kind="choice"
            stretch
            label="Pace, per week"
            options={PACE_OPTIONS}
            selectedIndex={PACE_OPTIONS.indexOf(draft.paceKgPerWeek as (typeof PACE_OPTIONS)[number])}
            getLabel={(p) => PACE_LABELS[p]}
            onSelect={(i) => {
              const pace = PACE_OPTIONS[i];
              if (pace !== undefined) update({ paceKgPerWeek: pace });
            }}
          />
        </div>

        {targets ? (
          <div className={styles.result}>
            <p className={styles.resultLine} aria-live="polite">
              Starting maintenance {fmtApprox(targets.maintenanceKcal)} → daily target <b>{fmtKcal(targets.dailyKcal)}</b>
            </p>
            <p className={styles.resultNote}>
              {targets.atMinimum
                ? 'Held at your daily minimum: this pace would go below it.'
                : `That's ${fmtInt(targets.dailyKcal * 7)} a week, plus workouts. After 3 weeks of weigh-ins the app checks maintenance, and any change waits for your OK.`}
            </p>
          </div>
        ) : null}

        <Card radius="card" padding="4px 16px">
          <Stepper
            label="Daily minimum"
            sub="No day's allowance goes below this"
            value={minimum}
            min={PROFILE_LIMITS.dailyMinimumKcal.min}
            max={PROFILE_LIMITS.dailyMinimumKcal.max}
            step={DAILY_MINIMUM_STEP}
            unit="kcal"
            onChange={(dailyMinimumKcal) => update({ dailyMinimumKcal })}
          />
        </Card>
      </div>
    </SetupStep>
  );
}
