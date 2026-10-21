import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { GoalEditorFields, type GoalEditorValue } from '@/components/GoalEditorFields/GoalEditorFields';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { createGoal, useNewGoalDefaults, type NewGoalDefaults } from '@/db/goals';
import { NEW_GOAL_TEMPLATES } from '@/db/seed/defaults';
import { addDays } from '@/domain/day';
import {
  CUSTOM_PACE_CHOICES,
  END_DATE_MAX_DAYS,
  GoalDraftError,
  PACE_CHOICES,
  goalDraftFor,
  uniqueGoalName,
  validateGoalDraft,
  type GoalDraftErrors,
} from '@/domain/goals';
import type { GoalTemplate } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import {
  GOAL_ERRORS,
  TEMPLATE_INFO,
  createToast,
  draftFromForm,
  endHint,
  formEndState,
  formFromDraft,
  macrosNote,
  rangeLine,
  targetWorking,
  templateDescription,
  withPace,
} from './goalsModel';
import styles from './Goals.module.css';

function templateOf(param: string | null): GoalTemplate {
  return NEW_GOAL_TEMPLATES.find((t) => t === param) ?? 'cut';
}

/** The template's defaults, with a name not taken yet ("Festive maintain 2"). */
function sourceFor(template: GoalTemplate, defaults: NewGoalDefaults): GoalEditorValue {
  return formFromDraft(
    goalDraftFor(template, {
      name: uniqueGoalName(TEMPLATE_INFO[template].label, defaults.takenNames),
      maintenanceKcal: defaults.maintenanceKcal,
      weightKg: defaults.weightKg,
      dailyMinimumKcal: defaults.dailyMinimumKcal,
    }),
  );
}

function NewGoalForm({ defaults, template, onTemplate }: { defaults: NewGoalDefaults; template: GoalTemplate; onTemplate: (t: GoalTemplate) => void }) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const [edit, setEdit] = useState<GoalEditorValue | null>(null);
  const [errors, setErrors] = useState<GoalDraftErrors>({});
  // Bumped when Save finds errors, so the form takes the user to the first one.
  const [focusSeq, setFocusSeq] = useState(0);
  const { today, maintenanceKcal, dailyMinimumKcal } = defaults;

  const source = sourceFor(template, defaults);
  const value = edit ?? source;

  const change = (next: GoalEditorValue) => {
    setEdit(next);
    setErrors({});
  };

  const showErrors = (found: GoalDraftErrors) => {
    setErrors(found);
    setFocusSeq((n) => n + 1);
  };

  // A new template starts from its own defaults, but a name the user typed stays.
  const pickTemplate = (next: GoalTemplate) => {
    if (next === template) return;
    const typed = edit && edit.name !== source.name ? edit.name : undefined;
    setEdit(typed !== undefined ? { ...sourceFor(next, defaults), name: typed } : null);
    setErrors({});
    onTemplate(next);
  };

  const save = () =>
    inFlight.run('save', async () => {
      const draft = draftFromForm(value, template);
      const found = validateGoalDraft(draft, {
        today,
        dailyMinimumKcal,
        kcalChanged: true,
        endChanged: true,
        ...(defaults.trendKg !== undefined ? { trendKg: defaults.trendKg } : {}),
      });
      if (Object.keys(found).length > 0) {
        showErrors(found);
        return;
      }
      try {
        const { goal, undo } = await createGoal(draft);
        showToast(createToast(goal), () => void undo());
        navigate(PATHS.goal(goal.id), { replace: true });
      } catch (error) {
        if (error instanceof GoalDraftError) showErrors(error.errors);
        else showToast(GOAL_ERRORS.save);
      }
    });

  const formEnd = formEndState(value, { today, paceKgPerWeek: value.paceKgPerWeek, ...(defaults.trendKg !== undefined ? { trendKg: defaults.trendKg } : {}) });
  const selected = NEW_GOAL_TEMPLATES.indexOf(template);

  return (
    <>
      <SectionHeading>Start from</SectionHeading>
      <div className={styles.templates}>
        <ChipGroup
          kind="choice"
          label="Template"
          options={NEW_GOAL_TEMPLATES}
          selectedIndex={selected}
          getLabel={(t) => TEMPLATE_INFO[t].label}
          onSelect={(i) => {
            const next = NEW_GOAL_TEMPLATES[i];
            if (next) pickTemplate(next);
          }}
        />
      </div>
      <p className={styles.description}>{templateDescription(template)}</p>

      <GoalEditorFields
        template={template}
        value={value}
        onChange={change}
        onSelectPace={(pace) => change(withPace(value, pace, { template, maintenanceKcal, dailyMinimumKcal }))}
        paceOptions={template === 'custom' ? CUSTOM_PACE_CHOICES : PACE_CHOICES}
        kcalMin={dailyMinimumKcal}
        hints={{
          target: targetWorking({
            template,
            dailyKcal: value.dailyKcal,
            maintenanceKcal,
            paceKgPerWeek: value.paceKgPerWeek,
            rangePct: value.rangePct,
            dailyMinimumKcal,
          }),
          macros: macrosNote(value.dailyKcal, value.proteinG),
          ...(template === 'festive' ? { range: rangeLine(value.dailyKcal, value.rangePct) } : {}),
          ...(formEnd ? { end: endHint(formEnd) } : {}),
        }}
        allowWeightEnd={value.paceKgPerWeek !== 0}
        endDateMin={addDays(today, 1)}
        endDateMax={addDays(today, END_DATE_MAX_DAYS)}
        errors={errors}
        focusSeq={focusSeq}
      />

      <div className={styles.stickyFooter}>
        <Button size="lg" disabled={inFlight.busy('save')} onClick={() => void save()}>
          Save goal
        </Button>
        <p className={styles.footerCaption}>It won&apos;t change anything until you switch to it.</p>
      </div>
    </>
  );
}

/** @design S43 New goal from template — pick a template, adjust its fields, Save goal (it starts only when you switch to it). */
export default function NewGoalScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const defaults = useNewGoalDefaults();
  const template = templateOf(params.get('template'));

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.goals, { replace: true }));

  return (
    <div className={[styles.screen, styles.withFooter].join(' ')}>
      <SubScreenHeader title="New goal" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to Goals'} />
      {defaults ? (
        <NewGoalForm defaults={defaults} template={template} onTemplate={(t) => setParams({ template: t }, { replace: true })} />
      ) : (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading the goal" />
        </div>
      )}
    </div>
  );
}
