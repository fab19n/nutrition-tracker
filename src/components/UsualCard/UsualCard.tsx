import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Repeat, Trash2 } from 'lucide-react';
import { ItemMenu, type ItemMenuAction } from '@/components/ReviewItemRow/ItemMenu';
import { Button } from '@/components/ui/Button';
import { fmtInt } from '@/domain/format';
import styles from './UsualCard.module.css';

/** "Not used yet", "Used once", "Used 9 times". */
export function usesLabel(useCount: number): string {
  if (useCount <= 0) return 'Not used yet';
  if (useCount === 1) return 'Used once';
  return `Used ${fmtInt(useCount)} times`;
}

export interface UsualCardProps {
  /** "Roti canai + teh tarik". */
  name: string;
  /** "Roti canai + dhal · Teh tarik". Empty hides the line (when it would only repeat the name). */
  itemsLabel: string;
  /** Pre-formatted: "~560 kcal". */
  kcalLabel: string;
  /** "Nasi kandar near home". */
  placeName?: string;
  useCount: number;
  /** Log in one tap (opens the review, pre-filled). */
  onLog: () => void;
  onEdit: () => void;
  /** Leave out on the first card: the menu then has no "Move up". */
  onMoveUp?: () => void;
  /** Leave out on the last card. */
  onMoveDown?: () => void;
  onDelete: () => void;
  /** Disables Log while a log is starting. */
  busy?: boolean;
  /** Heading level for the name. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/**
 * @design C37 UsualCard — name, items, ~kcal, Place, use count, Log in one tap, and an
 * overflow menu (Edit · Move up · Move down · Delete). Reordering goes through the menu, so it
 * works with a keyboard or a screen reader; there is no drag.
 */
export function UsualCard({
  name,
  itemsLabel,
  kcalLabel,
  placeName,
  useCount,
  onLog,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  busy,
  headingLevel: Heading = 'h3',
  className,
}: UsualCardProps) {
  const headingId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const details = [placeName, usesLabel(useCount)].filter(Boolean);

  const actions: ItemMenuAction[] = [{ id: 'edit', label: 'Edit', icon: <Pencil size={18} strokeWidth={2} />, onSelect: onEdit }];
  if (onMoveUp) actions.push({ id: 'up', label: 'Move up', icon: <ArrowUp size={18} strokeWidth={2} />, onSelect: onMoveUp });
  if (onMoveDown) actions.push({ id: 'down', label: 'Move down', icon: <ArrowDown size={18} strokeWidth={2} />, onSelect: onMoveDown });
  actions.push({ id: 'delete', label: 'Delete', icon: <Trash2 size={18} strokeWidth={2} />, onSelect: onDelete, destructive: true });

  return (
    <article
      className={[styles.card, menuOpen ? styles.raised : '', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <div className={styles.header}>
        <Heading id={headingId} className={['t-item', styles.name].join(' ')}>
          {name}
        </Heading>
        <ItemMenu label={`More for ${name}`} actions={actions} onOpenChange={setMenuOpen} />
      </div>
      {itemsLabel ? <p className={styles.items}>{itemsLabel}</p> : null}
      <div className={styles.footer}>
        <p className={styles.numbers}>
          <b className={styles.kcal}>{kcalLabel}</b>
          {details.length > 0 ? <span className={styles.details}> · {details.join(' · ')}</span> : null}
        </p>
        <Button size="sm" className={styles.log} onClick={onLog} disabled={busy} aria-label={`Log ${name}`}>
          Log
        </Button>
      </div>
    </article>
  );
}

export interface UsualSuggestionCardProps {
  /** The meal's name as you logged it: "Bread, kaya, kopi". */
  name: string;
  /** Times logged recently (3 or more). */
  times: number;
  /** Pre-formatted: "~380 kcal". */
  kcalLabel?: string;
  placeName?: string;
  onSave: () => void;
  onDismiss: () => void;
  busy?: boolean;
  className?: string;
}

/**
 * @design C37 UsualCard (suggested) — "You've logged Bread, kaya, kopi 4 times. Save as a Usual?"
 * with Save and Not now.
 */
export function UsualSuggestionCard({
  name,
  times,
  kcalLabel,
  placeName,
  onSave,
  onDismiss,
  busy,
  className,
}: UsualSuggestionCardProps) {
  const questionId = useId();
  const details = [kcalLabel, placeName].filter(Boolean);
  return (
    <article className={[styles.card, styles.suggestion, className].filter(Boolean).join(' ')} aria-labelledby={questionId}>
      <div className={styles.suggestionBody}>
        <span className={styles.suggestionIcon} aria-hidden="true">
          <Repeat size={18} strokeWidth={2} />
        </span>
        <div className={styles.suggestionText}>
          <p id={questionId} className={styles.question}>
            You've logged <strong>{name}</strong> {fmtInt(times)} times. Save as a Usual?
          </p>
          {details.length > 0 ? <p className={styles.suggestionDetail}>{details.join(' · ')}</p> : null}
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy} aria-label={`Not now: ${name}`}>
          Not now
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy} aria-label={`Save ${name} as a Usual`}>
          Save
        </Button>
      </div>
    </article>
  );
}
