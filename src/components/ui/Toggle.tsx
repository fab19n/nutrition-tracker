import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Also save as a Usual". */
  label: string;
  disabled?: boolean;
}

/** 40×24 switch (S11 "Also save as a Usual", settings rows). */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={[styles.track, checked ? styles.on : ''].join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  );
}
