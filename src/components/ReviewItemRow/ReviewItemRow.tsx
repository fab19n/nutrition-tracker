import { useId, useState, type FormEvent } from 'react';
import { ArrowLeftRight, CloudOff, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { PortionChips } from '@/components/PortionChips/PortionChips';
import { SourceTag } from '@/components/SourceTag/SourceTag';
import { fmtRange } from '@/domain/format';
import { itemRange } from '@/domain/meal';
import type { MealItem } from '@/domain/types';
import { ItemMenu, type ItemMenuAction } from './ItemMenu';
import styles from './ReviewItemRow.module.css';

export const PENDING_ESTIMATE_HINT = "Estimate will run when you're back online";
/** Online, but the estimator couldn't read it (no AI here, a timeout): nothing will re-run on its own. */
export const ROUGH_GUESS_HINT = 'Rough guess for now. Swap it for a closer match.';

/** An item this unsure (±30% or more) shows its range in a softer style instead of one number. */
export const UNCERTAIN_AT = 0.3;

export interface ReviewItemRowProps {
  item: MealItem;
  /** Pre-formatted item estimate, e.g. "~330". */
  kcalLabel: string;
  /** Open follow-up question; defaults to item.question. */
  question?: string;
  onSelectVariant?: (index: number) => void;
  onRemove?: () => void;
  onSwap?: () => void;
  /** Not estimated yet; defaults to item.pendingEstimate. */
  pending?: boolean;
  /** Why a pending item waits: offline (the estimate runs once back online) or the estimator couldn't read it. */
  pendingReason?: 'offline' | 'unavailable';
  /** Wide range: shows "~300–420" in a softer style. Defaults to uncertainty ≥ 0.3 (not for AI guesses, which have their own ring). */
  uncertain?: boolean;
  /** Answers the open question in words (the item is estimated again); no field without it. */
  onAnswer?: (answer: string) => void;
  /** Closes the open question without an answer. */
  onSkip?: () => void;
  /** An answer is being estimated: the field and its buttons wait. */
  answering?: boolean;
}

/**
 * One item on the Review screen: name, source tag, estimate, portion chips, and a small
 * overflow menu to swap or remove it. A row with an open question (or an AI guess) gets an
 * amber ring.
 * @design C21
 */
export function ReviewItemRow({
  item,
  kcalLabel,
  question = item.question,
  onSelectVariant,
  onRemove,
  onSwap,
  pending = item.pendingEstimate ?? false,
  pendingReason = 'offline',
  uncertain = item.source !== 'aiGuess' && item.uncertainty >= UNCERTAIN_AT,
  onAnswer,
  onSkip,
  answering = false,
}: ReviewItemRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const questionId = useId();
  const variants = item.variants ?? [];
  const name = item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
  const needsAttention = !pending && (!!question || item.source === 'aiGuess');

  const actions: ItemMenuAction[] = [];
  if (onSwap) actions.push({ id: 'swap', label: 'Swap item', icon: <ArrowLeftRight size={18} strokeWidth={2} />, onSelect: onSwap });
  if (onRemove) {
    actions.push({ id: 'remove', label: 'Remove', icon: <Trash2 size={18} strokeWidth={2} />, onSelect: onRemove, destructive: true });
  }

  return (
    <Card
      radius="card"
      padding="12px 14px"
      ring={needsAttention ? 'amberThin' : null}
      className={[styles.row, menuOpen ? styles.raised : ''].join(' ')}
    >
      <div className={styles.header}>
        <span className={styles.name}>
          {name}
          <SourceTag source={item.source} className={styles.tag} />
        </span>
        <span className={styles.end}>
          {pending ? (
            <span className={styles.kcalPending}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Estimate pending</span>
            </span>
          ) : uncertain ? (
            <span className={styles.kcalUncertain}>
              <span className="sr-only">Likely </span>~{fmtRange(itemRange(item))}
            </span>
          ) : (
            <span className={styles.kcal}>{kcalLabel}</span>
          )}
          {actions.length > 0 ? <ItemMenu label={`More for ${item.name}`} actions={actions} onOpenChange={setMenuOpen} /> : null}
        </span>
      </div>

      {pending ? (
        <p className={styles.note}>
          {pendingReason === 'offline' ? <CloudOff size={14} strokeWidth={2} aria-hidden="true" className={styles.noteIcon} /> : null}
          {pendingReason === 'offline' ? PENDING_ESTIMATE_HINT : ROUGH_GUESS_HINT}
        </p>
      ) : null}

      {question ? (
        <p id={questionId} className={styles.note}>
          {question}
        </p>
      ) : null}

      {question && !pending && (onAnswer || onSkip) ? (
        <form
          className={styles.answer}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (answer.trim() && !answering) onAnswer?.(answer.trim());
          }}
        >
          {onAnswer ? (
            <>
              <input
                className={styles.answerInput}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
                aria-labelledby={questionId}
                autoComplete="off"
                enterKeyHint="done"
                disabled={answering}
              />
              <button type="submit" className={styles.update} disabled={answering || !answer.trim()}>
                {answering ? 'Updating…' : 'Update'}
              </button>
            </>
          ) : null}
          {onSkip ? (
            <button type="button" className={styles.skip} onClick={onSkip} disabled={answering}>
              Skip
            </button>
          ) : null}
        </form>
      ) : null}

      {variants.length > 1 ? (
        <div className={styles.chips}>
          <PortionChips
            label={`${item.name} portion`}
            variants={variants}
            selectedIndex={item.selectedVariant ?? -1}
            onSelect={(i) => onSelectVariant?.(i)}
          />
        </div>
      ) : null}
    </Card>
  );
}
