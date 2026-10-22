import type { CSSProperties } from 'react';
import { Moon } from 'lucide-react';
import styles from './DayTimeline.module.css';

export interface TimelineDot {
  /** Position across the logical day, 0–100. */
  pct: number;
  kcal: number;
  tone: 'onTime' | 'late';
}

export type DayTimelineSize = 'compact' | 'expanded';

export interface DayTimelineProps {
  /** compact: the 16px strip on Today and Diary day · expanded: the 36px strip on Timing detail (S35). Default compact. */
  size?: DayTimelineSize;
  /** Eating-window band, 0–100 across the logical day. */
  windowStartPct?: number;
  windowEndPct?: number;
  dots: TimelineDot[];
  /** "Now" marker; leave out for finished days. */
  nowPct?: number;
  /** Check-in: dashed amber box over a gap, with a label above ("usual dinner 9pm"). */
  gap?: { startPct: number; endPct: number; label: string };
  /** The "Going to sleep" tap: a moon on the track. The meaning is in `ariaLabel` and the caller's own text, never the icon alone. */
  sleep?: { pct: number };
  /** Expanded only: thin vertical hour lines, 0–100 across the logical day. */
  ticks?: number[];
  /** 11px captions spread under the track: ["5am", "now", "5am"]. Expanded: evenly across the strip, each under the same percentage as its hour line (the first and last stay inside the edges). */
  captions: string[];
  /** Optional 12px row above the track: "Window opened 10:40am" / "closes 10:40pm". */
  header?: { left: string; right?: string };
  /** Summary for screen readers, e.g. "Window 10:40am to 10:40pm. Breakfast 10:40am, late for you. Lunch 2:15pm." */
  ariaLabel: string;
  className?: string;
}

const DOT_SIZES = { compact: [10, 12, 14], expanded: [14, 18, 22] } as const;

/** Meal dots grow with the meal: 10px under 600 kcal, 12px under 800, else 14px (expanded: 14, 18, 22). */
export function dotSizeFor(kcal: number, size: DayTimelineSize = 'compact'): number {
  const [small, medium, large] = DOT_SIZES[size];
  if (kcal < 600) return small;
  if (kcal < 800) return medium;
  return large;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function span(startPct: number, endPct: number): CSSProperties {
  const left = clampPct(Math.min(startPct, endPct));
  return { left: `${left}%`, width: `${clampPct(Math.max(startPct, endPct)) - left}%` };
}

/** @design C12 DayTimeline — the logical day as a strip with window, meals, now, gaps and the sleep tap. Compact, or expanded for S35. */
export function DayTimeline({
  size = 'compact',
  windowStartPct,
  windowEndPct,
  dots,
  nowPct,
  gap,
  sleep,
  ticks,
  captions,
  header,
  ariaLabel,
  className,
}: DayTimelineProps) {
  const hasWindow = windowStartPct !== undefined && windowEndPct !== undefined;
  const expanded = size === 'expanded';
  return (
    <div className={[styles.root, expanded ? styles.expanded : '', className].filter(Boolean).join(' ')}>
      {header ? (
        <div className={styles.header}>
          <span>{header.left}</span>
          {header.right ? <span>{header.right}</span> : null}
        </div>
      ) : null}
      <div className={[styles.track, gap ? styles.withGap : ''].filter(Boolean).join(' ')} role="img" aria-label={ariaLabel}>
        {hasWindow ? <div className={styles.window} style={span(windowStartPct, windowEndPct)} /> : null}
        {expanded ? ticks?.map((pct, i) => <div key={i} className={styles.tick} style={{ left: `${clampPct(pct)}%` }} />) : null}
        {gap ? <div className={styles.gap} style={span(gap.startPct, gap.endPct)} /> : null}
        {dots.map((dot, i) => {
          const px = dotSizeFor(dot.kcal, size);
          return (
            <div
              key={i}
              className={[styles.dot, dot.tone === 'late' ? styles.late : styles.onTime].join(' ')}
              style={{ left: `${clampPct(dot.pct)}%`, width: px, height: px, marginLeft: -px / 2, marginTop: -px / 2 }}
            />
          );
        })}
        {sleep ? (
          <div className={styles.sleep} style={{ left: `${clampPct(sleep.pct)}%` }} aria-hidden="true">
            <Moon size={expanded ? 12 : 10} strokeWidth={2.5} />
          </div>
        ) : null}
        {gap ? (
          <div className={styles.gapLabel} style={{ left: `${clampPct((gap.startPct + gap.endPct) / 2)}%` }}>
            {gap.label}
          </div>
        ) : null}
        {nowPct !== undefined ? <div className={styles.now} style={{ left: `${clampPct(nowPct)}%` }} /> : null}
      </div>
      {captions.length > 0 ? (
        <div className={[styles.captions, expanded ? styles.captionsAligned : ''].filter(Boolean).join(' ')} aria-hidden="true">
          {captions.map((caption, i) =>
            expanded ? (
              // Each caption sits at the same percentage as its hour line; the ends are pulled inside the strip.
              <span
                key={i}
                className={[styles.caption, i === 0 ? styles.captionFirst : '', i === captions.length - 1 && i > 0 ? styles.captionLast : ''].filter(Boolean).join(' ')}
                style={{ left: `${captions.length > 1 ? (i / (captions.length - 1)) * 100 : 0}%` }}
              >
                {caption}
              </span>
            ) : (
              <span key={i}>{caption}</span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
