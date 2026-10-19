import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { typingMatches } from './typingMatches';
import { useFocusTrap } from './useFocusTrap';
import styles from './ConfirmDialog.module.css';

interface ConfirmContent {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Confirm button in --danger (delete entry, delete everything). */
  destructive?: boolean;
  /** Text the user must type before Confirm enables, e.g. "DELETE". Case-sensitive. */
  requireTyping?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ConfirmDialogPanelProps extends ConfirmContent {
  titleId?: string;
  bodyId?: string;
  /** Pre-filled typing, for previews. */
  defaultTyped?: string;
}

/**
 * @design C60 ConfirmDialog content — title, one line, optional "Type DELETE to confirm" field, Cancel / Confirm.
 * Rendered inside ConfirmDialog; exported on its own for static previews.
 */
export function ConfirmDialogPanel({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  requireTyping,
  onConfirm,
  onCancel,
  titleId,
  bodyId,
  defaultTyped = '',
}: ConfirmDialogPanelProps) {
  const id = useId();
  const [typed, setTyped] = useState(defaultTyped);
  const canConfirm = typingMatches(typed, requireTyping);
  const tId = titleId ?? `${id}-title`;
  const bId = bodyId ?? `${id}-body`;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (canConfirm) onConfirm();
  };

  return (
    <form className={styles.panel} onSubmit={submit} noValidate>
      <h2 id={tId} className={styles.title}>
        {title}
      </h2>
      <p id={bId} className={styles.body}>
        {body}
      </p>
      {requireTyping ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Type <b>{requireTyping}</b> to confirm
          </span>
          <input
            className={styles.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-autofocus="true"
          />
        </label>
      ) : null}
      <div className={styles.actions}>
        <Button variant="secondary" size="md" onClick={onCancel} data-autofocus={destructive && !requireTyping ? 'true' : undefined}>
          {cancelLabel}
        </Button>
        <Button type="submit" size="md" className={destructive ? styles.danger : undefined} disabled={!canConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

export interface ConfirmDialogProps extends ConfirmContent {
  open: boolean;
}

/**
 * @design C60 ConfirmDialog — modal over a --sheet scrim with a focus trap. Escape and the scrim cancel;
 * destructive dialogs start on Cancel; focus returns to the trigger on close.
 */
export function ConfirmDialog({ open, ...content }: ConfirmDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, content.onCancel);

  if (!open) return null;
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;

  return createPortal(
    <div className={styles.layer}>
      <div className={styles.scrim} onClick={content.onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role={content.destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <ConfirmDialogPanel {...content} titleId={titleId} bodyId={bodyId} />
      </div>
    </div>,
    document.body,
  );
}
