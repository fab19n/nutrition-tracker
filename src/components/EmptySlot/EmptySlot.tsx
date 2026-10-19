import { Button } from '@/components/ui/Button';
import styles from './EmptySlot.module.css';

export interface EmptySlotProps {
  /** "Dinner" */
  slotLabel: string;
  title?: string;
  actionLabel?: string;
  /** Without it the slot shows no button (e.g. past days in the Diary). */
  onAction?: () => void;
}

/** @design C30 MealSectionHeader (empty slot) — dashed 2px --dash box: "Dinner / Not logged yet" + Meal ideas pill. */
export function EmptySlot({ slotLabel, title = 'Not logged yet', actionLabel = 'Meal ideas', onAction }: EmptySlotProps) {
  return (
    <div className={styles.slot}>
      <div className={styles.text}>
        <div className={styles.slotLabel}>{slotLabel}</div>
        <div className={styles.title}>{title}</div>
      </div>
      {onAction ? (
        <Button size="pill" onClick={onAction} aria-label={`${actionLabel} for ${slotLabel.toLowerCase()}`}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export interface MealSectionHeaderProps {
  /** "Lunch" */
  slotLabel: string;
  /** Pre-formatted subtotal, e.g. "~670 kcal". */
  subtotalLabel?: string;
}

/** @design C30 MealSectionHeader — slot name and subtotal above a slot's MealRows. */
export function MealSectionHeader({ slotLabel, subtotalLabel }: MealSectionHeaderProps) {
  return (
    <div className={styles.header}>
      <h3 className={styles.headerLabel}>{slotLabel}</h3>
      {subtotalLabel ? <span className={styles.subtotal}>{subtotalLabel}</span> : null}
    </div>
  );
}
