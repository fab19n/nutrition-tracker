import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import styles from './GoalCard.module.css';

export type GoalCardStatus = 'active' | 'next' | 'saved' | 'draft' | 'template' | 'ended';

const BADGE: Record<GoalCardStatus, string> = {
  active: 'Active',
  next: 'Next',
  saved: 'Saved',
  draft: 'Draft',
  template: 'Template',
  ended: 'Ended',
};

export interface GoalCardProps {
  status: GoalCardStatus;
  /** 12px meta above the title: "Active goal · week 3", "Festive maintain" (template name when it differs). */
  label?: string;
  title: string;
  detail: string;
  /** Badge word; defaults: Active / Saved / Draft / Template / Ended. 'next' passes "Starts Sat". */
  badge?: string;
  /** More (S48): "Festive maintain · Saved"; list labelled "Saved goals". */
  chips?: readonly string[];
  /** Opens the goal: the title is a button whose hit area stretches over the card (PotCard pattern). */
  onOpen?: () => void;
  /** Accessible name of the open button (default: title), e.g. "New goal from Pause". */
  openLabel?: string;
  /** One small action above the stretched target, e.g. "Keep Cut instead". */
  action?: { label: string; onPress: () => void; busy?: boolean };
  /** Heading level of the title inside its list. */
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * A goal in the library: its name and key targets, and a status word. The active goal is the
 * emphasised card (the S48 card); the others are list cards, templates dashed.
 * @design C46 GoalCard
 */
export function GoalCard({
  status,
  label,
  title,
  detail,
  badge,
  chips,
  onOpen,
  openLabel,
  action,
  headingLevel = 3,
  className,
}: GoalCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const active = status === 'active';
  const word = badge ?? BADGE[status];
  const cls = [
    styles.card,
    active ? styles.active : styles.listed,
    status === 'ended' ? styles.ended : '',
    onOpen ? styles.pressable : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card radius={active ? 'lg' : 'card'} padding={active ? '16px 18px' : '14px 16px'} dashed={status === 'template'} className={cls}>
      <div className={styles.head}>
        <div className={styles.text}>
          {label ? <p className={styles.label}>{label}</p> : null}
          <Heading className={styles.title}>
            {onOpen ? (
              <button type="button" className={styles.open} aria-label={openLabel} onClick={onOpen}>
                {title}
              </button>
            ) : (
              title
            )}
          </Heading>
          <p className={styles.detail}>{detail}</p>
        </div>
        {active ? (
          <span className={styles.activeBadge}>{word}</span>
        ) : (
          <Pill tone="neutral" icon={status === 'next' ? <Clock size={12} strokeWidth={2} /> : undefined} className={styles.badge}>
            {word}
          </Pill>
        )}
      </div>

      {chips && chips.length > 0 ? (
        <ul className={styles.chips} aria-label="Saved goals">
          {chips.map((chip, i) => (
            <li key={`${i}:${chip}`} className={styles.chip}>
              {chip}
            </li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <div className={styles.foot}>
          <Button size="sm" variant="secondary" className={styles.action} disabled={action.busy} onClick={action.onPress}>
            {action.label}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
