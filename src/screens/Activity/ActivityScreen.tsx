import { Activity, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { WORKOUT_TYPE_ICON } from '@/components/WorkoutForm/WorkoutForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { deleteActivityEntry, useActivity, type ActivityEntry, type ActivityWeek } from '@/db/activity';
import type { LogicalDay } from '@/domain/types';
import { useInFlight } from '@/screens/inFlight';
import { useUiStore } from '@/state/ui';
import { closedWeekDelete, deleteLabel, entryKcal, entryTitle, weekHeading } from './activityModel';
import styles from './Activity.module.css';

const EMPTY_BODY = "Log a workout and its calories are added to this week's budget.";

const FOOTNOTE =
  'Workout calories are added to the week they happen in, so a Tuesday session also adds room on Saturday. Each week starts fresh on Monday.';

function WeekHeading({ week }: { week: ActivityWeek }) {
  return (
    <SectionHeading>
      {weekHeading(week)} <span className="sr-only">kcal added</span>
    </SectionHeading>
  );
}

interface EntryRowProps {
  entry: ActivityEntry;
  today: LogicalDay;
  busy: boolean;
  onDelete: (entry: ActivityEntry) => void;
}

function EntryRow({ entry, today, busy, onDelete }: EntryRowProps) {
  const Icon = entry.kind === 'workout' ? WORKOUT_TYPE_ICON[entry.workout.type] : Sparkles;
  const sub = entry.kind === 'bonus' && entry.bonus.reason.trim() !== '' ? 'One-off bonus' : undefined;
  return (
    <li className={styles.row}>
      <span className={styles.rowIcon} aria-hidden="true">
        <Icon size={18} strokeWidth={2} />
      </span>
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>{entryTitle(entry, today)}</div>
        {sub ? <div className={styles.rowSub}>{sub}</div> : null}
      </div>
      <span className={[styles.rowKcal, entry.kind === 'bonus' ? styles.positive : ''].filter(Boolean).join(' ')}>
        {entryKcal(entry)} <span className="sr-only">kcal</span>
      </span>
      <button type="button" className={styles.delete} aria-label={deleteLabel(entry, today)} disabled={busy} onClick={() => onDelete(entry)}>
        <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * @design S30 Activity — workouts and one-off bonuses by budget week with the kcal each week
 * gained ("Last week · +470"), then + Log workout (opens S29). Each entry deletes with undo; in a
 * week that has closed the delete is confirmed first, since it changes that week's budget.
 */
export default function ActivityScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const view = useActivity();
  const inFlight = useInFlight();

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.more, { replace: true }));
  const openLog = () => void navigate(PATHS.workoutNew);

  // An entry in a closed week waits here for the confirmation.
  const [confirming, setConfirming] = useState<ActivityEntry | null>(null);

  const remove = (entry: ActivityEntry) =>
    void inFlight.run(entry.id, async () => {
      try {
        const undo = await deleteActivityEntry(entry);
        showToast(entry.kind === 'workout' ? 'Workout deleted' : 'Bonus deleted', () => void undo());
      } catch {
        showToast("Couldn't delete that. Try again.");
      }
    });

  const askToRemove = (entry: ActivityEntry, week: ActivityWeek) => (week.closed ? setConfirming(entry) : remove(entry));

  let body;
  if (view === undefined) {
    body = (
      <div className={styles.block}>
        <SkeletonList count={2} label="Loading activity" />
      </div>
    );
  } else if (!view.hasAny) {
    const thisWeek = view.weeks.find((w) => w.kind === 'thisWeek');
    body = (
      <>
        {thisWeek ? <WeekHeading week={thisWeek} /> : null}
        <div className={styles.block}>
          <EmptyState icon={<Activity />} headline="Workouts add to your budget" body={EMPTY_BODY} actionLabel="Log workout" onAction={openLog} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        {view.weeks.map((week) => (
          <section key={week.weekStart}>
            <WeekHeading week={week} />
            {week.entries.length === 0 ? (
              <Card radius="card" padding="14px 16px" dashed className={styles.block}>
                <p className={styles.emptyWeek}>Nothing logged this week yet.</p>
              </Card>
            ) : (
              <Card radius="card" padding="4px 14px" className={styles.block}>
                <ul className={styles.list}>
                  {week.entries.map((entry) => (
                    <EntryRow
                      key={`${entry.kind}-${entry.id}`}
                      entry={entry}
                      today={view.today}
                      busy={inFlight.busy(entry.id)}
                      onDelete={(e) => askToRemove(e, week)}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </section>
        ))}
        <div className={styles.actionRow}>
          <Button variant="secondary" size="md" icon={<Plus size={18} strokeWidth={2} />} onClick={openLog}>
            Log workout
          </Button>
        </div>
        <p className={styles.footnote}>{FOOTNOTE}</p>
      </>
    );
  }

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Activity" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to More'} />
      {body}
      {view ? (
        <ConfirmDialog
          open={confirming !== null}
          {...(confirming ? closedWeekDelete(confirming, view.today) : { title: '', body: '' })}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            if (confirming) remove(confirming);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
