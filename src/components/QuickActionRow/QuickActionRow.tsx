import type { CSSProperties, ReactNode } from 'react';
import styles from './QuickActionRow.module.css';

export interface QuickAction {
  id: string;
  label: string;
  /** A 20px lucide icon, e.g. <Camera size={20} />. */
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}

export interface QuickActionRowProps {
  actions: readonly QuickAction[];
}

/**
 * Photo · Plate · Usuals · Pot tiles in the Log sheet. Four columns; a fifth action
 * (barcode, later) adds a column instead of wrapping.
 * @design C17
 */
export function QuickActionRow({ actions }: QuickActionRowProps) {
  const style = { '--cols': Math.max(4, actions.length) } as CSSProperties;
  return (
    <div className={styles.grid} style={style}>
      {actions.map((a) => (
        <button key={a.id} type="button" className={styles.tile} onClick={a.onPress} disabled={a.disabled}>
          <span className={styles.icon} aria-hidden="true">
            {a.icon}
          </span>
          {a.label}
        </button>
      ))}
    </div>
  );
}
