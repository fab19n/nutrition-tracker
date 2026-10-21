import { PATHS } from '@/app/paths';
import { Button } from '@/components/ui/Button';
import type { GoalEndView } from '@/db/goals';
import { endNote } from './goalsModel';
import styles from './Goals.module.css';

/** S41 and S42: the reached end, with the maintain goal to look at. */
export function GoalEndNote({ end, onAction }: { end: Pick<GoalEndView, 'state' | 'maintain' | 'goal'>; onAction: () => void }) {
  const note = endNote(end);
  return (
    <div className={styles.endNote} role="note">
      <p className={styles.endText}>
        <b>{note.lead}</b> {note.rest}
      </p>
      {note.actionLabel ? (
        <Button size="sm" className={styles.endAction} onClick={onAction}>
          {note.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Where the end note's action goes: the saved maintain goal, or a new one from the Festive template. */
export function maintainPath(maintain: GoalEndView['maintain']): string | undefined {
  if (maintain?.kind === 'goal') return PATHS.goal(maintain.goal.id);
  if (maintain?.kind === 'template') return PATHS.goalNew('festive');
  return undefined;
}
