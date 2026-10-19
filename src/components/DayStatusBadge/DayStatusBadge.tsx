import type { ReactNode } from 'react';
import { Circle, CircleCheck, Pause, Star } from 'lucide-react';
import type { DayStatusKind } from '@/domain/types';
import { Pill, type PillTone } from '@/components/ui/Pill';
import styles from './DayStatusBadge.module.css';

/** Stored day statuses plus the display-only states of today and future days. */
export type DayBadgeStatus = DayStatusKind | 'inProgress' | 'makan' | 'planned';

interface BadgeSpec {
  label: string;
  tone: PillTone;
  icon?: ReactNode;
  className?: string;
}

const SPECS: Record<DayBadgeStatus, BadgeSpec> = {
  complete: { label: 'Complete', tone: 'accent', icon: <CircleCheck size={12} strokeWidth={2} /> },
  inProgress: { label: 'In progress', tone: 'accent', icon: <Circle size={8} strokeWidth={0} fill="currentColor" /> },
  unconfirmed: { label: 'Unconfirmed', tone: 'amber' },
  makan: { label: 'Makan day', tone: 'amber', icon: <Star size={11} strokeWidth={2} fill="currentColor" /> },
  planned: { label: 'Planned', tone: 'neutral' },
  notCounted: { label: 'Not counted', tone: 'neutral', icon: <span className={styles.hatch} /> },
  paused: { label: 'Paused', tone: 'neutral', icon: <Pause size={11} strokeWidth={2} /> },
  guess: { label: 'Guess added', tone: 'neutral', className: styles.guess },
};

export interface DayStatusBadgeProps {
  status: DayBadgeStatus;
  /** sm = 11px week rows; md = 12px Diary status card ("● In progress"). */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * @design C32 DayStatusBadge — Complete / In progress (accent), Unconfirmed / Makan day (amber),
 * Planned / Not counted (hatched swatch) / Paused (neutral), Guess added (neutral, dashed outline).
 */
export function DayStatusBadge({ status, size = 'sm', className }: DayStatusBadgeProps) {
  const spec = SPECS[status];
  const cls = [spec.className, size === 'md' ? styles.md : styles.sm, className].filter(Boolean).join(' ');
  return (
    <Pill tone={spec.tone} size={size} icon={spec.icon} className={cls}>
      {spec.label}
    </Pill>
  );
}
