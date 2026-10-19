import { Minus, Plus } from 'lucide-react';
import { fmtInt } from '@/domain/format';
import styles from './Setup.module.css';

export interface StepperProps {
  /** Visible label ("Daily minimum"). */
  label: string;
  sub?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Unit after the number ("kcal"). */
  unit: string;
}

/** − value + row (daily minimum in S04 and S19). The value is announced as it changes. */
export function Stepper({ label, sub, value, onChange, min, max, step, unit }: StepperProps) {
  const lower = Math.max(min, value - step);
  const higher = Math.min(max, value + step);
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <div className={styles.stepperText}>
        <span className={styles.stepperLabel}>{label}</span>
        {sub ? <span className={styles.stepperSub}>{sub}</span> : null}
      </div>
      <div className={styles.stepperControls}>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`Lower ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(lower)}
        >
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <output className={styles.stepperValue} aria-live="polite">
          {fmtInt(value)}
          <span className={styles.stepperUnit}> {unit}</span>
        </output>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`Raise ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(higher)}
        >
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
