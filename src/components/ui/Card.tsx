import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

/**
 * hero — 28px radius (Today hero card)
 * lg   — 24px (SuggestionCard, WeightEntry, More goal card, Diary week bars)
 * card — 20px (standard: MealRow, ReviewItemRow, InsightCard, list cards)
 * tile — 16px (MetricTile, MacroBar, QuickAction, DishTile)
 */
export type CardRadius = 'hero' | 'lg' | 'card' | 'tile';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  radius?: CardRadius;
  /** CSS padding shorthand, e.g. "12px 14px". */
  padding?: string;
  /** Render as a button (whole card tappable). */
  onPress?: () => void;
  /** Accessible label when the card is pressable and its text isn't descriptive enough. */
  pressLabel?: string;
  /** Inset ring: accent (selected) or amber (needs attention). */
  ring?: 'accent' | 'amber' | 'amberThin' | null;
  /** Dashed outline instead of a filled card (empty slots, "Surprise me"). */
  dashed?: boolean;
  children?: ReactNode;
}

export function Card({
  radius = 'card',
  padding,
  onPress,
  pressLabel,
  ring,
  dashed,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const cls = [
    styles.base,
    styles[`r_${radius}`],
    dashed ? styles.dashed : '',
    ring ? styles[`ring_${ring}`] : '',
    onPress ? styles.pressable : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const s = padding ? { padding, ...style } : style;
  if (onPress) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={pressLabel}
        className={cls}
        style={s}
        onClick={onPress}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPress();
          }
        }}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={cls} style={s} {...rest}>
      {children}
    </div>
  );
}
