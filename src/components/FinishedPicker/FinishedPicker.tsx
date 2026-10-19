import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ChipGroup } from '@/components/ui/Chip';
import type { Finished } from '@/domain/types';
import styles from './FinishedPicker.module.css';

export const FINISHED_OPTIONS: readonly Finished[] = ['all', 'most', 'half'];

export const FINISHED_LABEL: Record<Finished, string> = { all: 'All', most: 'Most', half: 'Half' };

/** Collapsed-row text: the question while it's "all", otherwise the current answer. */
export const FINISHED_SUMMARY: Record<Finished, string> = {
  all: 'Finished it all?',
  most: 'Ate most of it',
  half: 'Ate about half',
};

export interface FinishedPickerProps {
  value: Finished;
  onChange: (value: Finished) => void;
  /** Start expanded (photo flows ask up front). */
  defaultExpanded?: boolean;
}

/**
 * "Finished it all? ▾" — expands to All / Most / Half chips and collapses again after a pick.
 * Right-aligned so it can sit in the AddItemRow's right slot.
 * @design C26
 */
export function FinishedPicker({ value, onChange, defaultExpanded = false }: FinishedPickerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  const chosen = value !== 'all';

  return (
    <div className={styles.picker}>
      <button
        type="button"
        className={[styles.toggle, chosen ? styles.chosen : ''].join(' ')}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((e) => !e)}
      >
        {FINISHED_SUMMARY[value]}
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className={[styles.chevron, expanded ? styles.open : ''].join(' ')}
        />
      </button>
      <div id={panelId} hidden={!expanded} className={styles.panel}>
        <ChipGroup
          kind="portion"
          label="How much did you finish?"
          options={FINISHED_OPTIONS}
          selectedIndex={FINISHED_OPTIONS.indexOf(value)}
          getLabel={(f) => FINISHED_LABEL[f]}
          onSelect={(i) => {
            const f = FINISHED_OPTIONS[i];
            if (f) onChange(f);
            setExpanded(false);
          }}
        />
      </div>
    </div>
  );
}
