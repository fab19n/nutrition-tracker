import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { checkBonus } from './bonusForm';
import styles from './OneOffBonus.module.css';

export interface OneOffBonusValue {
  kcal: number;
  /** Trimmed; empty when none was given. */
  reason: string;
}

export interface OneOffBonusProps {
  /** Called with a valid bonus; invalid input shows its messages instead. */
  onSubmit: (bonus: OneOffBonusValue) => void;
  /** Completes "+ … kcal today": "today" (default), "yesterday", "on Wed". */
  dayLabel?: string;
  /** While saving: the button waits. */
  busy?: boolean;
  submitLabel?: string;
  /** Focus the amount when the form appears (it opens from a link). */
  autoFocus?: boolean;
  /** Starting values and messages, for previews. */
  defaultKcal?: string;
  defaultReason?: string;
  defaultTried?: boolean;
  id?: string;
  className?: string;
}

/**
 * @design C52 OneOffBonus — "+ kcal today" with a reason ("A hike", "Futsal tournament") for an
 * unusual day. Messages show after the first Add; the parent saves.
 */
export function OneOffBonus({
  onSubmit,
  dayLabel = 'today',
  busy,
  submitLabel = 'Add bonus',
  autoFocus,
  defaultKcal = '',
  defaultReason = '',
  defaultTried = false,
  id,
  className,
}: OneOffBonusProps) {
  const uid = useId();
  const kcalId = `${uid}-kcal`;
  const reasonId = `${uid}-reason`;
  const [kcalText, setKcalText] = useState(defaultKcal);
  const [reasonText, setReasonText] = useState(defaultReason);
  const [tried, setTried] = useState(defaultTried);
  const check = checkBonus(kcalText, reasonText);
  const kcalError = tried ? check.errors.kcal : undefined;
  const reasonError = tried ? check.errors.reason : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setTried(true);
    if (check.valid && check.kcal !== null) onSubmit({ kcal: check.kcal, reason: check.reason });
  };

  return (
    <form id={id} className={[styles.card, className].filter(Boolean).join(' ')} onSubmit={submit} noValidate>
      <p className={styles.hint}>For an unusual day, like a hike or a futsal tournament. It goes on the day and adds to that week&apos;s budget.</p>

      <div className={styles.field}>
        <label htmlFor={kcalId} className={styles.fieldLabel}>
          Extra kcal <span className="sr-only">{dayLabel}</span>
        </label>
        <div className={[styles.inputWrap, kcalError ? styles.invalid : ''].filter(Boolean).join(' ')}>
          <span className={[styles.affix, styles.plus].join(' ')} aria-hidden="true">
            +
          </span>
          <input
            id={kcalId}
            className={styles.input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="300"
            value={kcalText}
            aria-invalid={kcalError ? true : undefined}
            aria-describedby={kcalError ? `${kcalId}-error` : undefined}
            autoFocus={autoFocus}
            onChange={(e) => setKcalText(e.target.value)}
          />
          <span className={styles.affix} aria-hidden="true">
            kcal {dayLabel}
          </span>
        </div>
        {kcalError ? (
          <p id={`${kcalId}-error`} className={styles.error}>
            {kcalError}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor={reasonId} className={styles.fieldLabel}>
          Reason <span className={styles.optional}>(optional)</span>
        </label>
        <div className={[styles.inputWrap, reasonError ? styles.invalid : ''].filter(Boolean).join(' ')}>
          <input
            id={reasonId}
            className={styles.input}
            type="text"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="A hike"
            value={reasonText}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : undefined}
            onChange={(e) => setReasonText(e.target.value)}
          />
        </div>
        {reasonError ? (
          <p id={`${reasonId}-error`} className={styles.error}>
            {reasonError}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="md" disabled={busy} aria-busy={busy ? true : undefined}>
        {submitLabel}
      </Button>
    </form>
  );
}
