import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

/** Title widths from the prototype's estimating screen, reused in order. */
const TITLE_WIDTHS = [120, 150, 90, 110] as const;
/** Stagger between rows (README › Motion). */
const STAGGER_MS = 150;

export interface SkeletonRowProps {
  /** Width of the 14px title bar in px. */
  titleWidth: number;
  /** Pulse delay, so stacked rows ripple. */
  delayMs: number;
}

/** @design C57 SkeletonLoader row — --card, radius 20, padding 14; --card2 title bar, two chip pills, kcal block. */
export function SkeletonRow({ titleWidth, delayMs }: SkeletonRowProps) {
  const style = { '--title-w': `${titleWidth}px`, animationDelay: `${delayMs}ms` } as CSSProperties;
  return (
    <div className={styles.row} style={style} aria-hidden="true">
      <div className={styles.left}>
        <div className={styles.title} />
        <div className={styles.chips}>
          <div className={[styles.chip, styles.chipA].join(' ')} />
          <div className={[styles.chip, styles.chipB].join(' ')} />
        </div>
      </div>
      <div className={styles.kcal} />
    </div>
  );
}

export interface SkeletonListProps {
  count: number;
  /** Read out instead of the placeholder rows. */
  label?: string;
}

/** @design C57 SkeletonLoader — placeholder item rows for estimating and lists, pulse staggered 150ms. */
export function SkeletonList({ count, label = 'Loading' }: SkeletonListProps) {
  return (
    <div className={styles.list} role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <SkeletonRow key={i} titleWidth={TITLE_WIDTHS[i % TITLE_WIDTHS.length] ?? TITLE_WIDTHS[0]} delayMs={i * STAGGER_MS} />
      ))}
    </div>
  );
}
