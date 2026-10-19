import type { ReactNode } from 'react';
import { fmtInt } from '@/domain/format';
import styles from './MacroBar.module.css';

export type Macro = 'protein' | 'carbs' | 'fat';

export interface MacroBarProps {
  /** "Protein", "Carbs", "Fat". */
  label: string;
  value: number;
  target: number;
  unit?: 'g';
  macro: Macro;
  /** Adds " · behind" to the label; decide with isBehind(). */
  behind?: boolean;
  /** Adds " · reached" to the label once the target is met. */
  reached?: boolean;
  className?: string;
}

/** Percent of target under which a macro reads as behind. */
export const BEHIND_PCT = 55;

export function isBehind(value: number, target: number): boolean {
  // Compared in whole percent so 60.5 of 110 isn't "behind" through float error.
  return target > 0 && value * 100 < BEHIND_PCT * target;
}

/** Fill width in percent, clamped to 0–100. */
export function macroFillPct(value: number, target: number): number {
  if (target <= 0) return value > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

/** @design C08 MacroBar — "42/110g" tile with a thin bar in the macro colour. */
export function MacroBar({ label, value, target, unit = 'g', macro, behind, reached, className }: MacroBarProps) {
  const suffix = behind ? ' · behind' : reached ? ' · reached' : '';
  return (
    <div className={[styles.tile, className].filter(Boolean).join(' ')}>
      <div className={styles.label}>
        {label}
        {suffix}
      </div>
      <div className={styles.value}>
        {fmtInt(value)}
        <span className={styles.target}>
          /{fmtInt(target)}
          {unit}
        </span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <div className={[styles.fill, styles[macro]].filter(Boolean).join(' ')} style={{ width: `${macroFillPct(value, target)}%` }} />
      </div>
    </div>
  );
}

/** Three MacroBars across, gap 8px. */
export function MacroRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.row, className].filter(Boolean).join(' ')}>{children}</div>;
}
