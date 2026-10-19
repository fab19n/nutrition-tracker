import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import styles from './AddItemRow.module.css';

export interface AddItemRowProps {
  /** Opens ItemSearch. */
  onAdd: () => void;
  label?: string;
  /** Right-hand control, usually the FinishedPicker. */
  right?: ReactNode;
}

/**
 * The row under the review items: "+ Add item" on the left, an optional control on the right.
 * @design C21
 */
export function AddItemRow({ onAdd, label = 'Add item', right }: AddItemRowProps) {
  return (
    <div className={styles.row}>
      <button type="button" className={styles.add} onClick={onAdd}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        {label}
      </button>
      {right ? <div className={styles.right}>{right}</div> : null}
    </div>
  );
}
