import type { CSSProperties } from 'react';
import styles from './DayTimeline.module.css';

export interface TimelineDot {
  /** Position across the logical day, 0–100. */
  pct: number;
  kcal: number;
  tone: 'onTime' | 'late';
}

export interface DayTimelineProps {
  /** Eating-window band, 0–100 across the logical day. */
  windowStartPct?: number;
  windowEndPct?: number;
  dots: TimelineDot[];
  /** "Now" marker; leave out for finished days. */
  nowPct?: number;
  /** Check-in: dashed amber box over a gap, with a label above ("usual dinner 9pm"). */
  gap?: { startPct: number; endPct: number; label: string };
  /** 11px captions spread under the track: ["5am", "now", "5am"]. */
  captions: string[];
  /** Optional 12px row above the track: "Window opened 10:40am" / "closes 10:40pm". */
  header?: { left: string; right?: string };
  /** Summary for screen readers, e.g. "Window 10:40am to 10:40pm. Breakfast 10:40am, late for you. Lunch 2:15pm." */
  ariaLabel: string;
  className?: string;
}

/** Meal dots grow with the meal: 10px under 600 kcal, 12px under 800, else 14px. */
export function dotSizeFor(kcal: number): 10 | 12 | 14 {
  if (kcal < 600) return 10;
  if (kcal < 800) return 12;
  return 14;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function span(startPct: number, endPct: number): CSSProperties {
  const left = clampPct(Math.min(startPct, endPct));
  return { left: `${left}%`, width: `${clampPct(Math.max(startPct, endPct)) - left}%` };
}

/** @design C12 DayTimeline (compact) — the logical day as a strip with window, meals, now and gaps. */
export function DayTimeline({
  windowStartPct,
  windowEndPct,
  dots,
  nowPct,
  gap,
  captions,
  header,
  ariaLabel,
  className,
}: DayTimelineProps) {
  const hasWindow = windowStartPct !== undefined && windowEndPct !== undefined;
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {header ? (
        <div className={styles.header}>
          <span>{header.left}</span>
          {header.right ? <span>{header.right}</span> : null}
        </div>
      ) : null}
      <div className={[styles.track, gap ? styles.withGap : ''].filter(Boolean).join(' ')} role="img" aria-label={ariaLabel}>
        {hasWindow ? <div className={styles.window} style={span(windowStartPct, windowEndPct)} /> : null}
        {gap ? <div className={styles.gap} style={span(gap.startPct, gap.endPct)} /> : null}
        {dots.map((dot, i) => {
          const size = dotSizeFor(dot.kcal);
          return (
            <div
              key={i}
              className={[styles.dot, dot.tone === 'late' ? styles.late : styles.onTime].join(' ')}
              style={{ left: `${clampPct(dot.pct)}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
            />
          );
        })}
        {gap ? (
          <div className={styles.gapLabel} style={{ left: `${clampPct((gap.startPct + gap.endPct) / 2)}%` }}>
            {gap.label}
          </div>
        ) : null}
        {nowPct !== undefined ? <div className={styles.now} style={{ left: `${clampPct(nowPct)}%` }} /> : null}
      </div>
      {captions.length > 0 ? (
        <div className={styles.captions} aria-hidden="true">
          {captions.map((caption, i) => (
            <span key={i}>{caption}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
