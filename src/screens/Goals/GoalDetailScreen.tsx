import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { CircleCheck, Clock, SearchX } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { GoalEditorFields, type GoalEditorValue } from '@/components/GoalEditorFields/GoalEditorFields';
import { GoalSwitchSheet, type PauseUntilChoice } from '@/components/GoalSwitchSheet/GoalSwitchSheet';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { SectionHeading } from '@/components/ui/SectionHeading';
import {
  archiveGoal,
  cancelGoalSwitch,
  restoreGoal,
  saveGoalEdits,
  switchGoal,
  useGoalDetail,
  useSwitchPreview,
  type GoalDetail,
} from '@/db/goals';
import { useNow } from '@/db/hooks';
import { addDays, daysBetween } from '@/domain/day';
import {
  END_DATE_MAX_DAYS,
  CUSTOM_PACE_CHOICES,
  GoalChangedError,
  GoalDraftError,
  PACE_CHOICES,
  sameEndCondition,
  validateGoalDraft,
  type GoalDraftErrors,
} from '@/domain/goals';
import { fmtDayShort, fmtWeekday } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { historyRows, startsWhen } from '@/screens/Insights/targetModel';
import { GoalEndNote, maintainPath } from './GoalEndNote';
import {
  GOAL_ERRORS,
  archiveToast,
  cancelToast,
  draftFromForm,
  formEndState,
  formFromGoal,
  endHint,
  macrosNote,
  pausePickDefault,
  rangeLine,
  restoreToast,
  sameForm,
  saveToast,
  startsNote,
  statusCard,
  switchSheetModel,
  switchToast,
  targetFieldsChanged,
  targetWorking,
  usageLine,
  withPace,
} from './goalsModel';
import styles from './Goals.module.css';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof GoalChangedError ? GOAL_ERRORS.changed : fallback;
}

/** The pill beside the title: what the goal is to today. */
function rolePill(detail: GoalDetail) {
  switch (detail.role) {
    case 'current':
      return (
        <Pill tone="accent" size="md" bold icon={<CircleCheck size={12} strokeWidth={2} />}>
          Active
        </Pill>
      );
    case 'next': {
      const day = detail.startsOn ?? addDays(detail.today, 1);
      const word = daysBetween(detail.today, day) < 7 ? fmtWeekday(day) : fmtDayShort(day);
      return (
        <Pill tone="neutral" size="md" bold icon={<Clock size={12} strokeWidth={2} />}>
          Starts {word}
        </Pill>
      );
    }
    case 'ended':
      return (
        <Pill tone="neutral" size="md" bold>
          Ended
        </Pill>
      );
    default:
      return (
        <Pill tone="neutral" size="md" bold>
          {detail.goal.status === 'draft' ? 'Draft' : 'Saved'}
        </Pill>
      );
  }
}

