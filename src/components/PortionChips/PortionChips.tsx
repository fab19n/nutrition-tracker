import { ChipGroup } from '@/components/ui/Chip';
import type { Variant } from '@/domain/types';
import styles from './PortionChips.module.css';

export interface PortionChipsProps {
  variants: readonly Variant[];
  /** Index of the chosen variant; -1 for none. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Accessible name for the group, e.g. "Rice portion". */
  label: string;
  /** 'plate' is the plate builder's row (S24): 7px 13px chips on one line. */
  variant?: 'standard' | 'plate';
}

/**
 * Single-select portion words (Small / Normal / Mamak big, Sikit / Normal / Banjir …).
 * @design C22
 */
export function PortionChips({ variants, selectedIndex, onSelect, label, variant = 'standard' }: PortionChipsProps) {
  const group = (
    <ChipGroup
      kind="portion"
      label={label}
      options={variants}
      selectedIndex={selectedIndex}
      getLabel={(v) => v.label}
      onSelect={onSelect}
      wrap={variant !== 'plate'}
    />
  );
  return variant === 'plate' ? <div className={styles.plate}>{group}</div> : group;
}
