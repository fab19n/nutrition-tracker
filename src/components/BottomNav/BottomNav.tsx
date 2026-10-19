import { Plus } from 'lucide-react';
import styles from './BottomNav.module.css';

export type NavTab = 'today' | 'diary' | 'insights' | 'more';

export interface BottomNavProps {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
  /** Centre button: opens the Log sheet over the current tab. */
  onLog: () => void;
  /** Amber dot on a tab, e.g. a check-in waiting on Today. */
  badges?: Partial<Record<NavTab, boolean>>;
  /** Read out after a badged tab's name. */
  badgeLabel?: string;
}

const TABS: readonly { tab: NavTab; label: string }[] = [
  { tab: 'today', label: 'Today' },
  { tab: 'diary', label: 'Diary' },
  { tab: 'insights', label: 'Insights' },
  { tab: 'more', label: 'More' },
];

/** @design C01 BottomNav — floating pill with the raised Log button in the centre. */
export function BottomNav({ active, onNavigate, onLog, badges, badgeLabel = 'Check-in waiting' }: BottomNavProps) {
  const renderTab = ({ tab, label }: (typeof TABS)[number]) => {
    const isActive = tab === active;
    const badged = !!badges?.[tab];
    return (
      <button
        key={tab}
        type="button"
        className={[styles.tab, isActive ? styles.active : ''].filter(Boolean).join(' ')}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onNavigate(tab)}
      >
        <span className={styles.label}>
          {label}
          {badged ? (
            <>
              <span className={styles.badge} aria-hidden="true" />
              <span className="sr-only">, {badgeLabel}</span>
            </>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <nav className={styles.root} aria-label="Main">
      <div className={styles.bar}>
        {TABS.slice(0, 2).map(renderTab)}
        <div className={styles.logCell}>
          <button type="button" className={styles.log} aria-label="Log food" onClick={onLog}>
            <Plus size={30} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {TABS.slice(2).map(renderTab)}
      </div>
    </nav>
  );
}
