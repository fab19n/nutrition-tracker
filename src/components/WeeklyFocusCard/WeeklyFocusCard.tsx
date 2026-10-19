import styles from './WeeklyFocusCard.module.css';

export interface WeeklyFocusCardProps {
  /** The focus as picked in the weekly review: "Kurang manis for drinks". Shown mid-sentence ("kurang manis for drinks"). */
  label: string;
  /** Right side, bold: "0 of 5", "No drinks yet". */
  progressLabel?: string;
  /** Read instead of progressLabel: "2 of 3 drinks kurang or kosong so far". */
  progressDescription?: string;
  /** Makes the card tappable (e.g. to the weekly review). */
  onPress?: () => void;
  className?: string;
}

/**
 * Lower-cases the first letter so a label reads mid-sentence: "Kurang manis for drinks" →
 * "kurang manis for drinks". A first word in capitals ("MyFCD", "RM") is left alone.
 */
export function focusPhrase(label: string): string {
  const text = label.trim();
  const firstWord = text.split(/\s+/)[0] ?? '';
  if (firstWord.length > 1 && /[A-Z]/.test(firstWord.slice(1))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** @design C44 WeeklyFocusCard — "This week's focus: kurang manis for drinks" with "0 of 5" bold on the right. */
export function WeeklyFocusCard({ label, progressLabel, progressDescription, onPress, className }: WeeklyFocusCardProps) {
  const cls = [styles.card, onPress ? styles.pressable : '', className].filter(Boolean).join(' ');
  const content = (
    <>
      <span className={styles.text}>
        <b>This week&apos;s focus:</b> {focusPhrase(label)}
      </span>
      {progressLabel ? (
        <span className={styles.progress}>
          <span aria-hidden={progressDescription ? true : undefined}>{progressLabel}</span>
          {progressDescription ? <span className="sr-only">{progressDescription}</span> : null}
        </span>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <button type="button" className={cls} onClick={onPress}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}
