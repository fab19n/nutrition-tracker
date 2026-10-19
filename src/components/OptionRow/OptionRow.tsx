import { useRef, type KeyboardEvent, type Ref } from 'react';
import { nextOptionIndex } from './optionKeys';
import styles from './OptionRow.module.css';

/**
 * md — check-in answers (S15): radius 16, padding 13px 14px, 15px/600 label.
 * lg — weekly review step 3 and setup choices: radius 20, padding 14px 16px, 16px/600 label + 12px sub-line.
 */
export type OptionRowSize = 'md' | 'lg';

export interface OptionRowProps {
  label: string;
  sub?: string;
  selected: boolean;
  onSelect: () => void;
  size?: OptionRowSize;
  /** Roving tab index, managed by OptionGroup. */
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * @design C49 option row — radio-style answer row: --card, 22px radio circle (2px --dash border, filled --accent
 * when selected) and a 2px --accent inset ring on the selected row. Use inside OptionGroup.
 */
export function OptionRow({ label, sub, selected, onSelect, size = 'md', tabIndex, onKeyDown, ref }: OptionRowProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      className={[styles.row, styles[size], selected ? styles.selected : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </span>
      <span className={styles.radio} aria-hidden="true" />
    </button>
  );
}

export interface OptionItem {
  id: string;
  label: string;
  sub?: string;
}

export interface OptionGroupProps {
  /** Accessible name of the group, e.g. "Was that everything?". Ignored when `labelledBy` is set. */
  label?: string;
  /** Id of a visible heading that names the group. */
  labelledBy?: string;
  options: readonly OptionItem[];
  /** Selected option id; undefined = nothing picked yet. */
  value?: string;
  onChange: (id: string) => void;
  size?: OptionRowSize;
}

/**
 * Radio group of OptionRows (role="radiogroup"). One row is tabbable (the selected one, else the first);
 * arrow keys move focus and select, as in the WAI-ARIA radio group pattern.
 */
export function OptionGroup({ label, labelledBy, options, value, onChange, size = 'md' }: OptionGroupProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.id === value);
  const tabbable = selectedIndex >= 0 ? selectedIndex : 0;

  const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextOptionIndex(e.key, index, options.length);
    if (next === null) return;
    e.preventDefault();
    const option = options[next];
    if (!option) return;
    refs.current[next]?.focus();
    onChange(option.id);
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={[styles.group, styles[`group_${size}`]].join(' ')}
    >
      {options.map((o, i) => (
        <OptionRow
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          label={o.label}
          sub={o.sub}
          size={size}
          selected={o.id === value}
          tabIndex={i === tabbable ? 0 : -1}
          onSelect={() => onChange(o.id)}
          onKeyDown={handleKeyDown(i)}
        />
      ))}
    </div>
  );
}
