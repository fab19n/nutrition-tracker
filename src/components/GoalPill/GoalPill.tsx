import styles from './GoalPill.module.css';

export interface GoalPillProps {
  /** "Cut · 1,800", "Lean bulk · 130g", "Festive · 2,100", "Paused until Mon". */
  label: string;
  /** Opens Goals (S41). */
  onPress: () => void;
  className?: string;
}

/** @design C03 GoalPill — the active goal and its key target. */
export function GoalPill({ label, onPress, className }: GoalPillProps) {
  return (
    <button
      type="button"
      className={[styles.pill, className].filter(Boolean).join(' ')}
      aria-label={`Goal: ${label}`}
      onClick={onPress}
    >
      <span className={styles.label}>{label}</span>
    </button>
  );
}
