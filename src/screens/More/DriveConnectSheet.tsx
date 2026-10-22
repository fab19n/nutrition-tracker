import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { connectDrive, prepareDrive } from '@/drive';
import { useDriveView } from '@/drive/hooks';
import { authProblemCopy, connectedToast, DRIVE_PRIMER } from '@/drive/status';
import { useUiStore } from '@/state/ui';

export interface DriveConnectSheetProps {
  open: boolean;
  onClose: () => void;
  /** After a connect, with how many photos already here are queued. */
  onConnected?: (queued: number) => void;
}

const OFFLINE = authProblemCopy('offline', { during: 'connect' }) ?? '';
const UNAVAILABLE = authProblemCopy('unavailable', { during: 'connect' }) ?? '';

/**
 * Connect Google Drive (Settings › Photos, and Entry's "Connect Google Drive to see full photos"):
 * the C58 primer, then Google's window. Continue with Google asks Google straight from the tap,
 * so Chrome lets the window open; it waits as "Getting ready…" until Google's script has loaded.
 * When that load fails, the sheet says Google couldn't be reached and the button loads it again.
 */
export function DriveConnectSheet({ open, onClose, onConnected }: DriveConnectSheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet open={open} onClose={onClose} title="Connect Google Drive" dismissible={!busy}>
      <ConnectBody onClose={onClose} onConnected={onConnected} onBusy={setBusy} />
    </BottomSheet>
  );
}

interface ConnectBodyProps {
  onClose: () => void;
  onConnected?: (queued: number) => void;
  onBusy: (busy: boolean) => void;
}

function ConnectBody({ onClose, onConnected, onBusy }: ConnectBodyProps) {
  const view = useDriveView();
  const showToast = useUiStore((s) => s.showToast);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = connecting || view.authBusy;

  useEffect(() => {
    prepareDrive();
  }, []);

  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  const connect = () => {
    // First, before anything else: Google's window opens only inside the tap.
    const pending = connectDrive();
    setConnecting(true);
    setError(undefined);
    void pending.then((result) => {
      setConnecting(false);
      if (result.ok) {
        onClose();
        showToast(connectedToast(result.queued));
        onConnected?.(result.queued);
        return;
      }
      // Google's script wasn't here: the tap loads it again, and the button and line follow that load.
      if (result.problem === 'notReady' || result.problem === 'unavailable') {
        setError(undefined);
        return;
      }
      setError(authProblemCopy(result.problem, { during: 'connect' }) ?? undefined);
    });
  };

  const offline = !view.online;
  // The last load of Google's script failed: say so, and let the button try again.
  const loadFailed = !view.gisReady && view.gisFailed === true;
  const label = busy ? DRIVE_PRIMER.busyLabel : view.gisReady || loadFailed ? DRIVE_PRIMER.allowLabel : DRIVE_PRIMER.readyingLabel;
  return (
    <PermissionPrimer
      kind="drive"
      title={DRIVE_PRIMER.title}
      body={DRIVE_PRIMER.body}
      allowLabel={label}
      allowBusy={busy}
      allowDisabled={(!view.gisReady && !loadFailed) || offline}
      error={offline && !busy ? OFFLINE : (error ?? (loadFailed ? UNAVAILABLE : undefined))}
      onAllow={connect}
      onNotNow={onClose}
    />
  );
}
