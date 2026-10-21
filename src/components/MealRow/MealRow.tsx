import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { CloudOff, Copy, Ellipsis, Trash } from 'lucide-react';
import type { Finished } from '@/domain/types';
import { Pill } from '@/components/ui/Pill';
import { PhotoThumb } from '@/components/PhotoThumb/PhotoThumb';
import { TimingTag, type TimingTagKind } from '@/components/TimingTag/TimingTag';
import { useSwipeReveal } from './useSwipeReveal';
import styles from './MealRow.module.css';

/** Width of one swipe action in px. */
const ACTION_WIDTH = 72;

export interface MealRowProps {
  /** "Breakfast" */
  slotLabel: string;
  /** "10:40am" */
  timeLabel: string;
  /** "Nasi kandar near home" */
  placeName?: string;
  /** "RM 4.80" (Diary rows) */
  priceLabel?: string;
  /** "Roti canai + teh tarik" */
  name: string;
  /** Why the row is here, when the name doesn't say ("Includes Kangkung belacan"): a caption under the name. */
  note?: string;
  /** Pre-formatted estimate, e.g. "~560". */
  kcalLabel: string;
  tag?: TimingTagKind;
  thumbUrl?: string;
  finished?: Finished;
  /** Saved offline, waiting to sync. */
  pending?: boolean;
  /** Filled in by the check-in ("Fill in a typical one"): dashed row with a "Guess" pill. */
  isGuess?: boolean;
  onPress: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Play the km-up enter animation (default true). */
  animateIn?: boolean;
}

/**
 * @design C29 MealRow — ledger entry: 52px thumb, meta line, name, TimingTag, "~kcal".
 * Swipe left reveals Duplicate and Delete; keyboard users reach them through the overflow button,
 * which appears on focus. Escape closes the actions.
 */
export function MealRow({
  slotLabel,
  timeLabel,
  placeName,
  priceLabel,
  name,
  note,
  kcalLabel,
  tag,
  thumbUrl,
  finished,
  pending,
  isGuess,
  onPress,
  onDuplicate,
  onDelete,
  animateIn = true,
}: MealRowProps) {
  const actionCount = (onDuplicate ? 1 : 0) + (onDelete ? 1 : 0);
  const hasActions = actionCount > 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const focusActionsOnOpen = useRef(false);
  const swipe = useSwipeReveal(actionCount * ACTION_WIDTH, hasActions, rootRef);
  const { open, setOpen } = swipe;

  useEffect(() => {
    if (open && focusActionsOnOpen.current) {
      focusActionsOnOpen.current = false;
      firstActionRef.current?.focus();
    }
  }, [open]);

  const meta = [slotLabel, timeLabel, placeName, priceLabel].filter(Boolean).join(' · ');

  const handlePress = () => {
    if (swipe.consumeSwipeClick()) return;
    if (open) {
      setOpen(false);
      return;
    }
    onPress();
  };

  const toggleActions = () => {
    focusActionsOnOpen.current = !open;
    setOpen(!open);
  };

  const runAction = (action: () => void) => {
    setOpen(false);
    // The action buttons go inert as they slide away; keep keyboard focus on the row's More button.
    moreRef.current?.focus();
    action();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      moreRef.current?.focus();
    }
  };

  const sliderStyle: CSSProperties = { transform: swipe.offset ? `translateX(${swipe.offset}px)` : undefined };
  const rootCls = [styles.root, isGuess ? styles.guess : '', animateIn ? styles.enter : ''].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootCls} onKeyDown={handleKeyDown}>
      {hasActions ? (
        <div
          className={styles.actions}
          style={{ width: actionCount * ACTION_WIDTH }}
          data-revealed={swipe.revealed}
          inert={!swipe.revealed}
        >
          {onDuplicate ? (
            <button
              ref={firstActionRef}
              type="button"
              className={[styles.action, styles.duplicate].join(' ')}
              tabIndex={open ? 0 : -1}
              onClick={() => runAction(onDuplicate)}
            >
              <Copy size={20} strokeWidth={2} aria-hidden="true" />
              Duplicate
            </button>
          ) : null}
          {onDelete ? (
            <button
              ref={onDuplicate ? undefined : firstActionRef}
              type="button"
              className={[styles.action, styles.delete].join(' ')}
              tabIndex={open ? 0 : -1}
              onClick={() => runAction(onDelete)}
            >
              <Trash size={20} strokeWidth={2} aria-hidden="true" />
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={[styles.slider, swipe.dragging ? styles.dragging : ''].filter(Boolean).join(' ')} style={sliderStyle} {...swipe.handlers}>
        <button type="button" className={styles.main} onClick={handlePress}>
          <PhotoThumb url={thumbUrl} finished={finished} />
          <span className={styles.body}>
            <span className={styles.meta}>{meta}</span>
            <span className={styles.name}>{name}</span>
            {note ? <span className={styles.note}>{note}</span> : null}
            {isGuess || tag ? (
              <span className={styles.tags}>
                {isGuess ? (
                  <Pill tone="neutral" className={styles.guessPill}>
                    Guess
                  </Pill>
                ) : null}
                {tag ? <TimingTag kind={tag} /> : null}
              </span>
            ) : null}
          </span>
          <span className={styles.end}>
            <span className={styles.kcal}>
              {kcalLabel}
              <span className="sr-only"> kcal</span>
            </span>
            {pending ? (
              <span className={styles.sync}>
                <CloudOff size={14} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">Waiting to sync</span>
              </span>
            ) : null}
          </span>
        </button>
        {hasActions ? (
          <button
            ref={moreRef}
            type="button"
            className={styles.more}
            aria-label={`More actions for ${name}`}
            aria-expanded={open}
            onClick={toggleActions}
          >
            <Ellipsis size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
