import { useRef } from 'react';
import { Search, X } from 'lucide-react';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Search places". */
  label: string;
  placeholder?: string;
  /** Enter key, with the trimmed query. */
  onEnter?: (query: string) => void;
  autoFocus?: boolean;
}

/** Search box used at the top of the PlacePicker and ItemSearch sheets. */
export function SearchField({ value, onChange, label, placeholder, onEnter, autoFocus }: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.field}>
      <Search size={16} strokeWidth={2} aria-hidden="true" className={styles.icon} />
      <input
        ref={ref}
        type="search"
        className={styles.input}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="go"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onEnter?.(value.trim());
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
