import { useAnySheetOpen } from '@/components/BottomSheet/BottomSheet';
import { Toast, TOAST_DURATION_MS } from '@/components/Toast/Toast';
import { useUiStore } from '@/state/ui';
import styles from './AppShell.module.css';

export interface ToastHostProps {
  /** Above the bottom nav when it shows (README C05: bottom 106px), else near the bottom edge. */
  placement: 'aboveNav' | 'bottom';
}

const PLACEMENT_CLASS = {
  aboveNav: undefined,
  // Sub-screens: near the bottom edge, or above a floating footer (Review, Plate) when one shows.
  bottom: styles.toastLow,
  // A sheet owns the bottom edge (its actions sit there), so the toast shows at the top instead.
  top: styles.toastTop,
} as const;

/**
 * The ui store's toast (one at a time; a new one replaces the old) as a C05 Toast with Undo.
 * Keyed by id, so a replacement restarts the timer and the enter animation. The live region
 * stays mounted, so screen readers announce each toast as it appears.
 */
export function ToastHost({ placement }: ToastHostProps) {
  const toast = useUiStore((s) => s.toast);
  const hideToast = useUiStore((s) => s.hideToast);
  const sheetOpen = useAnySheetOpen();
  const where = sheetOpen ? 'top' : placement;
  return (
    <div className={PLACEMENT_CLASS[where]} role="status" aria-live="polite">
      {toast ? (
        <Toast
          key={toast.id}
          message={toast.message}
          onUndo={toast.undo}
          onDismiss={() => hideToast(toast.id)}
          durationMs={TOAST_DURATION_MS}
          live={false}
        />
      ) : null}
    </div>
  );
}
