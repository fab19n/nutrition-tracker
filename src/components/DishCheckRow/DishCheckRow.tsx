import { MapPin } from 'lucide-react';
import { SourceTag } from '@/components/SourceTag/SourceTag';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Pill } from '@/components/ui/Pill';
import type { DishAnswer, DishSource } from '@/domain/dishCheck';
import styles from './DishCheckRow.module.css';

export interface DishCheckRowProps {
  name: string;
  /** "~200" */
  kcalLabel: string;
  source: DishSource;
  /** Only for a Place default; read out beside the tag. */
  placeName?: string;
  /** "Normal · 8 times", "Mamak big · Nasi kandar near home · 6 times". */
  detail: string;
  answer?: DishAnswer;
  /** Shown after an answer: "Usually more. Now ~250 kcal (was ~200)." */
  resultLine?: string;
  onAnswer: (answer: DishAnswer) => void;
  /** Only while the screen still holds the undo. */
  onUndo?: () => void;
  /** A save is running: the answers wait. */
  busy?: boolean;
  className?: string;
}

const ANSWERS: readonly { value: DishAnswer; label: string }[] = [
  { value: 'right', label: 'Looks right' },
  { value: 'more', label: 'Usually more' },
  { value: 'less', label: 'Usually less' },
];

function SourceLabel({ source, placeName }: Pick<DishCheckRowProps, 'source' | 'placeName'>) {
  if (source !== 'placeDefault') return <SourceTag source={source} />;
  return (
    <Pill tone="outline" icon={<MapPin size={12} strokeWidth={2} />}>
      Place default
      {placeName ? <span className="sr-only"> at {placeName}</span> : null}
    </Pill>
  );
}

/**
 * @design S34 one dish on the Top dishes check: its name, the number it starts at, where that comes from,
 * and three answers. Once answered the row locks and says what changed.
 */
export function DishCheckRow({ name, kcalLabel, source, placeName, detail, answer, resultLine, onAnswer, onUndo, busy, className }: DishCheckRowProps) {
  const locked = answer !== undefined || busy === true;
  return (
    <li className={[styles.item, className].filter(Boolean).join(' ')}>
      <Card radius="card" padding="12px 14px">
        <div className={styles.head}>
          <span className={['t-item', styles.name].join(' ')}>{name}</span>
          <span className={['t-meal-kcal', styles.kcal].join(' ')}>
            {kcalLabel} <span className={styles.unit}>kcal</span>
          </span>
        </div>
        <div className={styles.meta}>
          <SourceLabel source={source} placeName={placeName} />
          <span>{detail}</span>
        </div>
        <div className={styles.answers} role="group" aria-label={`${name}: is ${kcalLabel} kcal right?`}>
          {ANSWERS.map((option) => (
            <Chip key={option.value} kind="portion" selected={answer === option.value} disabled={locked} onClick={() => onAnswer(option.value)}>
              {option.label}
            </Chip>
          ))}
        </div>
        <div className={styles.result}>
          <span aria-live="polite">{resultLine}</span>
          {answer !== undefined && onUndo ? (
            <button type="button" className={styles.undo} onClick={onUndo} aria-label={`Undo answer for ${name}`}>
              Undo
            </button>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
