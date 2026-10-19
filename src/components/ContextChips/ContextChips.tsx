import type { ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { Chip } from '@/components/ui/Chip';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import type { MealSlot } from '@/domain/types';
import styles from './ContextChips.module.css';

export interface PlaceChipProps {
  /** Chosen or auto-selected Place. Leave out for the "none" state ("Where?"). */
  name?: string;
  /** Auto-selected by location: adds " · Nearby". */
  nearby?: boolean;
  /** Created during this log: adds " · New". */
  isNew?: boolean;
  onPress: () => void;
}

/**
 * Where the meal was eaten. Accent pill with a pin when a Place is set; a card pill reading
 * "Where?" when none is. Opens the PlacePicker sheet.
 * @design C18
 */
export function PlaceChip({ name, nearby, isNew, onPress }: PlaceChipProps) {
  const pin = <MapPin size={16} strokeWidth={2} />;
  if (!name) {
    return (
      <Chip kind="context" icon={pin} onClick={onPress} aria-haspopup="dialog">
        Where?
      </Chip>
    );
  }
  const suffix = nearby ? 'Nearby' : isNew ? 'New' : null;
  return (
    <Chip kind="place" icon={pin} onClick={onPress} aria-haspopup="dialog" className={styles.place}>
      <span className="sr-only">Place: </span>
      <span className={styles.name}>{name}</span>
      {suffix ? (
        <span className={styles.suffix}>
          {/* The chip's 4px flex gap stands in for the space before the dot. */}
          <span aria-hidden="true">· </span>
          <span className="sr-only">, </span>
          {suffix}
        </span>
      ) : null}
    </Chip>
  );
}

export interface TimeChipProps {
  /** "Now", "30 min ago", "Now · 7:10pm", "12:40am · counts toward Thu". */
  label: string;
  onPress: () => void;
}

/** When the meal was eaten. Opens the TimePicker sheet. @design C19 */
export function TimeChip({ label, onPress }: TimeChipProps) {
  return (
    <Chip kind="context" onClick={onPress} aria-haspopup="dialog">
      <span className="sr-only">Time: </span>
      {label}
    </Chip>
  );
}

export interface MealSlotChipProps {
  slot: MealSlot;
  onPress: () => void;
}

/** The suggested meal slot. Opens the SlotPicker. @design C20 */
export function MealSlotChip({ slot, onPress }: MealSlotChipProps) {
  return (
    <Chip kind="context" onClick={onPress} aria-haspopup="dialog">
      <span className="sr-only">Meal: </span>
      {SLOT_LABEL[slot]}
    </Chip>
  );
}

export interface ContextChipRowProps {
  children: ReactNode;
  /** Accessible name for the row. */
  label?: string;
}

/** Place · time · slot chips above Log, Review and Plate (gap 6, wraps). */
export function ContextChipRow({ children, label = 'Meal details' }: ContextChipRowProps) {
  return (
    <div role="group" aria-label={label} className={styles.row}>
      {children}
    </div>
  );
}
