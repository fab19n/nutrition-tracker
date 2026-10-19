import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * nav   — Diary Day/Week switch: --card track, active segment --nav / --nav-active (13px/600, 6px 14px).
 * inset — small switches like the weight range (14d/30d/90d) and "View under": --card2 track,
 *         active segment --card / --text (11–12px/600).
 */
export type SegmentedTone = 'nav' | 'inset';

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  tone?: SegmentedTone;
}

export function Segmented<T extends string>({ options, value, onChange, label, tone = 'nav' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={[styles.track, styles[tone]].join(' ')}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={[styles.seg, active ? styles.active : ''].join(' ')}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
