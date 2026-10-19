import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import styles from './Banner.module.css';

export type BannerTone = 'amber' | 'accent' | 'neutral';

export interface BannerProps {
  /** amber: check-in waiting · accent: early read, viewing under another goal · neutral: offline, sync waiting, AI unavailable. */
  tone: BannerTone;
  /** Message; bold the lead with <b>, e.g. <b>Yesterday looks incomplete.</b> 2 meals, 1,240 kcal. */
  children: ReactNode;
  /** Bold action on the right ("Check"); needs onPress. */
  actionLabel?: string;
  /** Makes the whole banner tappable. */
  onPress?: () => void;
  /** Optional leading icon, e.g. CloudOff for offline. */
  icon?: ReactNode;
  className?: string;
}

/** @design C06 Banner — a one-line notice under the TopBar. */
export function Banner({ tone, children, actionLabel, onPress, icon, className }: BannerProps) {
  const cls = [styles.banner, styles[tone], onPress ? styles.pressable : '', className].filter(Boolean).join(' ');
  const content = (
    <>
      <span className={styles.body}>
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{children}</span>
      </span>
      {onPress && actionLabel ? (
        <span className={styles.action}>
          {actionLabel}
          <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
        </span>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <button type="button" className={cls} onClick={onPress}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}
