import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { SectionHeading } from '@/components/ui/SectionHeading';
import styles from './SettingsRow.module.css';

export interface SettingsRowProps {
  label: string;
  sub?: string;
  /** Current value shown before the chevron, e.g. "5am" or "1,400 kcal". */
  value?: string;
  /** Makes the row a button with a chevron (or, when destructive, without one). */
  onPress?: () => void;
  /** Renders a switch instead of a chevron. */
  toggle?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };
  /** Delete everything, Disconnect… Label in --danger. */
  destructive?: boolean;
}

/**
 * @design C54 SettingsRow — 16px/600 label, 12px --muted sub-line, value and chevron or a switch;
 * the destructive version uses --danger. Place rows inside a SettingsGroup.
 */
export function SettingsRow({ label, sub, value, onPress, toggle, destructive }: SettingsRowProps) {
  const text = (
    <span className={styles.text}>
      <span className={[styles.label, destructive ? styles.destructive : ''].filter(Boolean).join(' ')}>{label}</span>
      {sub ? <span className={styles.sub}>{sub}</span> : null}
    </span>
  );
  const valueEl = value ? <span className={styles.value}>{value}</span> : null;

  if (toggle) {
    return (
      <div className={styles.row}>
        {text}
        <span className={styles.end}>
          {valueEl}
          <Toggle label={label} checked={toggle.checked} onChange={toggle.onChange} disabled={toggle.disabled} />
        </span>
      </div>
    );
  }

  if (onPress) {
    return (
      <button type="button" className={[styles.row, styles.pressable].join(' ')} onClick={onPress}>
        {text}
        <span className={styles.end}>
          {valueEl}
          {destructive ? null : <ChevronRight size={18} strokeWidth={2} className={styles.chevron} aria-hidden="true" />}
        </span>
      </button>
    );
  }

  return (
    <div className={styles.row}>
      {text}
      {valueEl ? <span className={styles.end}>{valueEl}</span> : null}
    </div>
  );
}

export interface SettingsGroupProps {
  /** Section heading above the card ("BUDGET"). */
  title?: string;
  children: ReactNode;
  /** Small note under the card. */
  note?: string;
}

/** @design C54 SettingsGroup — --card list, radius 20, --line hairlines between rows. */
export function SettingsGroup({ title, children, note }: SettingsGroupProps) {
  return (
    <section className={styles.section}>
      {title ? <SectionHeading inset={20}>{title}</SectionHeading> : null}
      <div className={styles.group}>{children}</div>
      {note ? <p className={styles.note}>{note}</p> : null}
    </section>
  );
}
