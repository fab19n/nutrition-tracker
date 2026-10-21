import { useState, type CSSProperties, type ReactNode } from 'react';
import { GoalCard } from '@/components/GoalCard/GoalCard';
import { GoalEditorFields, type GoalEditorValue } from '@/components/GoalEditorFields/GoalEditorFields';
import { GoalSwitchPanel, type PauseUntilChoice } from '@/components/GoalSwitchSheet/GoalSwitchSheet';
import { CUSTOM_PACE_CHOICES, PACE_CHOICES, goalDraftFor } from '@/domain/goals';
import type { GoalTemplate } from '@/domain/types';
import { formFromDraft, macrosNote, rangeLine, targetWorking, withPace } from '@/screens/Goals/goalsModel';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md S41–S44): the demo Friday, Cut in week 3 at 1,800 a day,
// maintenance ~2,350, trend 78.0 kg. Form values and hints come from the real model.
// ---------------------------------------------------------------------------

const MAINTENANCE = 2350;
const MINIMUM = 1400;
const noop = () => {};

function sampleForm(template: GoalTemplate, name: string): GoalEditorValue {
  return formFromDraft(goalDraftFor(template, { name, maintenanceKcal: MAINTENANCE, weightKg: 77.99, dailyMinimumKcal: MINIMUM }));
}

