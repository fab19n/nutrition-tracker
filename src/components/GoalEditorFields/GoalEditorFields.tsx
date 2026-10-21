import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import {
  GOAL_NAME_MAX,
  OCCASIONS_LIMIT,
  PROTEIN_LIMIT,
  PROTEIN_STEP,
  RANGE_CHOICES,
  SLEEP_GAP_LIMIT,
  TARGET_KCAL_MAX,
  TARGET_KCAL_STEP,
  WINDOW_HOURS_LIMIT,
  type GoalDraftErrors,
  type GoalDraftField,
} from '@/domain/goals';
import { fmtInt } from '@/domain/format';
import type { GoalTemplate, HeroMetric, InsightGroup, LogicalDay } from '@/domain/types';
import styles from './GoalEditorFields.module.css';

/** The form behind S42 and S43, as the user edits it (numbers typed as text stay text). */
export interface GoalEditorValue {
  name: string;
  /** Custom only: 'kcalLeft' | 'proteinLeft'. */
  heroMetric: HeroMetric;
  dailyKcal: number;
  proteinG: number;
  paceKgPerWeek: number;
  rangePct: number;
  windowHours: number;
  /** Custom: the same hours every day, "10:00" and "20:00". */
  fixedWindow: { on: boolean; start: string; end: string };
  sleepGap: { on: boolean; hours: number };
  grazing: { on: boolean; occasions: number };
  insightsOff: InsightGroup[];
  end: { kind: 'none' | 'date' | 'weight'; date: string; weightKg: string };
}

export interface GoalEditorFieldsProps {
  template: GoalTemplate;
  value: GoalEditorValue;
  onChange: (next: GoalEditorValue) => void;
  /** Cut / Custom pace chips: the screen sets the pace and the worked-out target. */
  onSelectPace: (paceKgPerWeek: number) => void;
  paceOptions: readonly number[];
  /** The daily minimum: the lowest target the stepper goes to. */
  kcalMin: number;
  hints: { target?: string; macros?: string; starts?: string; range?: string; end?: string };
  /** False for a hold pace (no direction to reach a weight in). */
  allowWeightEnd: boolean;
  endDateMin: LogicalDay;
  endDateMax: LogicalDay;
  errors?: GoalDraftErrors;
  /**
   * A screen bumps this each time Save finds errors: the first invalid field is scrolled into
   * view and focused, so a field off-screen isn't a Save that does nothing.
   */
  focusSeq?: number;
  /** Pause: say that the length is picked when switching (a goal not switched to yet). */
  switchNote?: boolean;
}

/** The order the fields sit on screen: the first one with an error gets the focus. */
const FIELD_ORDER: readonly GoalDraftField[] = ['name', 'dailyKcal', 'proteinG', 'timing', 'end'];

const INSIGHT_TOGGLES: readonly { group: InsightGroup; label: string; sub: string }[] = [
  { group: 'food', label: 'Food and budget', sub: 'Categories, Places, recurring calories, budget result' },
  { group: 'protein', label: 'Protein', sub: 'Days you reached your protein target' },
  { group: 'timing', label: 'Meal timing', sub: 'Eating window, first meal, grazing, late eating' },
  { group: 'weight', label: 'Weight trend', sub: 'Your trend against your pace' },
];

const MAIN_NUMBERS: readonly { metric: HeroMetric; label: string }[] = [
  { metric: 'kcalLeft', label: 'Kcal left' },
  { metric: 'proteinLeft', label: 'Protein left' },
];

const END_KINDS: readonly { kind: GoalEditorValue['end']['kind']; label: string }[] = [
  { kind: 'none', label: 'No end' },
  { kind: 'date', label: 'By a date' },
  { kind: 'weight', label: 'At a weight' },
];

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function paceLabel(pace: number): string {
  return pace === 0 ? 'Hold' : `${pace} kg`;
}

function rangeLabel(pct: number): string {
  return `± ${Math.round(pct * 100)}%`;
}

interface StepperRowProps {
  label: string;
  sub?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** The row takes the focus when its value is the one to fix; `errorId` is the message under it. */
  field?: GoalDraftField;
  errorId?: string;
}

