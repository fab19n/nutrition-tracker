import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './Toast.module.css';

export type ToastTone = 'default' | 'offline' | 'error';

export interface ToastProps {
  /** "Saved · ~880 kcal", "Saving for Saturday", "Yesterday confirmed". */
  message: string;
  /** Shows the action on the right; pressing it calls onUndo, then onDismiss. */
  onUndo?: () => void;
  /** Action text, "Undo" by default ("Try again" for an error). */
  actionLabel?: string;
  /** Called when the toast times out or its action is used. */
  onDismiss: () => void;
  /** Auto-dismiss delay; null keeps the toast until dismissed. */
  durationMs?: number | null;
  /** Adds an icon so the state never relies on colour: offline (cloud-off) or error (alert). */
  tone?: ToastTone;
  /**
   * The toast is its own live region (default). A host that keeps a live region mounted around it
   * passes false, so the message is announced once, when it appears in that region.
   */
  live?: boolean;
}

export const TOAST_DURATION_MS = 3500;

/**
 * @design C05 Toast — floats above the bottom nav inside the app column.
 * The timer pauses while the pointer or keyboard focus is on the toast.
 */
export function Toast({ message, onUndo, actionLabel = 'Undo', onDismiss, durationMs = TOAST_DURATION_MS, tone = 'default', live = true }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (durationMs === null || paused) return;
    const timer = setTimeout(() => onDismissRef.current(), durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, paused]);

  const icon =
    tone === 'offline' ? <CloudOff size={16} strokeWidth={2} /> : tone === 'error' ? <CircleAlert size={16} strokeWidth={2} /> : null;

  return (
    <div className={styles.root}>
      <div
        className={styles.toast}
        role={live ? 'status' : undefined}
        aria-live={live ? 'polite' : undefined}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <span className={styles.message}>
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {message}
        </span>
        {onUndo ? (
          <Button
            variant="onNav"
            size="sm"
            className={styles.action}
            onClick={() => {
              onUndo();
              onDismissRef.current();
            }}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
