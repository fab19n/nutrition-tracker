import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { useSheet } from './navigation';
import type { SheetName } from './paths';
import styles from './AppShell.module.css';

/** What every sheet content file default-exports (ARCHITECTURE §8.1). */
export interface SheetContentProps {
  close: () => void;
}

interface SheetConfig {
  Content: LazyExoticComponent<ComponentType<SheetContentProps>>;
  /** CSS max-height of the panel. */
  maxHeight: string;
  /** Scrim tap, Escape and the grab handle close it. */
  dismissible: boolean;
  /** Accessible name until (or unless) the content renders a SheetTitle. */
  title: string;
}

/** Sizes the panel to its content, capped below the status bar. */
const FIT_CONTENT = 'calc(100% - env(safe-area-inset-top, 0px) - 8px)';

export const SHEETS: Record<SheetName, SheetConfig> = {
  log: {
    Content: lazy(() => import('@/screens/sheets/LogSheet')),
    maxHeight: '88%',
    dismissible: true,
    title: 'Log food',
  },
  budget: {
    Content: lazy(() => import('@/screens/sheets/BudgetSheet')),
    maxHeight: '90%',
    dismissible: true,
    title: "This week's budget",
  },
  makan: {
    Content: lazy(() => import('@/screens/sheets/MakanSheet')),
    maxHeight: FIT_CONTENT,
    dismissible: true,
    title: 'Plan a makan day',
  },
  checkin: {
    Content: lazy(() => import('@/screens/sheets/CheckInSheet')),
    maxHeight: '92%',
    dismissible: false,
    title: 'Morning check-in',
  },
  evidence: {
    Content: lazy(() => import('@/screens/sheets/EvidenceSheet')),
    maxHeight: '88%',
    dismissible: true,
    title: 'Evidence',
  },
};

function SheetLoading() {
  return (
    <div className={styles.sheetLoading} role="status">
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * One sheet's content. Keyed by sheet name: when one sheet hands over to another (budget →
 * makan) the panel stays and the content swaps, so focus goes back to the panel instead of
 * being lost with the button that was pressed.
 */
function SheetBody({ config, close }: { config: SheetConfig; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current?.closest<HTMLElement>('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }, []);
  const { Content } = config;
  return (
    <div ref={ref}>
      <Suspense fallback={<SheetLoading />}>
        <Content close={close} />
      </Suspense>
    </div>
  );
}

/** Renders the C04 BottomSheet for the current ?sheet= (ARCHITECTURE §8), with its content loaded lazily. */
export function SheetHost() {
  const { sheet, close } = useSheet();
  const config = sheet ? SHEETS[sheet] : null;
  return (
    <BottomSheet
      open={config !== null}
      onClose={close}
      dismissible={config?.dismissible ?? true}
      maxHeight={config?.maxHeight ?? '88%'}
      title={config?.title}
      routed
    >
      {sheet && config ? <SheetBody key={sheet} config={config} close={close} /> : null}
    </BottomSheet>
  );
}
