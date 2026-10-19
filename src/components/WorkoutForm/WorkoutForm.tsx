import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Activity, Bike, Dumbbell, Feather, Footprints, Goal, Minus, Plus, Timer, WavesLadder, type LucideIcon } from 'lucide-react';
import { Chip } from '@/components/ui/Chip';
import { fmtApprox, fmtInt } from '@/domain/format';
import type { Intensity, WorkoutType } from '@/domain/types';
import {
  INTENSITIES,
  INTENSITY_LABEL,
  MINUTES,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABEL,
  gridMove,
  lineMove,
  minutesError,
  parseMinutes,
  stepMinutes,
  type WorkoutFormValue,
} from './workoutOptions';
import styles from './WorkoutForm.module.css';

/** One outline icon per type (Lucide has no shuttlecock or runner: a feather and a stopwatch stand in). */
export const WORKOUT_TYPE_ICON: Record<WorkoutType, LucideIcon> = {
  walking: Footprints,
  futsal: Goal,
  badminton: Feather,
  gym: Dumbbell,
  running: Timer,
  cycling: Bike,
  swimming: WavesLadder,
  other: Activity,
};

const HELPER = 'Estimated from activity type, time, intensity and your weight.';

export interface WorkoutFormProps {
  value: WorkoutFormValue;
  onChange: (value: WorkoutFormValue) => void;
  /** Net kcal for the current choices; null while the time isn't valid or there's no weight to go on. */
  estimateKcal: number | null;
  /** Whose budget gets it: "this week" (default) or "last week". */
  weekLabel?: string;
  /** Shown instead of the estimate when there's nothing to estimate from. */
  estimateNote?: string;
  /** Show the time's message now (after a Save attempt); otherwise it shows once the field is left. */
  showErrors?: boolean;
  className?: string;
}

function Label({ id, htmlFor, children }: { id?: string; htmlFor?: string; children: ReactNode }) {
  const cls = ['t-section', styles.label].join(' ');
  return htmlFor ? (
    <label id={id} htmlFor={htmlFor} className={cls}>
      {children}
    </label>
  ) : (
    <span id={id} className={cls}>
      {children}
    </span>
  );
}

/** Two rows of four type tiles; a radio group with arrow keys (roving focus). */
function TypePicker({ value, onChange, labelId }: { value: WorkoutType; onChange: (type: WorkoutType) => void; labelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, WORKOUT_TYPES.indexOf(value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = gridMove(index, event.key, WORKOUT_TYPES.length);
    const type = next === null ? undefined : WORKOUT_TYPES[next];
    if (next === null || type === undefined) return;
    event.preventDefault();
    onChange(type);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelId} className={styles.types}>
      {WORKOUT_TYPES.map((type, index) => {
        const Icon = WORKOUT_TYPE_ICON[type];
        const selected = index === selectedIndex;
        return (
          <button
            key={type}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={[styles.type, selected ? styles.typeSelected : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(type)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <Icon size={20} strokeWidth={2} aria-hidden="true" />
            <span className={styles.typeLabel}>{WORKOUT_TYPE_LABEL[type]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Easy / Moderate / Hard as stretched portion chips (selected in --accent, like the day chips
 * above the form); a radio group with arrow keys (roving focus).
 */
function IntensityPicker({ value, onChange, labelId }: { value: Intensity; onChange: (intensity: Intensity) => void; labelId: string }) {
  const groupRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, INTENSITIES.indexOf(value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = lineMove(index, event.key, INTENSITIES.length);
    const intensity = next === null ? undefined : INTENSITIES[next];
    if (next === null || intensity === undefined) return;
    event.preventDefault();
    onChange(intensity);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div ref={groupRef} role="radiogroup" aria-labelledby={labelId} className={styles.intensity}>
      {INTENSITIES.map((intensity, index) => {
        const selected = index === selectedIndex;
        return (
          <Chip
            key={intensity}
            kind="portion"
            selected={selected}
            role="radio"
            aria-checked={selected}
            aria-pressed={undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(intensity)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {INTENSITY_LABEL[intensity]}
          </Chip>
        );
      })}
    </div>
  );
}

interface DurationProps {
  text: string;
  onChange: (text: string) => void;
  error: string | null;
  onLeave: () => void;
}

/** − [60] min + ; the field takes typed minutes, ↑/↓ step like the buttons. */
function Duration({ text, onChange, error, onLeave }: DurationProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const parsed = parseMinutes(text);

  const step = (direction: 1 | -1) => onChange(String(stepMinutes(text, direction)));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(event.key === 'ArrowUp' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onLeave();
    }
  };

  return (
    <div className={styles.group}>
      <Label htmlFor={inputId}>
        Time <span className="sr-only">in minutes</span>
      </Label>
      <div className={[styles.duration, error ? styles.durationInvalid : ''].filter(Boolean).join(' ')}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={`${fmtInt(MINUTES.step)} minutes less`}
          disabled={parsed !== null && parsed <= MINUTES.min}
          onClick={() => step(-1)}
        >
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className={styles.minutes}>
          <input
            id={inputId}
            className={styles.minutesInput}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={4}
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={onLeave}
            onKeyDown={onKeyDown}
          />
          <span className={styles.minutesUnit} aria-hidden="true">
            min
          </span>
        </div>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={`${fmtInt(MINUTES.step)} minutes more`}
          disabled={parsed !== null && parsed >= MINUTES.max}
          onClick={() => step(1)}
        >
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * @design C51 WorkoutForm — type picker (walking, futsal, badminton, gym, running, cycling,
 * swimming, other), duration stepper (±5 min, 5–300, typed), intensity easy / moderate / hard,
 * and the live estimate "~470 kcal added to this week". Controlled; the screen works out the
 * estimate (netWorkoutKcal with the latest weight) and saves.
 */
export function WorkoutForm({ value, onChange, estimateKcal, weekLabel = 'this week', estimateNote, showErrors, className }: WorkoutFormProps) {
  const typeLabelId = useId();
  const intensityLabelId = useId();
  const [left, setLeft] = useState(false);
  const error = showErrors || left ? minutesError(value.minutesText) : null;

  return (
    <div className={[styles.form, className].filter(Boolean).join(' ')}>
      <div className={styles.group}>
        <Label id={typeLabelId}>Activity</Label>
        <TypePicker value={value.type} labelId={typeLabelId} onChange={(type) => onChange({ ...value, type })} />
      </div>

      <Duration
        text={value.minutesText}
        error={error}
        onChange={(minutesText) => {
          setLeft(false);
          onChange({ ...value, minutesText });
        }}
        onLeave={() => setLeft(true)}
      />

      <div className={styles.group}>
        <Label id={intensityLabelId}>Intensity</Label>
        <IntensityPicker value={value.intensity} labelId={intensityLabelId} onChange={(intensity) => onChange({ ...value, intensity })} />
      </div>

      <div className={styles.estimate}>
        <p className={styles.estimateLine} aria-live="polite">
          {estimateKcal !== null ? (
            <>
              <b className={styles.estimateKcal}>{fmtApprox(estimateKcal)} kcal</b> added to {weekLabel}
            </>
          ) : (
            (estimateNote ?? 'Set the time to see the estimate.')
          )}
        </p>
        <p className={styles.helper}>{HELPER}</p>
      </div>
    </div>
  );
}