function GoalDetailView({ detail, onBack, backLabel }: { detail: GoalDetail; onBack: () => void; backLabel: string }) {
  const navigate = useNavigate();
  const now = useNow();
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const { goal, today, role } = detail;
  const pause = goal.template === 'pause';

  const [edit, setEdit] = useState<GoalEditorValue | null>(null);
  const [errors, setErrors] = useState<GoalDraftErrors>({});
  // Bumped when Save finds errors, so the form takes the user to the first one.
  const [focusSeq, setFocusSeq] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [untilChoice, setUntilChoice] = useState<PauseUntilChoice>('monday');
  const [untilDate, setUntilDate] = useState(() => pausePickDefault(today));
  const preview = useSwitchPreview(sheetOpen ? goal.id : undefined);

  // The form starts from the newest target (a change waiting for tomorrow included).
  const source = formFromGoal(goal, detail.pending ?? detail.version);
  const value = edit ?? source;
  const dirty = edit !== null && !sameForm(edit, source);
  const targetDirty = edit !== null && targetFieldsChanged(edit, source);
  const { dailyMinimumKcal, maintenanceKcal } = detail;
  const when = startsWhen(today, now, detail.tz, detail.rolloverHour);

  // The goal changed under an open sheet (archived, started elsewhere): say so and close it.
  const stale = sheetOpen && preview !== undefined && !preview.canSwitch;
  useEffect(() => {
    if (!stale) return;
    showToast(GOAL_ERRORS.changed);
    setSheetOpen(false);
  }, [stale, showToast]);

  const change = (next: GoalEditorValue) => {
    setEdit(next);
    setErrors({});
  };

  const showErrors = (found: GoalDraftErrors) => {
    setErrors(found);
    setFocusSeq((n) => n + 1);
  };

  const save = () =>
    inFlight.run('save', async () => {
      const draft = draftFromForm(value, goal.template, goal);
      const found = validateGoalDraft(draft, {
        today,
        dailyMinimumKcal,
        kcalChanged: draft.dailyKcal !== detail.versions.at(-1)?.dailyKcal,
        endChanged: !sameEndCondition(goal.endCondition, draft.endCondition),
        ...(detail.trendKg !== undefined ? { trendKg: detail.trendKg } : {}),
      });
      if (Object.keys(found).length > 0) {
        showErrors(found);
        return;
      }
      try {
        const result = await saveGoalEdits(goal.id, draft);
        setEdit(null);
        setErrors({});
        showToast(saveToast(result, when.short), () => void result.undo());
      } catch (error) {
        if (error instanceof GoalDraftError) showErrors(error.errors);
        else showToast(errorMessage(error, GOAL_ERRORS.save));
      }
    });

  const keepCurrent = () =>
    inFlight.run('cancel', async () => {
      const current = detail.current?.goal;
      if (!current) return;
      try {
        const { undo } = await cancelGoalSwitch();
        showToast(cancelToast(current), () => void undo());
      } catch (error) {
        showToast(errorMessage(error, GOAL_ERRORS.switch));
      }
    });

  const archive = () =>
    inFlight.run('archive', async () => {
      try {
        const { undo } = await archiveGoal(goal.id);
        showToast(archiveToast(goal), () => void undo());
        navigate(PATHS.goals, { replace: true });
      } catch (error) {
        showToast(errorMessage(error, GOAL_ERRORS.archive));
      }
    });

  const restore = () =>
    inFlight.run('restore', async () => {
      try {
        const { undo } = await restoreGoal(goal.id);
        showToast(restoreToast(goal), () => void undo());
      } catch (error) {
        showToast(errorMessage(error, GOAL_ERRORS.save));
      }
    });

  const sheet = preview && preview.canSwitch ? switchSheetModel(preview, { until: untilChoice, date: untilDate }, now) : undefined;

  const confirm = () =>
    inFlight.run('switch', async () => {
      if (!sheet || sheet.untilModel?.error) return;
      const until = pause ? sheet.untilDay : undefined;
      try {
        const result = await switchGoal(goal.id, until ? { until } : {});
        setSheetOpen(false);
        const message = result.cancelled
          ? cancelToast(goal)
          : switchToast(goal, result.startsOn, until, today, now, detail.tz, detail.rolloverHour);
        showToast(message, () => void result.undo());
      } catch (error) {
        setSheetOpen(false);
        showToast(errorMessage(error, GOAL_ERRORS.switch));
      }
    });

  const status = statusCard(detail, now);
  const end = detail.end;
  const endReached =
    role === 'current' && !detail.current?.paused && !detail.next && end.kind !== 'none' && end.reached ? { ...end, reached: true as const } : undefined;
  const endPath = maintainPath(detail.maintain);
  const formEnd = formEndState(value, { today, paceKgPerWeek: value.paceKgPerWeek, ...(detail.trendKg !== undefined ? { trendKg: detail.trendKg } : {}) });
  const history = historyRows({ history: detail.history, goal, today }, { inForce: role === 'current' });
  // A goal booked for a later day (a pause's resume) can start from tomorrow instead.
  const startsLater = role === 'next' && (detail.startsOn ?? addDays(today, 1)) !== addDays(today, 1);
  const showFooter = dirty || role === 'saved' || role === 'ended' || startsLater;

  return (
    <div className={[styles.screen, showFooter ? styles.withFooter : ''].filter(Boolean).join(' ')}>
      <SubScreenHeader title={goal.name} onBack={onBack} backLabel={backLabel} right={rolePill(detail)} />

      {status ? (
        <Card radius="card" padding="14px 16px" className={styles.status}>
          <h2 className={['t-insight', styles.statusHeadline].join(' ')}>{status.headline}</h2>
          {status.lines.map((line) => (
            <p key={line} className={styles.statusLine}>
              {line}
            </p>
          ))}
          {status.cancelLabel ? (
            <Button size="sm" variant="secondary" className={styles.statusAction} disabled={inFlight.busy('cancel')} onClick={() => void keepCurrent()}>
              {status.cancelLabel}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {endReached ? (
        <div className={styles.noteBlock}>
          <GoalEndNote end={{ state: endReached, goal, ...(detail.maintain ? { maintain: detail.maintain } : {}) }} onAction={() => (endPath ? navigate(endPath) : undefined)} />
        </div>
      ) : null}

      <GoalEditorFields
        template={goal.template}
        value={value}
        onChange={change}
        onSelectPace={(pace) => change(withPace(value, pace, { template: goal.template, maintenanceKcal, dailyMinimumKcal }))}
        paceOptions={goal.template === 'custom' ? CUSTOM_PACE_CHOICES : PACE_CHOICES}
        kcalMin={dailyMinimumKcal}
        hints={{
          target: targetWorking({
            template: goal.template,
            dailyKcal: value.dailyKcal,
            maintenanceKcal,
            paceKgPerWeek: value.paceKgPerWeek,
            rangePct: value.rangePct,
            dailyMinimumKcal,
          }),
          macros: macrosNote(value.dailyKcal, value.proteinG, targetDirty ? undefined : (detail.pending ?? detail.version)),
          ...(targetDirty ? { starts: startsNote(detail, now) } : {}),
          ...(goal.template === 'festive' ? { range: rangeLine(value.dailyKcal, value.rangePct) } : {}),
          ...(formEnd ? { end: endHint(formEnd) } : {}),
        }}
        allowWeightEnd={value.paceKgPerWeek !== 0}
        endDateMin={addDays(today, 1)}
        endDateMax={addDays(today, END_DATE_MAX_DAYS)}
        errors={errors}
        focusSeq={focusSeq}
        switchNote={role === 'saved'}
      />

      <SectionHeading>{pause ? 'Use' : 'Target history'}</SectionHeading>
      <p className={styles.usage}>{usageLine(detail)}</p>
      {history.length > 0 ? (
        <div className={styles.history}>
          <ul className={styles.historyList} aria-label="Target history">
            {history.map((row) => (
              <li key={row.key} className={styles.historyRow}>
                <span className={styles.historyText}>
                  <span className="t-item">{row.title}</span>
                  <span className={styles.historySub}>{row.sub}</span>
                </span>
                {row.badge ? (
                  <Pill
                    className={styles.historyBadge}
                    tone={row.badge.tone}
                    icon={row.badge.icon === 'now' ? <CircleCheck size={12} strokeWidth={2} /> : <Clock size={12} strokeWidth={2} />}
                  >
                    {row.badge.label}
                  </Pill>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {role === 'current' && !pause ? (
        <div className={styles.targetLink}>
          <Button size="sm" variant="secondary" onClick={() => navigate(PATHS.target)}>
            See your target
          </Button>
        </div>
      ) : null}

      {role === 'saved' ? (
        <div className={styles.archive}>
          <SettingsGroup>
            <SettingsRow
              label="Archive this goal"
              sub={detail.everUsed ? 'Past days keep it.' : 'Removes it from your goals.'}
              onPress={() => void archive()}
            />
          </SettingsGroup>
        </div>
      ) : null}

      {showFooter ? (
        <div className={styles.stickyFooter}>
          {dirty ? (
            <>
              <Button size="lg" disabled={inFlight.busy('save')} onClick={() => void save()}>
                Save changes
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => {
                  setEdit(null);
                  setErrors({});
                }}
              >
                Discard
              </Button>
            </>
          ) : role === 'ended' ? (
            <Button size="lg" disabled={inFlight.busy('restore')} onClick={() => void restore()}>
              Restore
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => {
                setUntilChoice('monday');
                setUntilDate(pausePickDefault(today));
                setSheetOpen(true);
              }}
            >
              Switch to this goal
            </Button>
          )}
        </div>
      ) : null}

      {sheet ? (
        <GoalSwitchSheet
          open={sheetOpen}
          goalName={sheet.goalName}
          startsLine={sheet.startsLine}
          week={sheet.week}
          changes={sheet.changes}
          replaces={sheet.replaces}
          until={
            sheet.untilModel
              ? { ...sheet.untilModel, onSelect: setUntilChoice, onDate: setUntilDate }
              : undefined
          }
          confirmLabel={sheet.confirmLabel}
          busy={inFlight.busy('switch')}
          onConfirm={() => void confirm()}
          onCancel={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** @design S42 Goal detail / edit — status, the goal's fields, its target history, Switch to this goal / Archive / Restore. */
export default function GoalDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lookup = useGoalDetail(id);
  const detail = lookup?.detail ?? null;

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.goals, { replace: true }));
  const backLabel = hasHistory ? 'Back' : 'Back to Goals';

  if (lookup === undefined) {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Goal" onBack={back} backLabel={backLabel} />
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading the goal" />
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Goal" onBack={back} backLabel={backLabel} />
        <div className={styles.block}>
          <h2 className="sr-only">Goal</h2>
          <EmptyState
            icon={<SearchX />}
            headline="This goal isn't here any more"
            body="It may have been archived on another device."
            actionLabel="See your goals"
            onAction={() => navigate(PATHS.goals, { replace: true })}
          />
        </div>
      </div>
    );
  }
  // A template row isn't a goal yet: it opens S43 with that template picked.
  if (detail.role === 'template') return <Navigate to={PATHS.goalNew(detail.goal.template)} replace />;
  return <GoalDetailView key={detail.goal.id} detail={detail} onBack={back} backLabel={backLabel} />;
}
