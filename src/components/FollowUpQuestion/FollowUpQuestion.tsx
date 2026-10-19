import { useId } from 'react';
import { ChipGroup } from '@/components/ui/Chip';
import styles from './FollowUpQuestion.module.css';

export interface FollowUpQuestionProps {
  /** "Is there kuah under the rice?" */
  question: string;
  /** 2–4 short answers. */
  options: readonly string[];
  selectedIndex?: number;
  onAnswer: (index: number) => void;
  onSkip: () => void;
}

/**
 * A question the estimator asks about the whole meal (not tied to one item's chips).
 * At most two per meal; each is skippable. The amber ring stays until it's answered.
 * @design C25
 */
export function FollowUpQuestion({ question, options, selectedIndex = -1, onAnswer, onSkip }: FollowUpQuestionProps) {
  const id = useId();
  return (
    <section
      className={[styles.card, selectedIndex < 0 ? styles.open : ''].join(' ')}
      aria-labelledby={id}
    >
      <p id={id} className={styles.question}>
        {question}
      </p>
      <div className={styles.answers}>
        <ChipGroup
          kind="portion"
          label={question}
          options={options}
          selectedIndex={selectedIndex}
          getLabel={(o) => o}
          onSelect={onAnswer}
        />
        <button type="button" className={styles.skip} onClick={onSkip}>
          Skip
        </button>
      </div>
    </section>
  );
}
