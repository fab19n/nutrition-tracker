import { useId, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './CorrectionScopePrompt.module.css';

export interface CorrectionScopePromptProps {
  /** "You've corrected the rice portion here twice. Make big rice the default?" */
  message: string;
  onYes: () => void;
  onJustThisTime: () => void;
  yesLabel?: string;
}

/**
 * Asked after the same correction has been made twice at one Place.
 * @design C28
 */
export function CorrectionScopePrompt({ message, onYes, onJustThisTime, yesLabel = 'Yes' }: CorrectionScopePromptProps) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <p id={id} className={styles.message}>
        {message}
      </p>
      <div className={styles.actions}>
        <Button size="sm" onClick={onYes}>
          {yesLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onJustThisTime}>
          Just this time
        </Button>
      </div>
    </section>
  );
}

export type CorrectionScope = 'once' | 'place' | 'dish';

export const SCOPE_OPTIONS: readonly { value: CorrectionScope; label: string }[] = [
  { value: 'once', label: 'This time' },
  { value: 'place', label: 'Always at this Place' },
  { value: 'dish', label: 'Always for this dish' },
];

export interface ScopePickerProps {
  value: CorrectionScope;
  onChange: (value: CorrectionScope) => void;
  /** Accessible name for the group. */
  label?: string;
}

/**
 * How widely a fix applies. A radio group: arrow keys move and select, Tab leaves the group.
 * @design C28
 */
export function ScopePicker({ value, onChange, label = 'Apply this fix' }: ScopePickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, SCOPE_OPTIONS.findIndex((o) => o.value === value));

  const move = (delta: number) => {
    const n = SCOPE_OPTIONS.length;
    const next = (current + delta + n) % n;
    const option = SCOPE_OPTIONS[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div role="radiogroup" aria-label={label} className={styles.options}>
      {SCOPE_OPTIONS.map((o, i) => {
        const checked = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={[styles.option, checked ? styles.checked : ''].join(' ')}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
          >
            <span className={styles.optionLabel}>{o.label}</span>
            <span className={styles.radio} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
