import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** Illustration slot: a Lucide icon (rendered 24px in a soft circle) or any small illustration. */
  icon?: ReactNode;
  /** An invitation, not an apology: "Log your first meal". */
  headline: string;
  /** One line: "A rough guess is fine." */
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  /** card — on a --card surface (lists); plain — straight on the page background. */
  surface?: 'card' | 'plain';
}

/** @design C56 EmptyState — illustration slot, headline, one line and an optional action. */
export function EmptyState({ icon, headline, body, actionLabel, onAction, surface = 'card' }: EmptyStateProps) {
  return (
    <div className={[styles.empty, styles[surface]].join(' ')}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3 className={styles.headline}>{headline}</h3>
      <p className={styles.body}>{body}</p>
      {actionLabel && onAction ? (
        <Button size="pill" className={styles.action} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