/** − value + row with the look of the Setup stepper (S04, S19). The value is announced as it changes. */
function StepperRow({ label, sub, value, onChange, min, max, step, unit, field, errorId }: StepperRowProps) {
  return (
    <div
      className={styles.stepper}
      role="group"
      aria-label={label}
      data-field={field}
      tabIndex={field ? -1 : undefined}
      aria-describedby={errorId}
    >
      <div className={styles.stepperText}>
        <span className={styles.stepperLabel}>{label}</span>
        {sub ? <span className={styles.stepperSub}>{sub}</span> : null}
      </div>
      <div className={styles.stepperControls}>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`Lower ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <output className={styles.stepperValue} aria-live="polite">
          {fmtInt(value)}
          <span className={styles.stepperUnit}> {unit}</span>
        </output>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`Raise ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** A labelled row of choice chips inside a card. */
function ChoiceRow<T>({
  label,
  kind = 'portion',
  options,
  selectedIndex,
  getLabel,
  onSelect,
  caption,
}: {
  label: string;
  kind?: 'portion' | 'choice';
  options: readonly T[];
  selectedIndex: number;
  getLabel: (option: T) => ReactNode;
  onSelect: (index: number) => void;
  caption?: string;
}) {
  return (
    <div className={[styles.choiceRow, kind === 'choice' ? styles.choiceOnCard : ''].filter(Boolean).join(' ')}>
      <span className={styles.rowLabel} aria-hidden="true">
        {label}
      </span>
      <ChipGroup
        kind={kind}
        label={label}
        options={options}
        selectedIndex={selectedIndex}
        getLabel={getLabel}
        onSelect={onSelect}
        stretch={kind === 'choice'}
      />
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </div>
  );
}

function TimeRow({
  label,
  value,
  onChange,
  field,
  errorId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  field?: GoalDraftField;
  errorId?: string;
}) {
  const id = useId();
  return (
    <div className={styles.timeRow}>
      <label htmlFor={id} className={styles.timeLabel}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className={styles.time}
        data-field={field}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
      />
    </div>
  );
}

/**
 * Everything a goal can set (S42 edit, S43 new): name, target and protein steppers, pace or
 * range, timing rules with their values, insight toggles and an end condition. Controlled:
 * the screen keeps the value and works out the hints.
 * @design C48 GoalEditorFields
 */
export function GoalEditorFields({
  template,
  value,
  onChange,
  onSelectPace,
  paceOptions,
  kcalMin,
  hints,
  allowWeightEnd,
  endDateMin,
  endDateMax,
  errors = {},
  focusSeq,
  switchNote = false,
}: GoalEditorFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nameId = useId();
  const nameErrorId = useId();
  const kcalErrorId = useId();
  const proteinErrorId = useId();
  const timingErrorId = useId();
  const endErrorId = useId();
  const set = (patch: Partial<GoalEditorValue>) => onChange({ ...value, ...patch });
  const pause = template === 'pause';
  const custom = template === 'custom';
  const paced = template === 'cut' || template === 'custom';
  const fixedHours = custom && value.fixedWindow.on;
  const ends = END_KINDS.filter((e) => e.kind !== 'weight' || allowWeightEnd);
  const endInvalid = errors.end !== undefined;

  // Save found errors: take the user to the first one, whatever is on screen. Only a new Save
  // attempt moves the focus, not every edit of the errors.
  useEffect(() => {
    if (!focusSeq) return;
    const field = FIELD_ORDER.find((f) => errors[f] !== undefined);
    const target = field ? rootRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`) : null;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center' });
  }, [focusSeq]);

  return (
    <div ref={rootRef} className={styles.fields}>
      <SectionHeading>
        <label htmlFor={nameId}>Name</label>
      </SectionHeading>
      <div className={styles.block}>
        <div className={[styles.inputWrap, errors.name ? styles.invalid : ''].filter(Boolean).join(' ')}>
          <input
            id={nameId}
            className={styles.input}
            data-field="name"
            value={value.name}
            maxLength={GOAL_NAME_MAX}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? nameErrorId : undefined}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        {errors.name ? (
          <p id={nameErrorId} role="alert" className={styles.error}>
            {errors.name}
          </p>
        ) : null}
      </div>

      {pause ? (
        <Card radius="card" padding="14px 16px" className={styles.pauseCard}>
          Budget off. Logging is optional, and these days stay out of trends.{switchNote ? ' You pick how long when you switch.' : ''}
        </Card>
      ) : (
        <>
          <SectionHeading>Target</SectionHeading>
          <Card radius="card" padding="4px 16px" className={styles.targetCard}>
            {custom ? (
              <ChoiceRow
                label="Main number"
                kind="choice"
                options={MAIN_NUMBERS}
                selectedIndex={MAIN_NUMBERS.findIndex((m) => m.metric === value.heroMetric)}
                getLabel={(m) => m.label}
                onSelect={(i) => {
                  const metric = MAIN_NUMBERS[i]?.metric;
                  if (metric) set({ heroMetric: metric });
                }}
              />
            ) : null}
            <StepperRow
              label="Daily target"
              sub={hints.target}
              value={value.dailyKcal}
              onChange={(dailyKcal) => set({ dailyKcal })}
              min={kcalMin}
              max={TARGET_KCAL_MAX}
              step={TARGET_KCAL_STEP}
              unit="kcal"
              field="dailyKcal"
              errorId={errors.dailyKcal ? kcalErrorId : undefined}
            />
            {paced ? (
              <ChoiceRow
                label="Pace, per week"
                options={paceOptions}
                selectedIndex={paceOptions.findIndex((p) => sameNumber(p, value.paceKgPerWeek))}
                getLabel={paceLabel}
                onSelect={(i) => {
                  const pace = paceOptions[i];
                  if (pace !== undefined) onSelectPace(pace);
                }}
              />
            ) : null}
            {template === 'festive' ? (
              <ChoiceRow
                label="Range"
                options={RANGE_CHOICES}
                selectedIndex={RANGE_CHOICES.findIndex((r) => sameNumber(r, value.rangePct))}
                getLabel={rangeLabel}
                onSelect={(i) => {
                  const rangePct = RANGE_CHOICES[i];
                  if (rangePct !== undefined) set({ rangePct });
                }}
                caption={hints.range}
              />
            ) : null}
            <StepperRow
              label="Protein"
              sub={hints.macros}
              value={value.proteinG}
              onChange={(proteinG) => set({ proteinG })}
              min={PROTEIN_LIMIT.min}
              max={PROTEIN_LIMIT.max}
              step={PROTEIN_STEP}
              unit="g"
              field="proteinG"
              errorId={errors.proteinG ? proteinErrorId : undefined}
            />
          </Card>
          {errors.dailyKcal ? (
            <p id={kcalErrorId} role="alert" className={[styles.error, styles.outside].join(' ')}>
              {errors.dailyKcal}
            </p>
          ) : null}
          {errors.proteinG ? (
            <p id={proteinErrorId} role="alert" className={[styles.error, styles.outside].join(' ')}>
              {errors.proteinG}
            </p>
          ) : null}
          {hints.starts ? <p className={styles.note}>{hints.starts}</p> : null}

          <SettingsGroup title="Timing">
            {custom ? (
              <SettingsRow
                label="Fixed hours"
                sub="Same hours every day"
                toggle={{ checked: value.fixedWindow.on, onChange: (on) => set({ fixedWindow: { ...value.fixedWindow, on } }) }}
              />
            ) : null}
            {fixedHours ? (
              <div className={styles.times}>
                <TimeRow
                  label="Opens"
                  value={value.fixedWindow.start}
                  onChange={(start) => set({ fixedWindow: { ...value.fixedWindow, start } })}
                  field="timing"
                  errorId={errors.timing ? timingErrorId : undefined}
                />
                <TimeRow
                  label="Closes"
                  value={value.fixedWindow.end}
                  onChange={(end) => set({ fixedWindow: { ...value.fixedWindow, end } })}
                  errorId={errors.timing ? timingErrorId : undefined}
                />
              </div>
            ) : (
              <StepperRow
                label="Eating window"
                sub="From your first meal"
                value={value.windowHours}
                onChange={(windowHours) => set({ windowHours })}
                min={WINDOW_HOURS_LIMIT.min}
                max={WINDOW_HOURS_LIMIT.max}
                step={1}
                unit="h"
              />
            )}
            <SettingsRow
              label="Last meal before sleep"
              sub="On days you tap Going to sleep"
              toggle={{ checked: value.sleepGap.on, onChange: (on) => set({ sleepGap: { ...value.sleepGap, on } }) }}
            />
            {value.sleepGap.on ? (
              <StepperRow
                label="Hours before sleep"
                value={value.sleepGap.hours}
                onChange={(hours) => set({ sleepGap: { ...value.sleepGap, hours } })}
                min={SLEEP_GAP_LIMIT.min}
                max={SLEEP_GAP_LIMIT.max}
                step={1}
                unit="h"
              />
            ) : null}
            <SettingsRow
              label="Flag grazing"
              sub={`More than ${fmtInt(value.grazing.occasions)} eating occasions a day`}
              toggle={{ checked: value.grazing.on, onChange: (on) => set({ grazing: { ...value.grazing, on } }) }}
            />
            {value.grazing.on ? (
              <StepperRow
                label="Eating occasions"
                value={value.grazing.occasions}
                onChange={(occasions) => set({ grazing: { ...value.grazing, occasions } })}
                min={OCCASIONS_LIMIT.min}
                max={OCCASIONS_LIMIT.max}
                step={1}
                unit="a day"
              />
            ) : null}
          </SettingsGroup>
          {errors.timing ? (
            <p id={timingErrorId} role="alert" className={[styles.error, styles.outside].join(' ')}>
              {errors.timing}
            </p>
          ) : null}

          <SettingsGroup title="Insights">
            {INSIGHT_TOGGLES.map((t) => (
              <SettingsRow
                key={t.group}
                label={t.label}
                sub={t.sub}
                toggle={{
                  checked: !value.insightsOff.includes(t.group),
                  onChange: (on) =>
                    set({ insightsOff: on ? value.insightsOff.filter((g) => g !== t.group) : [...value.insightsOff.filter((g) => g !== t.group), t.group] }),
                }}
              />
            ))}
          </SettingsGroup>

          <SectionHeading>End</SectionHeading>
          <div className={[styles.block, styles.choiceChips].join(' ')}>
            <ChipGroup
              kind="choice"
              label="End"
              options={ends}
              selectedIndex={ends.findIndex((e) => e.kind === value.end.kind)}
              getLabel={(e) => e.label}
              onSelect={(i) => {
                const kind = ends[i]?.kind;
                if (kind) set({ end: { ...value.end, kind } });
              }}
            />
            {value.end.kind === 'date' ? (
              <div className={[styles.inputWrap, endInvalid ? styles.invalid : ''].filter(Boolean).join(' ')}>
                <input
                  type="date"
                  aria-label="End date"
                  className={styles.input}
                  data-field="end"
                  value={value.end.date}
                  min={endDateMin}
                  max={endDateMax}
                  aria-invalid={endInvalid ? true : undefined}
                  aria-describedby={endInvalid ? endErrorId : undefined}
                  onChange={(e) => set({ end: { ...value.end, date: e.target.value } })}
                />
              </div>
            ) : null}
            {value.end.kind === 'weight' ? (
              <div className={[styles.inputWrap, endInvalid ? styles.invalid : ''].filter(Boolean).join(' ')}>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="End weight"
                  autoComplete="off"
                  className={styles.input}
                  data-field="end"
                  value={value.end.weightKg}
                  aria-invalid={endInvalid ? true : undefined}
                  aria-describedby={endInvalid ? endErrorId : undefined}
                  onChange={(e) => set({ end: { ...value.end, weightKg: e.target.value } })}
                />
                <span className={styles.unit}>kg</span>
              </div>
            ) : null}
            {hints.end ? <p className={styles.hint}>{hints.end}</p> : null}
            {errors.end ? (
              <p id={endErrorId} role="alert" className={styles.error}>
                {errors.end}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
