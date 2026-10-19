import { Star } from 'lucide-react';
import type { BudgetBarKind } from '@/domain/budget';
import styles from './WeekBars.module.css';

/** The engine's bar kinds, so a `BudgetDay.kind` can be passed straight in. */
export type WeekBarKind = BudgetBarKind;

export interface WeekBar {
  /** Day letter shown under the bar ("M", "T" …). */
  label: string;
  kind: WeekBarKind;
  /** Bar height in kcal: eaten for finished days, the allowance for today and planned days. */
  valueKcal: number;
  /** Today only: eaten so far, drawn as the solid fill inside the outline. */
  fillKcal?: number;
  /** Highlights the day letter. Defaults to true for kind 'today'. */
  isToday?: boolean;
}

export interface WeekBarsProps {
  bars: WeekBar[];
  /** Daily target for the dashed line; null hides it (paused week). */
  targetKcal: number | null;
  /** 64 (hero card) | 72 (weekly review) | 96 (diary week). */
  height: number;
  /** Summary for screen readers, e.g. "This week: Mon to Thu under target, today 1,230 of 1,800". */
  ariaLabel: string;
  className?: string;
}

/** Headroom above the target line when no day reaches it. */
export const TARGET_HEADROOM = 1.15;

export interface ScaledBar {
  heightPx: number;
  /** Today's fill as a share of the bar (0–1). */
  fill: number;
}

export interface WeekBarsScale {
  bars: ScaledBar[];
  /** Distance of the target line from the top of the chart, or null without a target. */
  targetTopPx: number | null;
}

function barKcal(bar: WeekBar): number {
  return Math.max(bar.valueKcal, bar.fillKcal ?? 0, 0);
}

/** The tallest of (largest bar, target × 1.15) fills the chart height. */
export function scaleWeekBars(bars: readonly WeekBar[], targetKcal: number | null, height: number): WeekBarsScale {
  const ceiling = Math.max(...bars.map(barKcal), (targetKcal ?? 0) * TARGET_HEADROOM, 1);
  const toPx = (kcal: number) => Math.round((kcal / ceiling) * height);
  return {
    bars: bars.map((bar) => {
      const kcal = barKcal(bar);
      const fill = kcal > 0 && bar.fillKcal !== undefined ? Math.min(1, Math.max(0, bar.fillKcal / kcal)) : 0;
      return { heightPx: toPx(kcal), fill };
    }),
    targetTopPx: targetKcal === null ? null : height - toPx(targetKcal),
  };
}

/** @design C10 WeekBars — Mon–Sun bars against the daily target line. */
export function WeekBars({ bars, targetKcal, height, ariaLabel, className }: WeekBarsProps) {
  const scale = scaleWeekBars(bars, targetKcal, height);
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} role="img" aria-label={ariaLabel}>
      <div className={styles.chart} style={{ height }}>
        {scale.targetTopPx !== null ? <div className={styles.target} style={{ top: scale.targetTopPx }} /> : null}
        {bars.map((bar, i) => {
          const scaled = scale.bars[i];
          if (!scaled) return null;
          const todayOver = bar.kind === 'today' && (bar.fillKcal ?? 0) > bar.valueKcal;
          return (
            <div
              key={i}
              className={[styles.bar, styles[bar.kind], todayOver ? styles.todayOver : ''].filter(Boolean).join(' ')}
              style={{ height: scaled.heightPx }}
            >
              {bar.kind === 'today' ? <div className={styles.fill} style={{ height: `${scaled.fill * 100}%` }} /> : null}
            </div>
          );
        })}
      </div>
      <div className={styles.letters} aria-hidden="true">
        {bars.map((bar, i) => {
          const today = bar.isToday ?? bar.kind === 'today';
          const amber = bar.kind === 'makan' || bar.kind === 'over';
          return (
            <span key={i} className={[styles.letter, today ? styles.letterToday : '', amber ? styles.letterAmber : ''].filter(Boolean).join(' ')}>
              {bar.label}
              {bar.kind === 'makan' ? <Star size={11} strokeWidth={2} fill="currentColor" className={styles.star} /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
