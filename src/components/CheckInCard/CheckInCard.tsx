import { useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { OptionGroup, type OptionItem } from '@/components/OptionRow/OptionRow';
import styles from './CheckInCard.module.css';

export interface CheckInCardProps {
  /** "Yesterday · 2 meals · 1,240 kcal" (full) or "Yesterday: 3 meals, 1,760 kcal. All there?" (light). */
  title: string;
  /** The small line above the title. */
  subtitle?: string;
  /** Slot for the compact DayTimeline (C12) with its gap box. */
  timeline?: ReactNode;
  /** Optional caption row under the timeline: "woke 10am · 11:10am · 3:40pm · slept 1:30am". */
  captions?: readonly string[];
  /** "Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm." */
  explanation?: string;
  question?: string;
  /** Answer rows (full variant). */
  options?: readonly OptionItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** What the selected answer means for the budget; updates as the user picks. */
  consequence?: string;
  /** Full: Done (does nothing until an answer is picked, then confirms). Light: Yes. */
  onDone: () => void;
  doneLabel?: string;
  /** Light variant only: "Add more". */
  onAddMore?: () => void;
  addMoreLabel?: string;
  /** full — the S15 sheet; light — a day that looks complete ("All there?" with Yes / Add more). */
  variant?: 'full' | 'light';
  /** Id for the title so a sheet can point aria-labelledby at it. */
  titleId?: string;
}

/**
 * @design C49 CheckInCard — S15 sheet content: greeting, yesterday's total, timeline card with the gap note,
 * "Was that everything?" with four radio rows, a live consequence line and Done.
 */
export function CheckInCard({
  title,
  subtitle = 'Good morning',
  timeline,
  captions,
  explanation,
  question = 'Was that everything?',
  options = [],
  selectedId,
  onSelect,
  consequence,
  onDone,
  doneLabel,
  onAddMore,
  addMoreLabel = 'Add more',
  variant = 'full',
  titleId,
}: CheckInCardProps) {
  const autoId = useId();
  const headingId = titleId ?? `${autoId}-title`;
  const questionId = `${autoId}-question`;
  const consequenceId = `${autoId}-consequence`;
  const consequenceRef = useRef<HTMLParagraphElement>(null);
  const picked = selectedId !== undefined;
  const isLight = variant === 'light';
  const hasTimelineCard = timeline != null || (captions && captions.length > 0) || !!explanation;

  return (
    <div className={styles.card}>
      <div className={styles.subtitle}>{subtitle}</div>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>

      {hasTimelineCard ? (
        <div className={styles.timelineCard}>
          {timeline}
          {captions && captions.length > 0 ? (
            <div className={styles.captions}>
              {captions.map((c, i) => (
                <span key={`${i}-${c}`}>{c}</span>
              ))}
            </div>
          ) : null}
          {explanation ? <p className={styles.explanation}>{explanation}</p> : null}
        </div>
      ) : null}

      {isLight ? (
        <div className={styles.lightActions}>
          <Button variant="secondary" onClick={onAddMore} disabled={!onAddMore}>
            {addMoreLabel}
          </Button>
          <Button onClick={onDone}>{doneLabel ?? 'Yes'}</Button>
        </div>
      ) : (
        <>
          <h3 id={questionId} className={styles.question}>
            {question}
          </h3>
          <OptionGroup labelledBy={questionId} options={options} value={selectedId} onChange={(id) => onSelect?.(id)} />
          <p id={consequenceId} ref={consequenceRef} tabIndex={-1} className={styles.consequence} aria-live="polite">
            {consequence}
          </p>
          {/* Full strength like the prototype; until an answer is picked it points at the prompt instead of confirming. */}
          <Button
            className={styles.done}
            aria-disabled={!picked}
            aria-describedby={picked ? undefined : consequenceId}
            onClick={() => (picked ? onDone() : consequenceRef.current?.focus())}
          >
            {doneLabel ?? 'Done'}
          </Button>
        </>
      )}
    </div>
  );
}
