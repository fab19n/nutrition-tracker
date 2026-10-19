import { Card } from '@/components/ui/Card';
import styles from './TimingGrid.module.css';

export interface TimingGridDot {
  /** Position across the logical day, 0–100. */
  pct: number;
  /** 7–12px, sized by kcal by the caller. */
  sizePx: number;
  late?: boolean;
}

export interface TimingGridRow {
  /** Day letter: "M", "T" … */
  label: string;
  windowStartPct: number;
  windowLenPct: number;
  dots: TimingGridDot[];
}

export interface TimingGridProps {
  rows: TimingGridRow[];
  /** "Average window 10.4 h" */
  headerLeft: string;
  /** "Early read · 9 days" */
  headerRight: string;
  /** Spread under the rows: ["5am", "noon", "6pm", "midnight"]. */
  axisLabels: string[];
  /** Summary for screen readers; defaults to the header text. */
  ariaLabel?: string;
  /** False drops the card so the grid can sit inside another card. */
  framed?: boolean;
  className?: string;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** @design C13 TimingGrid — one row per day: eating-window line plus meal dots, late ones amber. */
export function TimingGrid({ rows, headerLeft, headerRight, axisLabels, ariaLabel, framed = true, className }: TimingGridProps) {
  const body = (
    <>
      <div className={styles.header}>
        <span>{headerLeft}</span>
        <span>{headerRight}</span>
      </div>
      <div className={styles.grid} role="img" aria-label={ariaLabel ?? `${headerLeft}. ${headerRight}`}>
        {rows.map((row, i) => (
          <div key={i} className={styles.row}>
            <span className={styles.label}>{row.label}</span>
            <div className={styles.track}>
              <div
                className={styles.window}
                style={{ left: `${clampPct(row.windowStartPct)}%`, width: `${clampPct(row.windowLenPct)}%` }}
              />
              {row.dots.map((dot, j) => (
                <div
                  key={j}
                  className={[styles.dot, dot.late ? styles.late : ''].filter(Boolean).join(' ')}
                  style={{
                    left: `${clampPct(dot.pct)}%`,
                    width: dot.sizePx,
                    height: dot.sizePx,
                    margin: `${-dot.sizePx / 2}px 0 0 ${-dot.sizePx / 2}px`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {axisLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </>
  );

  if (!framed) return <div className={className}>{body}</div>;
  return (
    <Card radius="card" padding="14px 16px" className={className}>
      {body}
    </Card>
  );
}
