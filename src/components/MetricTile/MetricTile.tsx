import type { ReactNode } from 'react';
import styles from './MetricTile.module.css';

export type MetricTone = 'good' | 'over' | 'neutral';

export interface MetricTileProps {
  /** "Trend", "Last week", "Complete". */
  label: string;
  /** Pre-formatted: "77.9 kg", "+350", "6 of 7". */
  value: string;
  /** good: --accent-text (+650 saved, −0.4 kg) · over: --amber-text (+350 over). */
  tone?: MetricTone;
  /** 11px line under the value: "over plan", "77.9 kg now". */
  sub?: string;
  className?: string;
}

const TONE: Record<MetricTone, string | undefined> = {
  good: styles.good,
  over: styles.over,
  neutral: undefined,
};

/** @design C09 MetricTile — label, number and an optional sub-line. */
export function MetricTile({ label, value, tone = 'neutral', sub, className }: MetricTileProps) {
  return (
    <div className={[styles.tile, className].filter(Boolean).join(' ')}>
      <div className={styles.label}>{label}</div>
      <div className={['t-metric-sm', TONE[tone]].filter(Boolean).join(' ')}>{value}</div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
    </div>
  );
}

/** Three MetricTiles across, gap 8px (Insights, Weight). */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.row, className].filter(Boolean).join(' ')}>{children}</div>;
}
