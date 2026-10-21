import { useRef } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import styles from './FilePickButton.module.css';

export interface FilePickButtonProps {
  label: string;
  /** The chosen file. Not called when the picker is cancelled. */
  onFile: (file: File) => void;
  /** What the picker offers. Only a hint: the app checks a file's content, never its type. */
  accept?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Working on a file already: the button is disabled and says so to screen readers. */
  busy?: boolean;
  /** The hidden input's name for screen readers. */
  inputLabel?: string;
}

/**
 * A button that opens the phone's file picker (Choose a backup file, Restore from a backup file).
 * The real <input type="file"> is hidden and reset after each pick, so choosing the same file
 * again still counts. Presentational: no database, no store.
 */
export function FilePickButton({
  label,
  onFile,
  accept = '.json,application/json',
  variant = 'secondary',
  size = 'md',
  disabled,
  busy,
  inputLabel = 'Backup file',
}: FilePickButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        className={styles.file}
        accept={accept}
        aria-label={inputLabel}
        tabIndex={-1}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          // Cleared so the same file can be chosen again.
          input.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
