import { Chip } from '@/components/ui/Chip';
import type { MealSlot } from '@/domain/types';
import { MEAL_SLOTS, SLOT_LABEL } from './slots';
import styles from './SlotPicker.module.css';

export { MEAL_SLOTS, SLOT_LABEL } from './slots';

export interface SlotPickerProps {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  /** Accessible name for the group. */
  label?: string;
}

/**
 * Breakfast · Lunch · Dinner · Snack · Supper. The app suggests one; the user can change it.
 * Card chips (they usually sit on the sheet's --bg), selected in --accent.
 * @design C20
 */
export function SlotPicker({ value, onChange, label = 'Meal' }: SlotPickerProps) {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {MEAL_SLOTS.map((slot) => (
        <Chip
          key={slot}
          kind="context"
          selected={slot === value}
          aria-pressed={slot === value}
          onClick={() => onChange(slot)}
        >
          {SLOT_LABEL[slot]}
        </Chip>
      ))}
    </div>
  );
}
