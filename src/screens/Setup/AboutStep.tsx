import { useId, useRef, useState } from 'react';
import { SetupStep } from '@/components/SetupStep/SetupStep';
import { ChipGroup } from '@/components/ui/Chip';
import type { Sex } from '@/domain/types';
import type { StepProps } from './draft';
import { fieldError, type BodyField } from './fields';
import { NumberField } from './NumberField';
import styles from './Setup.module.css';

export const SEX_OPTIONS: readonly { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

type Touched = Partial<Record<BodyField | 'sex', boolean>>;

/** S02 About you: age, sex, height ("An estimate is fine") and today's weight. */
export function AboutStep({ step, total, draft, update, onNext, onBack }: StepProps) {
  const sexErrorId = useId();
  const [touched, setTouched] = useState<Touched>({});
  const [tried, setTried] = useState(false);
  const refs = {
    age: useRef<HTMLInputElement>(null),
    heightCm: useRef<HTMLInputElement>(null),
    weightKg: useRef<HTMLInputElement>(null),
  };

  const errors = {
    age: fieldError('age', draft.age),
    sex: draft.sex ? null : 'Pick one',
    heightCm: fieldError('heightCm', draft.heightCm),
    weightKg: fieldError('weightKg', draft.weightKg),
  };
  const shown = (field: keyof typeof errors) => (tried || touched[field] ? errors[field] : null);
  const touch = (field: keyof Touched) => () => setTouched((t) => ({ ...t, [field]: true }));

  const next = () => {
    if (errors.age || errors.sex || errors.heightCm || errors.weightKg) {
      setTried(true);
      const firstInput = (['age', 'heightCm', 'weightKg'] as const).find((f) => errors[f]);
      if (firstInput) refs[firstInput].current?.focus();
      return;
    }
    onNext();
  };

  const sexError = shown('sex');

  return (
    <SetupStep
      step={step}
      total={total}
      title="About you"
      helper="For your starting estimate. Body stats are never sent with your meals."
      onNext={next}
      onBack={onBack}
    >
      <div className={styles.stack}>
        <NumberField
          ref={refs.age}
          label="Age"
          unit="years"
          value={draft.age}
          onChange={(age) => update({ age })}
          onBlur={touch('age')}
          error={shown('age')}
        />
        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden="true">
            Sex
          </span>
          <div aria-describedby={sexError ? sexErrorId : undefined}>
            <ChipGroup
              kind="choice"
              stretch
              label="Sex"
              options={SEX_OPTIONS}
              selectedIndex={SEX_OPTIONS.findIndex((o) => o.value === draft.sex)}
              getLabel={(o) => o.label}
              onSelect={(i) => {
                const option = SEX_OPTIONS[i];
                if (option) update({ sex: option.value });
                touch('sex')();
              }}
            />
          </div>
          {sexError ? (
            <p id={sexErrorId} className={styles.fieldError}>
              {sexError}
            </p>
          ) : null}
        </div>
        <NumberField
          ref={refs.heightCm}
          label="Height"
          unit="cm"
          decimal
          hint="An estimate is fine. 5 cm off is about 30 kcal a day."
          value={draft.heightCm}
          onChange={(heightCm) => update({ heightCm })}
          onBlur={touch('heightCm')}
          error={shown('heightCm')}
        />
        <NumberField
          ref={refs.weightKg}
          label="Today's weight"
          unit="kg"
          decimal
          value={draft.weightKg}
          onChange={(weightKg) => update({ weightKg })}
          onBlur={touch('weightKg')}
          error={shown('weightKg')}
        />
      </div>
    </SetupStep>
  );
}
