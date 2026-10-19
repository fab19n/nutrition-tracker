import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Ellipsis, Search } from 'lucide-react';
import styles from './TopBar.module.css';

export interface TopBarProps {
  /** "Today", "Diary", "Insights", "More". */
  title: string;
  /** Shown beside the title, baseline-aligned: "Fri 16 Oct". */
  subtitle?: string;
  /** GoalPill, Day/Week switch, or a caption like "Week 3 · day 19". */
  right?: ReactNode;
  /** Shows a search button (Diary, S12). */
  onSearch?: () => void;
  searchLabel?: string;
  /** Shows an overflow button. */
  onMore?: () => void;
  moreLabel?: string;
  className?: string;
}

/** 40px --card circle with a 44px hit area: search and overflow in the TopBar. */
function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} onClick={onPress}>
      {children}
    </button>
  );
}

/** Search and overflow buttons, when asked for. */
function TrailingButtons({ onSearch, searchLabel, onMore, moreLabel }: Pick<TopBarProps, 'onSearch' | 'searchLabel' | 'onMore' | 'moreLabel'>) {
  return (
    <>
      {onSearch ? (
        <IconButton label={searchLabel ?? 'Search'} onPress={onSearch}>
          <Search size={20} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      ) : null}
      {onMore ? (
        <IconButton label={moreLabel ?? 'More options'} onPress={onMore}>
          <Ellipsis size={20} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      ) : null}
    </>
  );
}

/** @design C02 TopBar — large title for tab roots, with optional search and overflow. */
export function TopBar({ title, subtitle, right, onSearch, searchLabel, onMore, moreLabel, className }: TopBarProps) {
  const hasTrailing = right != null || onSearch !== undefined || onMore !== undefined;
  return (
    <header className={[styles.bar, className].filter(Boolean).join(' ')}>
      <div className={styles.titleGroup}>
        <h1 className={['t-title', styles.title].join(' ')}>{title}</h1>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </div>
      {hasTrailing ? (
        <div className={styles.right}>
          {right}
          <TrailingButtons onSearch={onSearch} searchLabel={searchLabel} onMore={onMore} moreLabel={moreLabel} />
        </div>
      ) : null}
    </header>
  );
}

export interface SubScreenHeaderProps {
  /** "Weight", "Meal ideas", "Check your meal". */
  title: string;
  onBack: () => void;
  /** Accessible name of the back button. */
  backLabel?: string;
  /** Right-aligned extra, e.g. "Step 1 of 3". */
  right?: ReactNode;
  /** Shows an overflow button (entry detail: duplicate, delete). */
  onMore?: () => void;
  moreLabel?: string;
  className?: string;
}

/** @design C02 TopBar (compact) — back button + 24px title for sub-screens, with optional overflow. */
export function SubScreenHeader({ title, onBack, backLabel = 'Back', right, onMore, moreLabel, className }: SubScreenHeaderProps) {
  return (
    <header className={[styles.sub, className].filter(Boolean).join(' ')}>
      <button type="button" className={styles.back} aria-label={backLabel} onClick={onBack}>
        <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
      </button>
      <h1 className={['t-subtitle', styles.title].join(' ')}>{title}</h1>
      {right ? <div className={styles.subRight}>{right}</div> : null}
      {onMore ? (
        <div className={right ? styles.subTrailing : styles.subTrailingAlone}>
          <TrailingButtons onMore={onMore} moreLabel={moreLabel} />
        </div>
      ) : null}
    </header>
  );
}

export interface DateSwitcherProps {
  /** "Thu", "Last week". Leave out with onPrev to show a disabled chevron. */
  prevLabel?: string;
  /** "Fri 16 Oct · Today", "12–18 Oct · This week". */
  label: string;
  nextLabel?: string;
  /** Omit to disable that side (it turns --dash). */
  onPrev?: () => void;
  onNext?: () => void;
  className?: string;
}

/** @design C02 TopBar (date switcher) — "‹ Thu   Fri 16 Oct · Today   Sat ›". */
export function DateSwitcher({ prevLabel, label, nextLabel, onPrev, onNext, className }: DateSwitcherProps) {
  return (
    <div className={[styles.switcher, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={[styles.step, onPrev ? '' : styles.disabled].filter(Boolean).join(' ')}
        disabled={!onPrev}
        aria-label={prevLabel ? `Previous: ${prevLabel}` : 'Previous'}
        onClick={onPrev}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        {prevLabel}
      </button>
      <span className={styles.current} aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        className={[styles.step, onNext ? '' : styles.disabled].filter(Boolean).join(' ')}
        disabled={!onNext}
        aria-label={nextLabel ? `Next: ${nextLabel}` : 'Next'}
        onClick={onNext}
      >
        {nextLabel}
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
