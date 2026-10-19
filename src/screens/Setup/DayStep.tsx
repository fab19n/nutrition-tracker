import { CalendarDays } from 'lucide-react';
import { SetupStep } from '@/components/SetupStep/SetupStep';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Chip';
import { ROLLOVER_HOURS } from '@/db/settings';
import { fmtClock } from '@/domain/format';
import type { StepProps } from './draft';
import styles from './Setup.module.css';

export interface DayStepProps extends StepProps {
  /** completeSetup is running. */
  busy: boolean;
}

export function rolloverLabel(hour: number): string {
  return fmtClock(hour * 60, { compact: true });
}

/** S07 Your day: day rollover (5am default) and week start (Monday) → Done. */
export function DayStep({ step, total, draft, update, onNext, onBack, busy }: DayStepProps) {
  return (
    <SetupStep
      step={step}
      total={total}
      title="Your day"
      helper="Your day ends when you sleep, not at midnight."
      onNext={onNext}
      onBack={busy ? undefined : onBack}
      nextLabel={busy ? 'Setting up…' : 'Done'}
      nextDisabled={busy}
    >
      <div className={styles.stack}>
        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden="true">
            Day rolls over at
          </span>
          <ChipGroup
            kind="choice"
            stretch
            label="Day rolls over at"
            options={ROLLOVER_HOURS}
            selectedIndex={ROLLOVER_HOURS.indexOf(draft.rolloverHour as (typeof ROLLOVER_HOURS)[number])}
            getLabel={rolloverLabel}
            onSelect={(i) => {
              const hour = ROLLOVER_HOURS[i];
              if (hour !== undefined) update({ rolloverHour: hour });
            }}
          />
          <p className={styles.fieldHint}>A 2am supper counts as the night before.</p>
        </div>

        <Card radius="card" padding="14px 16px">
          <div className={styles.infoRow}>
            <span className={styles.infoIcon} aria-hidden="true">
              <CalendarDays size={18} strokeWidth={2} />
            </span>
            <span className={styles.infoText}>
              <span className={styles.infoLabel}>Weeks start on Monday</span>
              <span className={styles.infoSub}>Each week's budget starts fresh. Savings and shortfalls don't carry over.</span>
            </span>
          </div>
        </Card>
      </div>
    </SetupStep>
  );
}
