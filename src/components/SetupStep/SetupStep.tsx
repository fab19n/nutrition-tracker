import { useId, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './SetupStep.module.css';

export interface SetupStepProps {
  /** 1-based. */
  step: number;
  total: number;
  title: string;
  helper?: string;
  children?: ReactNode;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}

/**
 * @design C53 SetupStep — S02–S07 frame: back, "Step n of N", segmented 4px progress bar, 24px/700 question,
 * helper line, content and a sticky Next button. The step is a form, so Enter in a field moves on.
 */
export function SetupStep({
  step,
  total,
  title,
  helper,
  children,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  onBack,
  onSkip,
  skipLabel = 'Skip',
}: SetupStepProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const helperId = `${id}-helper`;
  const current = Math.min(Math.max(step, 1), total);
  const stepLabel = `Step ${current} of ${total}`;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!nextDisabled) onNext();
  };

  return (
    <form className={styles.step} onSubmit={submit} aria-labelledby={titleId} aria-describedby={helper ? helperId : undefined} noValidate>
      <div className={styles.top}>
        {onBack ? (
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <span className={styles.stepLabel}>{stepLabel}</span>
        {onSkip ? (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {skipLabel}
          </Button>
        ) : null}
      </div>

      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={stepLabel}
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={[styles.segment, i < current ? styles.filled : ''].filter(Boolean).join(' ')} />
        ))}
      </div>

      <h1 id={titleId} className={styles.title}>
        {title}
      </h1>
      {helper ? (
        <p id={helperId} className={styles.helper}>
          {helper}
        </p>
      ) : null}

      <div className={styles.content}>{children}</div>

      <div className={styles.footer}>
        <Button type="submit" disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </form>
  );
}
