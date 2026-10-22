import { useEffect, useState } from 'react';
import { useOnline } from '@/app/network';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { turnOnPush } from '@/push';
import { useUiStore } from '@/state/ui';
import { REMINDER_TOASTS } from './remindersModel';

export interface NotificationsSheetProps {
  open: boolean;
  onClose: () => void;
}

/** The designed C58 copy (the gallery's Notifications primer). */
export const NOTIFICATIONS_PRIMER = {
  title: 'A quick check each morning?',
  body: 'One question about yesterday, so missed meals never count as savings. Quiet hours follow your sleep taps.',
  allowLabel: 'Turn on reminders',
  busyLabel: 'Turning on…',
} as const;

/** The primer's error line: offline, the prompt closed without a choice, no service worker. */
export const PRIMER_LINES = {
  offline: "You're offline. Reminders can be turned on once you're back online.",
  dismissed: "Notifications weren't allowed. Tap Turn on reminders to ask again.",
  noWorker: "The app isn't ready yet. Close Kira Makan fully, open it again and try once more.",
} as const;

/**
 * S38's Turn on, when the browser hasn't been asked yet: the C58 primer, then Chrome's own prompt.
 * Turn on reminders asks straight from the tap, so Chrome shows its prompt. A server problem closes
 * the sheet: the device card under it says what happened.
 */
export function NotificationsSheet({ open, onClose }: NotificationsSheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet open={open} onClose={onClose} title="Turn on reminders" dismissible={!busy}>
      <PrimerBody onClose={onClose} onBusy={setBusy} />
    </BottomSheet>
  );
}

function PrimerBody({ onClose, onBusy }: { onClose: () => void; onBusy: (busy: boolean) => void }) {
  const online = useOnline();
  const showToast = useUiStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  const allow = () => {
    // First, before anything else: Chrome shows its prompt only inside the tap.
    const pending = turnOnPush();
    setBusy(true);
    setError(undefined);
    void pending.then((result) => {
      setBusy(false);
      if (result.ok) {
        onClose();
        showToast(REMINDER_TOASTS.on);
        return;
      }
      switch (result.problem) {
        case 'denied':
          onClose();
          showToast(REMINDER_TOASTS.blocked);
          return;
        case 'dismissed':
          setError(PRIMER_LINES.dismissed);
          return;
        case 'noWorker':
          setError(PRIMER_LINES.noWorker);
          return;
        default:
          onClose();
      }
    });
  };

  return (
    <PermissionPrimer
      kind="notifications"
      title={NOTIFICATIONS_PRIMER.title}
      body={NOTIFICATIONS_PRIMER.body}
      allowLabel={busy ? NOTIFICATIONS_PRIMER.busyLabel : NOTIFICATIONS_PRIMER.allowLabel}
      allowBusy={busy}
      allowDisabled={!online}
      error={!online && !busy ? PRIMER_LINES.offline : error}
      onAllow={allow}
      onNotNow={onClose}
    />
  );
}
