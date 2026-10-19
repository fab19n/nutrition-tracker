import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

/**
 * portion — C22 PortionChips: unselected --chip/--text, selected --accent/--on-accent; 13px/600, 6px 12px.
 * context — C19/C20 context chips (Now, Dinner): --card pill, 13px, 7px 12px.
 * place   — C18 PlaceChip: --accent pill, 13px/600, 7px 12px.
 * choice  — big day chips in S18 (15px/700, 14px vertical padding, 16px radius).
 * All chips keep a 44px hit area even though they render ~30px tall.
 */
export type ChipKind = 'portion' | 'context' | 'place' | 'choice';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  kind?: ChipKind;
  selected?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Chip({ kind = 'portion', selected, icon, className, children, type = 'button', ...rest }: ChipProps) {
  const cls = [styles.chip, styles[kind], selected ? styles.selected : '', className ?? ''].filter(Boolean).join(' ');
  const isToggle = kind === 'portion' || kind === 'choice';
  return (
    <button type={type} className={cls} aria-pressed={isToggle ? !!selected : undefined} {...rest}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

export interface ChipGroupProps<T> {
  options: readonly T[];
  selectedIndex: number;
  getLabel: (option: T) => ReactNode;
  onSelect: (index: number) => void;
  kind?: ChipKind;
  /** Accessible name for the group, e.g. "Rice portion". */
  label: string;
  wrap?: boolean;
  /** Stretch chips to equal widths (S18 day picker). */
  stretch?: boolean;
}

export function ChipGroup<T>({
  options,
  selectedIndex,
  getLabel,
  onSelect,
  kind = 'portion',
  label,
  wrap = true,
  stretch,
}: ChipGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className={[styles.group, wrap ? styles.wrap : '', stretch ? styles.stretch : ''].join(' ')}>
      {options.map((o, i) => (
        <Chip key={i} kind={kind} selected={i === selectedIndex} onClick={() => onSelect(i)}>
          {getLabel(o)}
        </Chip>
      ))}
    </div>
  );
}
