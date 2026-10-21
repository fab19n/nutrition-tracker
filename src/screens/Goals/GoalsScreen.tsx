import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { GoalCard } from '@/components/GoalCard/GoalCard';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { cancelGoalSwitch, markGoalEndNoticeSeen, useGoalLibrary, type GoalLibrary } from '@/db/goals';
import { useNow } from '@/db/hooks';
import { GoalChangedError } from '@/domain/goals';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { GoalEndNote, maintainPath } from './GoalEndNote';
import { GOAL_ERRORS, cancelToast, goalCardModel, type GoalCardContext } from './goalsModel';
import styles from './Goals.module.css';

function Library({ library }: { library: GoalLibrary }) {
  const navigate = useNavigate();
  const now = useNow();
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const { current, next, saved, templates, ended, end } = library;
  const ctx: GoalCardContext = { today: library.today, now, tz: library.tz, rolloverHour: library.rolloverHour, dailyMinimumKcal: library.dailyMinimumKcal };

  // Showing the note counts as seeing it: the Today banner for this end doesn't come back.
  const endKeyShown = end?.key;
  useEffect(() => {
    if (endKeyShown) markGoalEndNoticeSeen(endKeyShown);
  }, [endKeyShown]);

  const keepCurrent = () =>
    inFlight.run('cancel', async () => {
      if (!current) return;
      try {
        const { undo } = await cancelGoalSwitch();
        showToast(cancelToast(current.goal), () => void undo());
      } catch (error) {
        showToast(error instanceof GoalChangedError ? GOAL_ERRORS.changed : GOAL_ERRORS.switch);
      }
    });

  const endPath = end ? maintainPath(end.maintain) : undefined;

  return (
    <>
      <h2 className="sr-only">Your goal now</h2>
      <ul className={styles.cards}>
        <li>
          {current ? (
            <GoalCard {...goalCardModel({ role: 'current', entry: current }, ctx)} onOpen={() => navigate(PATHS.goal(current.goal.id))} />
          ) : (
            <Card radius="card" padding="14px 16px" dashed className={styles.none}>
              No goal is running. Pick one below and it starts tomorrow.
            </Card>
          )}
        </li>
        {next ? (
          <li>
            <GoalCard
              {...goalCardModel({ role: 'next', entry: next }, ctx)}
              onOpen={() => navigate(PATHS.goal(next.goal.id))}
              action={
                current
                  ? { label: `Keep ${current.goal.name} instead`, onPress: () => void keepCurrent(), busy: inFlight.busy('cancel') }
                  : undefined
              }
            />
          </li>
        ) : null}
      </ul>

      {end ? (
        <div className={styles.noteBlock}>
          <GoalEndNote end={end} onAction={() => (endPath ? navigate(endPath) : undefined)} />
        </div>
      ) : null}

      {saved.length > 0 ? (
        <>
          <SectionHeading>Saved goals</SectionHeading>
          <ul className={styles.cards}>
            {saved.map((entry) => (
              <li key={entry.goal.id}>
                <GoalCard {...goalCardModel({ role: 'saved', entry }, ctx)} onOpen={() => navigate(PATHS.goal(entry.goal.id))} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {templates.length > 0 ? (
        <>
          <SectionHeading>Templates</SectionHeading>
          <ul className={styles.cards}>
            {templates.map((template) => (
              <li key={template}>
                <GoalCard {...goalCardModel({ role: 'template', template }, ctx)} onOpen={() => navigate(PATHS.goalNew(template))} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className={styles.footer}>
        <Button icon={<Plus size={18} strokeWidth={2} />} onClick={() => navigate(PATHS.goalNew())}>
          New goal
        </Button>
      </div>

      {ended.length > 0 ? (
        <>
          <SectionHeading>Ended</SectionHeading>
          <ul className={styles.cards}>
            {ended.map((entry) => (
              <li key={entry.goal.id}>
                <GoalCard {...goalCardModel({ role: 'ended', entry }, ctx)} onOpen={() => navigate(PATHS.goal(entry.goal.id))} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** @design S41 Goals library — the goal in force, a booked switch, saved goals, templates, New goal and ended goals. */
export default function GoalsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const library = useGoalLibrary();

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.more, { replace: true }));

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Goals" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to More'} />
      {library ? (
        <Library library={library} />
      ) : (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading your goals" />
        </div>
      )}
    </div>
  );
}
