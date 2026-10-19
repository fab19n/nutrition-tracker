import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Camera, WifiOff } from 'lucide-react';
import styles from './LogInput.module.css';

export const LOG_PLACEHOLDER = 'nasi lemak ayam goreng, teh o ais';

export interface LogInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the trimmed text on Enter or the Estimate button. Never called when empty. */
  onSubmit: (text: string) => void;
  /** Shows the camera button when given. */
  onCamera?: () => void;
  /** 12px footer hint: "Type it like a message", "Matches from your library · no AI yet". */
  hint: string;
  placeholder?: string;
  /** No connection: the hint gets an offline icon; Estimate still queues the text. */
  offline?: boolean;
  /** The estimate request is on its way: the button reads "Estimating…" and input is locked. */
  sending?: boolean;
  autoFocus?: boolean;
}

/**
 * The single text box for logging, written like a message.
 * Enter sends, Shift+Enter adds a line. The box grows with its text.
 * @design C16
 */
export function LogInput({
  value,
  onChange,
  onSubmit,
  onCamera,
  hint,
  placeholder = LOG_PLACEHOLDER,
  offline,
  sending,
  autoFocus,
}: LogInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const text = value.trim();
  const canSend = text.length > 0 && !sending;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight is 0 while hidden; fall back to the CSS min-height then.
    el.style.height = el.scrollHeight > 0 ? `${el.scrollHeight}px` : '';
  }, [value]);

  const submit = () => {
    if (canSend) onSubmit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter while an IME is composing (e.g. picking a candidate).
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <div className={styles.card}>
      <textarea
        ref={ref}
        className={styles.input}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label="What did you eat?"
        aria-describedby={hintId}
        readOnly={sending}
        autoFocus={autoFocus}
        enterKeyHint="send"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.footer}>
        <span id={hintId} className={styles.hint}>
          {offline ? <WifiOff size={12} strokeWidth={2} aria-hidden="true" className={styles.hintIcon} /> : null}
          {offline ? <span className="sr-only">Offline.</span> : null}
          {offline ? ' ' : null}
          {hint}
        </span>
        <div className={styles.actions}>
          {onCamera ? (
            <button type="button" className={styles.camera} aria-label="Add a photo" onClick={onCamera}>
              <Camera size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={[styles.send, text ? styles.sendReady : ''].join(' ')}
            disabled={!canSend}
            aria-busy={sending || undefined}
            onClick={submit}
          >
            {sending ? 'Estimating…' : 'Estimate'}
          </button>
        </div>
      </div>
    </div>
  );
}
