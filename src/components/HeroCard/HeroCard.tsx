import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/Card';
import { WeekBars, type WeekBarsProps } from '@/components/WeekBars/WeekBars';
import styles from './HeroCard.module.css';

/** near: 10% or less of today's allowance left (amber, like over, with its own label and note). */
export type HeroValueTone = 'default' | 'near' | 'over' | 'muted';
export type HeroSavedTone = 'good' | 'over' | 'neutral';

export interface HeroCardProps {
  /** "Left today", "Over today", "Protein left", "Days in range", "Budget off". */
  label: string;
  /** Pre-formatted hero figure: "570", "+310", "88g", "5 of 7", "—". */
  value: string;
  valueTone?: HeroValueTone;
  /** Line under the figure: "Covered by your +650 saved", "Close to today's budget", "Logging is optional this week". */
  note?: string;
  /** Amber by default, as in the prototype; 'muted' for a quiet line. */
  noteTone?: 'over' | 'muted';
  /** "+650" */
  savedLabel: string;
  savedTone?: HeroSavedTone;
  /** "4,820" */
  leftWeekLabel: string;
  bars: WeekBarsProps;
  /** "1,230 eaten · window closes 10:40pm" */
  captionLeft: string;
  /** "Sat: 2,450 room" */
  captionRight?: string;
  /** Opens the budget breakdown (S17). */
  onPress: () => void;
  /** Whole-card summary, e.g. "570 kcal left today. Saved this week +650. Left this week 4,820. Opens the budget breakdown." */
  ariaLabel: string;
  className?: string;
}

const VALUE_TONE: Record<HeroValueTone, string | undefined> = {
  default: undefined,
  near: styles.toneOver,
  over: styles.toneOver,
  muted: styles.toneMuted,
};

const SAVED_TONE: Record<HeroSavedTone, string | undefined> = {
  good: styles.toneGood,
  over: styles.toneOver,
  neutral: undefined,
};

/** Approximate width of the hero figure in em at 800 weight: digits are wide, separators narrow. */
export function heroWidthEm(value: string): number {
  let em = 0;
  for (const ch of value) {
    if (/[0-9+−-]/.test(ch)) em += 0.55;
    else if (/[,.\s]/.test(ch)) em += 0.25;
    else if (/[fijlrt]/.test(ch)) em += 0.35;
    else if (ch === '—') em += 0.8;
    else em += 0.55;
  }
  return Math.max(em, 0.55);
}

/**
 * @design C07 BudgetRing, implemented as the Today hero card (number + week bars, no ring).
 * The goal picks the figure; the layout is the same for every goal.
 */
export function HeroCard({
  label,
  value,
  valueTone = 'default',
  note,
  noteTone,
  savedLabel,
  savedTone = 'good',
  leftWeekLabel,
  bars,
  captionLeft,
  captionRight,
  onPress,
  ariaLabel,
  className,
}: HeroCardProps) {
  const noteIsOver = (noteTone ?? 'over') === 'over';
  return (
    <Card radius="hero" padding="18px 20px 16px" onPress={onPress} pressLabel={ariaLabel} className={className}>
      <div className={styles.top}>
        <div className={styles.main}>
          <div className={styles.label}>{label}</div>
          {/* Keyed so a new figure replays the short settle animation; --hero-em lets a figure too wide for the column shrink to fit. */}
          <div
            key={value}
            className={['t-hero', styles.value, VALUE_TONE[valueTone]].filter(Boolean).join(' ')}
            style={{ '--hero-em': heroWidthEm(value) } as CSSProperties}
          >
            {value}
          </div>
          {note ? <div className={[styles.note, noteIsOver ? styles.toneOver : 'muted'].join(' ')}>{note}</div> : null}
        </div>
        <div className={styles.side}>
          <div>
            <div className={styles.sideLabel}>Saved this week</div>
            <div className={['t-metric', SAVED_TONE[savedTone]].filter(Boolean).join(' ')}>{savedLabel}</div>
          </div>
          <div>
            <div className={styles.sideLabel}>Left this week</div>
            <div className="t-metric">{leftWeekLabel}</div>
          </div>
        </div>
      </div>
      <WeekBars {...bars} className={[styles.bars, bars.className].filter(Boolean).join(' ')} />
      <div className={styles.caption}>
        <span>{captionLeft}</span>
        {captionRight ? <span className={styles.captionRight}>{captionRight}</span> : null}
      </div>
    </Card>
  );
}