function hintsFor(template: GoalTemplate, value: GoalEditorValue) {
  return {
    target: targetWorking({
      template,
      dailyKcal: value.dailyKcal,
      maintenanceKcal: MAINTENANCE,
      paceKgPerWeek: value.paceKgPerWeek,
      rangePct: value.rangePct,
      dailyMinimumKcal: MINIMUM,
    }),
    macros: macrosNote(value.dailyKcal, value.proteinG),
    ...(template === 'festive' ? { range: rangeLine(value.dailyKcal, value.rangePct) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  wide: { padding: '6px 0 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  sheet: { padding: '16px', borderRadius: 'var(--r-sheet)', background: 'var(--bg)', boxShadow: 'var(--shadow)' } satisfies CSSProperties,
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 style={css.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}

function State({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure style={{ ...(wide ? css.wide : css.state), margin: 0 }}>
      <figcaption style={wide ? { ...css.caption, padding: '0 20px 6px' } : css.caption}>{label}</figcaption>
      {children}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function GoalCardStates() {
  return (
    <Group title="C46 GoalCard">
      <State label="C46 GoalCard / Active (Cut · week 3)">
        <GoalCard status="active" label="Active goal · week 3" title="Cut · 1,800 a day" detail="−0.5 kg a week · protein 110g · min 1,400" onOpen={noop} />
      </State>
      <State label="C46 GoalCard / Active with saved goals (S48)">
        <GoalCard
          status="active"
          headingLevel={2}
          label="Active goal · week 3"
          title="Cut · 1,800 a day"
          detail="−0.5 kg a week · protein 110g · min 1,400"
          chips={['Festive maintain · Saved', 'Lean bulk · Draft']}
        />
      </State>
      <State label="C46 GoalCard / Next · starts Sat (Keep Cut instead)">
        <GoalCard
          status="next"
          label="Next · from tomorrow (Sat)"
          title="Festive maintain"
          detail="2,100 a day · in range 1,890–2,310"
          badge="Starts Sat"
          onOpen={noop}
          action={{ label: 'Keep Cut instead', onPress: noop }}
        />
      </State>
      <State label="C46 GoalCard / Saved">
        <GoalCard status="saved" title="Festive maintain" detail="2,100 a day · in range 1,890–2,310" onOpen={noop} />
      </State>
      <State label="C46 GoalCard / Draft">
        <GoalCard status="draft" title="Lean bulk" detail="2,300 a day · protein 130g" onOpen={noop} />
      </State>
      <State label="C46 GoalCard / Template (dashed)">
        <GoalCard
          status="template"
          title="Pause"
          detail="Budget off for travel or sick days. Logging is optional."
          badge="Template"
          onOpen={noop}
          openLabel="New goal from Pause"
        />
      </State>
      <State label="C46 GoalCard / Ended">
        <GoalCard status="ended" label="Festive maintain" title="Raya maintain" detail="Used Thu 1 Oct to Sun 4 Oct" onOpen={noop} />
      </State>
    </Group>
  );
}

function SwitchSheetStates() {
  const [until, setUntil] = useState<PauseUntilChoice>('monday');
  const [date, setDate] = useState('2026-10-24');
  const lines: Record<PauseUntilChoice, string> = {
    monday: 'Cut starts again on Mon 19 Oct.',
    date: 'Cut starts again on the day you pick.',
    open: 'Runs until you switch to another goal.',
  };
  return (
    <Group title="C47 GoalSwitchSheet">
      <State label="C47 GoalSwitchSheet / Festive maintain">
        <div style={css.sheet}>
          <GoalSwitchPanel
            goalName="Festive maintain"
            startsLine="Starts tomorrow (Sat). Past days keep the goal they had."
            week={{ lead: 'This week: 5 days at 1,800 + 2 days at 2,100 = ', total: '13,200 kcal' }}
            changes={['Main number becomes days in range (2,100 ± 10%).', 'Timing: 14-hour eating window, more than 6 eating occasions flagged.']}
            confirmLabel="Switch from tomorrow"
            onConfirm={noop}
            onCancel={noop}
          />
        </div>
      </State>
      <State label="C47 GoalSwitchSheet / Pause until Mon">
        <div style={css.sheet}>
          <GoalSwitchPanel
            goalName="Pause"
            startsLine="Starts tomorrow (Sat). Past days keep the goal they had."
            week={{ lead: 'This week: 5 days at 1,800 = ', total: '9,000 kcal', tail: '. Sat and Sun: budget off.' }}
            changes={['Budget off. Logging is optional, and these days stay out of trends.']}
            until={{
              options: [
                { id: 'monday', label: 'Mon 19 Oct' },
                { id: 'date', label: 'Pick a date' },
                { id: 'open', label: 'Until I switch back' },
              ],
              selected: until,
              onSelect: setUntil,
              date,
              minDate: '2026-10-18',
              maxDate: '2026-12-16',
              onDate: setDate,
              line: lines[until],
            }}
            confirmLabel="Switch from tomorrow"
            onConfirm={noop}
            onCancel={noop}
          />
        </div>
      </State>
      <State label="C47 GoalSwitchSheet / After a booking, at 1:30am">
        <div style={css.sheet}>
          <GoalSwitchPanel
            goalName="Lean bulk"
            startsLine="Starts at 5am (Sat). Past days keep the goal they had."
            week={{ lead: 'This week: 5 days at 1,800 + 2 days at 2,300 = ', total: '13,600 kcal' }}
            changes={['Main number becomes protein left, 130g.', 'Timing: 14-hour eating window, more than 6 eating occasions flagged.']}
            replaces="This replaces Festive maintain from Sat."
            confirmLabel="Switch from 5am"
            busy
            onConfirm={noop}
            onCancel={noop}
          />
        </div>
      </State>
    </Group>
  );
}

function EditorState({ template, name, label, initial }: { template: GoalTemplate; name: string; label: string; initial?: Partial<GoalEditorValue> }) {
  const [value, setValue] = useState<GoalEditorValue>(() => ({ ...sampleForm(template, name), ...initial }));
  return (
    <State label={label} wide>
      <GoalEditorFields
        template={template}
        value={value}
        onChange={setValue}
        onSelectPace={(pace) => setValue(withPace(value, pace, { template, maintenanceKcal: MAINTENANCE, dailyMinimumKcal: MINIMUM }))}
        paceOptions={template === 'custom' ? CUSTOM_PACE_CHOICES : PACE_CHOICES}
        kcalMin={MINIMUM}
        hints={hintsFor(template, value)}
        allowWeightEnd={value.paceKgPerWeek !== 0}
        endDateMin="2026-10-17"
        endDateMax="2028-10-15"
      />
    </State>
  );
}

function EditorStates() {
  return (
    <Group title="C48 GoalEditorFields">
      <EditorState template="cut" name="Cut" label="C48 GoalEditorFields / Cut" />
      <EditorState template="festive" name="Festive maintain" label="C48 GoalEditorFields / Festive maintain" />
      <EditorState template="pause" name="Pause" label="C48 GoalEditorFields / Pause" />
      <EditorState
        template="custom"
        name="Custom"
        label="C48 GoalEditorFields / Custom with fixed hours"
        initial={{ heroMetric: 'proteinLeft', fixedWindow: { on: true, start: '10:00', end: '20:00' } }}
      />
    </Group>
  );
}

/** /dev section: Goals components (C46–C48) in every state, with the demo's goals. */
export function GoalsGallery() {
  return (
    <section style={css.section} aria-labelledby="goals-gallery-title">
      <h2 id="goals-gallery-title" style={css.sectionTitle}>
        Goals
      </h2>
      <GoalCardStates />
      <SwitchSheetStates />
      <EditorStates />
    </section>
  );
}
