import { useState, type CSSProperties, type ReactNode } from 'react';
import { OneOffBonus, type OneOffBonusValue } from '@/components/OneOffBonus/OneOffBonus';
import { WorkoutForm, type WorkoutFormProps } from '@/components/WorkoutForm/WorkoutForm';
import { parseMinutes, type WorkoutFormValue } from '@/components/WorkoutForm/workoutOptions';
import { fmtInt } from '@/domain/format';
import { netWorkoutKcal } from '@/domain/workout';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9.5): latest weigh-in 77.8 kg; last week's futsal, 60 min, moderate.
// ---------------------------------------------------------------------------

const WEIGHT_KG = 77.8;
const FUTSAL: WorkoutFormValue = { type: 'futsal', intensity: 'moderate', minutesText: '60' };
const NEW_USER: WorkoutFormValue = { type: 'walking', intensity: 'moderate', minutesText: '30' };
const BAD_TIME: WorkoutFormValue = { type: 'badminton', intensity: 'hard', minutesText: '2' };

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  log: { margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--muted)' } satisfies CSSProperties,
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 style={css.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={css.state}>
      <span style={css.caption}>{label}</span>
      {children}
    </div>
  );
}

/** A live form: the estimate follows the choices, as on S29. */
function LiveWorkoutForm({ initial, weightKg = WEIGHT_KG, ...rest }: { initial: WorkoutFormValue; weightKg?: number | null } & Partial<WorkoutFormProps>) {
  const [value, setValue] = useState(initial);
  const minutes = parseMinutes(value.minutesText);
  const estimate = minutes !== null && weightKg !== null ? netWorkoutKcal(value.type, value.intensity, minutes, weightKg) : null;
  return <WorkoutForm value={value} onChange={setValue} estimateKcal={estimate} {...rest} />;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function WorkoutFormStates() {
  return (
    <Group title="C51 WorkoutForm">
      <State label="C51 WorkoutForm / Futsal · 60 min · Moderate (~470 kcal this week)">
        <LiveWorkoutForm initial={FUTSAL} />
      </State>
      <State label="C51 WorkoutForm / First workout (walking, 30 min)">
        <LiveWorkoutForm initial={NEW_USER} />
      </State>
      <State label="C51 WorkoutForm / Yesterday on a Monday (added to last week)">
        <LiveWorkoutForm initial={FUTSAL} weekLabel="last week" />
      </State>
      <State label="C51 WorkoutForm / Time out of range (message shown)">
        <LiveWorkoutForm initial={BAD_TIME} showErrors />
      </State>
      <State label="C51 WorkoutForm / No weight to estimate from">
        <LiveWorkoutForm initial={FUTSAL} weightKg={null} estimateNote="Add a weigh-in first, so there is a weight to estimate from." />
      </State>
    </Group>
  );
}

function OneOffBonusStates() {
  const [log, setLog] = useState('Add a bonus to see what the screen would save.');
  const submit = (bonus: OneOffBonusValue) => setLog(`Saved: ${bonus.reason || 'One-off bonus'} · +${fmtInt(bonus.kcal)} kcal`);
  return (
    <Group title="C52 OneOffBonus">
      <State label="C52 OneOffBonus / Empty · today">
        <OneOffBonus onSubmit={submit} />
      </State>
      <State label="C52 OneOffBonus / Filled · A hike +300">
        <OneOffBonus onSubmit={submit} defaultKcal="300" defaultReason="A hike" />
      </State>
      <State label="C52 OneOffBonus / Missing amount (message)">
        <OneOffBonus onSubmit={submit} defaultReason="Futsal tournament" defaultTried />
      </State>
      <State label="C52 OneOffBonus / Too much for one day, long reason (messages)">
        <OneOffBonus onSubmit={submit} defaultKcal="5000" defaultReason="Hike up Bukit Gasing, then futsal, then badminton with the office" defaultTried />
      </State>
      <State label="C52 OneOffBonus / On another day this week (Tue)">
        <OneOffBonus onSubmit={submit} dayLabel="on Tue" defaultKcal="400" defaultReason="Futsal tournament" />
      </State>
      <State label="C52 OneOffBonus / Saving">
        <OneOffBonus onSubmit={submit} defaultKcal="300" defaultReason="A hike" busy />
      </State>
      <State label="C52 OneOffBonus / Event log">
        <p style={css.log} aria-live="polite">
          {log}
        </p>
      </State>
    </Group>
  );
}

/** Gallery section for the Activity components (C51, C52). */
export function ActivityGallery() {
  return (
    <section style={css.section} aria-labelledby="activity-gallery-title">
      <h2 id="activity-gallery-title" style={css.sectionTitle}>
        Activity
      </h2>
      <WorkoutFormStates />
      <OneOffBonusStates />
    </section>
  );
}
