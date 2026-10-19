import type { ReactNode } from 'react';
import styles from './Pill.module.css';

/**
 * Small 11px/600 pill used by TimingTag (C31), DayStatusBadge (C32), fit badges and status labels.
 * Colour never carries meaning alone: always pass a word, and an icon where the design has a glyph.
 *
 * accent  — --accent-soft / --accent-text ("● On time", "Complete", "Fits")
 * amber   — --amber-soft / --amber-text ("◔ Late for you", "Unconfirmed", "Tight fit")
 * neutral — --card2 / --muted ("Planned", "Not counted", "Paused")
 * outline — 1px --line border, --muted text (SourceTag)
 * outlineAmber — 1px dashed --amber border, --amber-text (SourceTag "AI guess")
 */
export type PillTone = 'accent' | 'amber' | 'neutral' | 'outline' | 'outlineAmber';

export interface PillProps {
  tone?: PillTone;
  icon?: ReactNode;
  /** 'md' = 12px label used in Diary status card ("● In progress"). */
  size?: 'sm' | 'md';
  bold?: boolean;
  className?: string;
  children: ReactNode;
}

export function Pill({ tone = 'neutral', icon, size = 'sm', bold, className, children }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone], styles[size], bold ? styles.bold : '', className ?? ''].join(' ')}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
