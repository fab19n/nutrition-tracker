import { useId, type Ref } from 'react';
import styles from './Setup.module.css';

export interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** "years", "cm", "kg". */
  unit: string;
  /** Helper under the field ("An estimate is fine"). */
  hint?: string;
  /** Shown instead of the hint when set. */
  error?: string | null;
  decimal?: boolean;
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Labelled numeric text field with a unit, used in setup (S02) and the profile sheet (S19). */
export function NumberField({ label, value, onChange, onBlur, unit, hint, error, decimal, placeholder, ref }: NumberFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={[styles.inputWrap, error ? styles.inputInvalid : ''].filter(Boolean).join(' ')}>
        <input
          ref={ref}
          id={id}
          className={styles.input}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          enterKeyHint="next"
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <span className={styles.unit} aria-hidden="true">
          {unit}
        </span>
      </div>
      {note ? (
        <p id={noteId} className={error ? styles.fieldError : styles.fieldHint}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
