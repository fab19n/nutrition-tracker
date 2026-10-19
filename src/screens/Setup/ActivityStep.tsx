import { SetupStep } from '@/components/SetupStep/SetupStep';
import { OptionGroup, type OptionItem } from '@/components/OptionRow/OptionRow';
import type { ActivityLevel } from '@/domain/types';
import type { StepProps } from './draft';

export const ACTIVITY_OPTIONS: readonly (OptionItem & { id: ActivityLevel })[] = [
  { id: 'sedentary', label: 'WFH, mostly sitting', sub: 'Desk work and a few short walks' },
  { id: 'light', label: 'On your feet a fair bit', sub: 'Errands, chores, walking around' },
  { id: 'active', label: 'Very active', sub: 'On your feet most of the day, or a physical job' },
];

function isActivity(id: string): id is ActivityLevel {
  return ACTIVITY_OPTIONS.some((o) => o.id === id);
}

/** S03 Your activity, on a day without workouts. */
export function ActivityStep({ step, total, draft, update, onNext, onBack }: StepProps) {
  return (
    <SetupStep
      step={step}
      total={total}
      title="On a day without workouts, you're mostly…"
      helper="Workouts are added separately, on the days you do them."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={!draft.activity}
    >
      <OptionGroup
        label="Activity on a day without workouts"
        size="lg"
        options={ACTIVITY_OPTIONS}
        value={draft.activity ?? undefined}
        onChange={(id) => {
          if (isActivity(id)) update({ activity: id });
        }}
      />
    </SetupStep>
  );
}
