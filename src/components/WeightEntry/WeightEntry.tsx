import type { KeyboardEvent } from 'react';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { applyWeightKey, isSavableWeight, keyFromKeyboard, KEYPAD_LAYOUT, type WeightKey } from './weightKeypad';
import styles from './WeightEntry.module.css';

export interface WeightEntryProps {
  /** Typed value without unit, e.g. "77.8" (pre-filled with the last weigh-in). */
  value: string;
  /** Called with the next value after every key. After a save the next key starts a fresh entry; clear `saved` here. */
  onChange: (value: string) => void;
  onSave: () => void;
  saved?: boolean;
  /** Shown in place of the button once saved, e.g. "Saved · trend 77.9 kg". */
  savedLabel?: string;
  caption?: string;
  saveLabel?: string;
  /** A save is running: the button waits, so a double tap saves one weigh-in. */
  busy?: boolean;
}

/**
 * @design C50 WeightEntry — centred card: "This morning", 64px value with " kg", 3×4 number pad, Save weigh-in.
 * Digits, "." / "," and Backspace on a physical keyboard work while the pad has focus.
 */
export function WeightEntry({
  value,
  onChange,
  onSave,
  saved = false,
  savedLabel = 'Saved',
  caption = 'This morning',
  saveLabel = 'Save weigh-in',
  busy = false,
}: WeightEntryProps) {
  const press = (key: WeightKey) => {
    const next = applyWeightKey(value, key, saved);
    if (next !== value || saved) onChange(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = keyFromKeyboard(e.key);
    if (!key) return;
    e.preventDefault();
    press(key);
  };

  return (
    <div className={styles.card}>
      <div className={styles.caption}>{caption}</div>
      <output className={styles.value} aria-live="polite" aria-atomic="true">
        {value || '0'}
        <span className={styles.unit}> kg</span>
      </output>

      <div className={styles.pad} role="group" aria-label="Number pad" onKeyDown={handleKeyDown}>
        {KEYPAD_LAYOUT.map((key) =>
          key === 'backspace' ? (
            <button key={key} type="button" className={styles.key} aria-label="Backspace" onClick={() => press(key)}>
              <Delete size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : (
            <button key={key} type="button" className={styles.key} onClick={() => press(key)}>
              {key}
            </button>
          ),
        )}
      </div>

      {saved ? (
        <div className={styles.saved} role="status">
          {savedLabel}
        </div>
      ) : (
        <Button size="md" className={styles.save} onClick={onSave} disabled={busy || !isSavableWeight(value)}>
          {saveLabel}
        </Button>
      )}
    </div>
  );
}
