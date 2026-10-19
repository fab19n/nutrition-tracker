import { useId } from 'react';
import { Moon } from 'lucide-react';
import { ChipGroup } from '@/components/ui/Chip';
import styles from './TimePicker.module.css';

export interface TimeOption {
  id: string;
  /** "Now", "30 min ago", "1 h ago". */
  label: string;
}

export interface TimePickerProps {
  options: readonly TimeOption[];
  /** Leave undefined when a custom time is chosen. */
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Custom wall-clock time, "HH:MM" (24 h). */
  customValue?: string;
  onCustom: (value: string) => void;
  /** Shown under the picker for times between midnight and the rollover: "Counts toward Thu". */
  afterMidnightHint?: string;
}

/**
 * Sheet body for when the meal was eaten: quick choices plus a custom time.
 * @design C19
 */
export function TimePicker({ options, selectedId, onSelect, customValue, onCustom, afterMidnightHint }: TimePickerProps) {
  const inputId = useId();
  const selectedIndex = options.findIndex((o) => o.id === selectedId);
  const customActive = selectedIndex === -1 && !!customValue;

  return (
    <div className={styles.body}>
      <ChipGroup
        kind="choice"
        stretch
        label="When"
        options={options}
        selectedIndex={selectedIndex}
        getLabel={(o) => o.label}
        onSelect={(i) => {
          const o = options[i];
          if (o) onSelect(o.id);
        }}
      />
      <div className={[styles.custom, customActive ? styles.customActive : ''].join(' ')}>
        <label htmlFor={inputId} className={styles.customLabel}>
          Pick a time
        </label>
        <input
          id={inputId}
          type="time"
          className={styles.time}
          value={customValue ?? ''}
          onChange={(e) => {
            if (e.target.value) onCustom(e.target.value);
          }}
        />
      </div>
      <p className={styles.hint} aria-live="polite">
        {afterMidnightHint ? (
          <>
            <Moon size={16} strokeWidth={2} aria-hidden="true" className={styles.hintIcon} />
            {afterMidnightHint}
          </>
        ) : null}
      </p>
    </div>
  );
}
