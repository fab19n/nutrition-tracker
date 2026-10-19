import { useId } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './SuggestionCard.module.css';

export type SuggestionCardRole = 'usual' | 'lighterSwap' | 'different' | 'surprise';
export type SuggestionCardFit = 'fits' | 'tightFit';

export const SUGGESTION_ROLE_LABEL: Record<SuggestionCardRole, string> = {
  usual: 'Your usual',
  lighterSwap: 'Lighter swap',
  different: 'Something different',
  // The design has three roles; a Surprise me pick reads as the third.
  surprise: 'Something different',
};

const FIT_LABEL: Record<SuggestionCardFit, string> = { fits: 'Fits', tightFit: 'Tight fit' };

export interface SuggestionCardProps {
  role: SuggestionCardRole;
  /** "Ayam bakar, half rice, ulam". */
  name: string;
  /** "You had this 6 times this month". */
  reason: string;
  /** Pre-formatted: "~540 kcal". */
  kcalLabel: string;
  /** Pre-formatted: "38g protein". */
  proteinLabel?: string;
  /** "Medan selera nearby". */
  placeName?: string;
  /** "Fits" when it's within what's left today, else "Tight fit". */
  fit: SuggestionCardFit;
  /** Already logged today: the button becomes a "Logged" label. */
  logged?: boolean;
  onLog: () => void;
  /** Heading level for the dish name. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/**
 * @design C40 SuggestionCard — role, fit badge, dish, reason, ~kcal · protein · Place, Log this.
 * States: fits · tight fit · logged.
 */
export function SuggestionCard({
  role,
  name,
  reason,
  kcalLabel,
  proteinLabel,
  placeName,
  fit,
  logged,
  onLog,
  headingLevel: Heading = 'h2',
  className,
}: SuggestionCardProps) {
  const headingId = useId();
  const details = [proteinLabel, placeName].filter(Boolean);
  return (
    <article className={[styles.card, className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className={styles.header}>
        <span className={styles.role}>{SUGGESTION_ROLE_LABEL[role]}</span>
        <span className={[styles.fit, fit === 'fits' ? styles.fits : styles.tight].join(' ')}>{FIT_LABEL[fit]}</span>
      </div>
      <Heading id={headingId} className={['t-card-headline', styles.name].join(' ')}>
        {name}
      </Heading>
      <p className={styles.reason}>{reason}</p>
      <div className={styles.footer}>
        <p className={styles.numbers}>
          <b>{kcalLabel}</b>
          {details.length > 0 ? <span className={styles.details}> · {details.join(' · ')}</span> : null}
        </p>
        {logged ? (
          <span className={styles.logged}>
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
            Logged
          </span>
        ) : (
          <Button size="sm" className={styles.log} onClick={onLog} aria-label={`Log this: ${name}`}>
            Log this
          </Button>
        )}
      </div>
    </article>
  );
}

export interface SurpriseCardProps {
  onPress: () => void;
  /** "Surprise me". */
  label?: string;
  disabled?: boolean;
}

/** @design C40 "Surprise me" — dashed card under the three picks. */
export function SurpriseCard({ onPress, label = 'Surprise me', disabled }: SurpriseCardProps) {
  return (
    <button type="button" className={styles.surprise} onClick={onPress} disabled={disabled}>
      {label}
    </button>
  );
}
