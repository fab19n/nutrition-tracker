import { useId } from 'react';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './TargetSuggestionCard.module.css';

export interface TargetWorkingRow {
  /** "Logged", "Workouts added", "Trend", "Maintenance". */
  label: string;
  /** "~1,820 a day". */
  value: string;
  /** The result row (maintenance). */
  strong?: boolean;
}

export interface TargetSuggestionCardProps {
  /** compact: Insights (S31). full: S37 with the working laid out. */
  variant?: 'compact' | 'full';
  /** "Based on 4 weeks". */
  meta?: string;
  /** "Your real maintenance looks like ~2,100, not 2,350". */
  headline: string;
  /** "You logged ~1,820 a day, and your trend dropped 0.25 kg a week." */
  working: string;
  /** Full: Logged · Workouts added · Trend · Maintenance. */
  workingRows?: TargetWorkingRow[];
  /** Full: "From 28 complete days, Mon 28 Sep to Sun 25 Oct. …" */
  basis?: string;
  /** "1,800". */
  currentKcal: string;
  /** "1,550". */
  suggestedKcal: string;
  /** "At your 0.5 kg a week pace, never below your 1,400 minimum." */
  targetNote: string;
  /** Compact: "Starts tomorrow (Sat) if you approve." Full: "Starts tomorrow (Sat). Today and earlier days keep their target." */
  startsNote: string;
  /** Full: "This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal". */
  weekLine?: string;
  /** Full: "Change pace instead" with "0.25 kg a week → 1,825 a day". */
  slowerPace?: { detail: string; onChoose: () => void };
  /** Full, kept state: shown where Keep current was. */
  keptNote?: string;
  onApprove: () => void;
  /** Hidden when absent (kept state). */
  onKeep?: () => void;
  /** Compact: "See the working". */
  onDetails?: () => void;
  /** A decision is saving: every button waits. */
  busy?: boolean;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/**
 * @design C45 TargetSuggestionCard — current vs suggested target, the working in plain words,
 * Approve / Keep current, and "Change pace instead". States: compact (Insights) · full (S37) ·
 * held at the minimum · kept. The target only changes on Approve.
 */
export function TargetSuggestionCard({
  variant = 'compact',
  meta,
  headline,
  working,
  workingRows,
  basis,
  currentKcal,
  suggestedKcal,
  targetNote,
  startsNote,
  weekLine,
  slowerPace,
  keptNote,
  onApprove,
  onKeep,
  onDetails,
  busy,
  headingLevel: Heading = 'h2',
  className,
}: TargetSuggestionCardProps) {
  const headingId = useId();
  const full = variant === 'full';
  return (
    <article className={[styles.card, className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className={styles.header}>
        <span className={styles.label}>Target suggestion</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      <Heading id={headingId} className={[full ? 't-card-headline' : 't-insight', styles.headline].join(' ')}>
        {headline}
      </Heading>
      <p className={styles.working}>{working}</p>

      {full && workingRows && workingRows.length > 0 ? (
        <dl className={styles.rows} aria-label="How it was worked out">
          {workingRows.map((row) => (
            <div key={row.label} className={[styles.row, row.strong ? styles.strong : ''].filter(Boolean).join(' ')}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {full && basis ? <p className={styles.basis}>{basis}</p> : null}

      <div className={styles.compare} role="group" aria-label={`Now ${currentKcal} a day, suggested ${suggestedKcal} a day`}>
        <div className={styles.side}>
          <span className={styles.sideLabel}>Now</span>
          <span>
            <span className="t-metric-sm">{currentKcal}</span>
            <span className={styles.unit}> a day</span>
          </span>
        </div>
        <ArrowRight className={styles.arrow} size={16} strokeWidth={2} aria-hidden="true" />
        <div className={styles.side}>
          <span className={styles.sideLabel}>Suggested</span>
          <span>
            <span className={['t-metric-sm', styles.suggested].join(' ')}>{suggestedKcal}</span>
            <span className={styles.unit}> a day</span>
          </span>
        </div>
      </div>

      <p className={styles.note}>{targetNote}</p>
      <p className={styles.note}>{startsNote}</p>
      {full && weekLine ? <p className={styles.week}>{weekLine}</p> : null}

      {full && keptNote ? (
        <p className={styles.kept}>
          <Check className={styles.keptIcon} size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>{keptNote}</span>
        </p>
      ) : null}

      {full ? (
        <div className={styles.fullActions}>
          <Button size="lg" onClick={onApprove} disabled={busy}>
            Approve
          </Button>
          {onKeep ? (
            <Button size="lg" variant="secondary" onClick={onKeep} disabled={busy}>
              Keep current
            </Button>
          ) : null}
          {slowerPace ? (
            <button type="button" className={styles.slower} onClick={slowerPace.onChoose} disabled={busy}>
              <span className={styles.slowerText}>
                <span className={styles.slowerTitle}>Change pace instead</span>
                <span className={styles.slowerDetail}>{slowerPace.detail}</span>
              </span>
              <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.compactActions}>
          {onDetails ? (
            <button type="button" className={styles.details} onClick={onDetails} disabled={busy}>
              See the working
            </button>
          ) : (
            <span />
          )}
          <div className={styles.buttons}>
            {onKeep ? (
              <Button size="sm" variant="secondary" onClick={onKeep} disabled={busy}>
                Keep current
              </Button>
            ) : null}
            <Button size="sm" onClick={onApprove} disabled={busy}>
              Approve
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
