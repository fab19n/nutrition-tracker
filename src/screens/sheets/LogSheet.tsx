import { LogSheetContent } from '@/screens/Log/LogSheetContent';

/**
 * S09 Log sheet. Sheet content only: the AppShell wraps it in BottomSheet and passes close().
 * Opened with ?sheet=log; the morning check-in adds &at=<instant> to preset the time.
 */
export default function LogSheet({ close }: { close: () => void }) {
  return <LogSheetContent close={close} />;
}
