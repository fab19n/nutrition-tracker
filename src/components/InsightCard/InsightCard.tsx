import { Check } from 'lucide-react';
import styles from './InsightCard.module.css';

export interface InsightCardProps {
  /** "Drinks were 17% of your calories". */
  headline: string;
  /** "Teh tarik 8 times, milo ais 3 times, ~2,200 kcal." */
  evidence: string;
  /** "See 11 drinks" — opens the evidence sheet. */
  linkLabel?: string;
  onLink?: () => void;
  /** Without the "Try:" prefix. */
  tryText?: string;
  /** "Early read · based on 9 days". */
  meta?: string;
  /** Useful / Not for me footer (Insights). The weekly review shows the card without it. */
  footer?: boolean;
  /** Marked useful: the Useful pill turns accent with a check. */
  useful?: boolean;
  onUseful?: () => void;
  onNotForMe?: () => void;
  /** "Not for me" was pressed: collapsed to one line with Undo. */
  dismissed?: boolean;
  onUndo?: () => void;
  /** Heading level of the headline under the screen's section heading. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/**
 * @design C41 InsightCard — fact, evidence with a "See …" link, one thing to try, and
 * Useful / Not for me. States: new · marked useful · dismissed (collapsed with undo).
 */
export function InsightCard({
  headline,
  evidence,
  linkLabel,
  onLink,
  tryText,
  meta,
  footer = true,
  useful,
  onUseful,
  onNotForMe,
  dismissed,
  onUndo,
  headingLevel: Heading = 'h3',
  className,
}: InsightCardProps) {
  if (dismissed) {
    return (
      <div className={[styles.card, styles.dismissed, className].filter(Boolean).join(' ')} role="status">
        <span className={styles.dismissedText}>
          <span className={styles.dismissedLabel}>Paused for 4 weeks</span>
          <span className={styles.dismissedHeadline}>{headline}</span>
        </span>
        {onUndo ? (
          <button type="button" className={styles.undo} onClick={onUndo} aria-label={`Undo: show “${headline}” again`}>
            Undo
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <article className={[styles.card, className].filter(Boolean).join(' ')}>
      <Heading className={['t-insight', styles.headline].join(' ')}>{headline}</Heading>
      <p className={styles.evidence}>
        {evidence}
        {linkLabel && onLink ? (
          <>
            {' '}
            <button type="button" className={styles.link} onClick={onLink}>
              {linkLabel}
            </button>
          </>
        ) : null}
      </p>
      {tryText ? (
        <p className={styles.try}>
          <b>Try:</b> {tryText}
        </p>
      ) : null}
      {footer ? (
        <div className={styles.footer}>
          <span className={styles.meta}>{meta}</span>
          <div className={styles.actions}>
            {onUseful ? (
              <button
                type="button"
                className={[styles.useful, useful ? styles.usefulOn : ''].filter(Boolean).join(' ')}
                aria-pressed={useful === true}
                onClick={onUseful}
              >
                {useful ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
                Useful
              </button>
            ) : null}
            {onNotForMe ? (
              <button type="button" className={styles.notForMe} onClick={onNotForMe}>
                Not for me
              </button>
            ) : null}
          </div>
        </div>
      ) : meta ? (
        <div className={styles.footer}>
          <span className={styles.meta}>{meta}</span>
        </div>
      ) : null}
    </article>
  );
}
