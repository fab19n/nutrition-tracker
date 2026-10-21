import { CirclePause, Clock, Gauge } from 'lucide-react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import type { LogicalDay } from '@/domain/types';
import styles from './GoalSwitchSheet.module.css';

/** How long a pause runs: to the default Monday, to a picked day, or until the next switch. */
export type PauseUntilChoice = 'monday' | 'date' | 'open';

export interface GoalSwitchPanelProps {
  goalName: string;
  /** "Starts tomorrow (Sat). Past days keep the goal they had." */
  startsLine: string;
  /** "This week: 5 days at 1,800 + 2 days at 2,100 = " + bold "13,200 kcal" + optional tail ". Sat and Sun: budget off." */
  week?: { lead: string; total: string; tail?: string };
  /**
   * One sentence each: the main number first (a pause icon when `until` is set, as only Pause
   * has it), then the timing rules.
   */
  changes: readonly string[];
  /** "This replaces Festive maintain from Sat." */
  replaces?: string;
  /** Pause only: how long it runs. */
  until?: {
    options: readonly { id: PauseUntilChoice; label: string }[];
    selected: PauseUntilChoice;
    onSelect: (id: PauseUntilChoice) => void;
    date: LogicalDay;
    minDate: LogicalDay;
    maxDate: LogicalDay;
    onDate: (day: LogicalDay) => void;
    /** "Cut starts again on Mon 19 Oct." / "Runs until you switch to another goal." */
    line: string;
    error?: string;
  };
  /** "Switch from tomorrow" / "Switch from 5am". */
  confirmLabel: string;
  /** The switch is being saved: Confirm waits. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface GoalSwitchSheetProps extends GoalSwitchPanelProps {
  open: boolean;
}

function changeIcon(index: number, pause: boolean) {
  const props = { size: 16, strokeWidth: 2, 'aria-hidden': true, className: styles.changeIcon } as const;
  if (index > 0) return <Clock {...props} />;
  return pause ? <CirclePause {...props} /> : <Gauge {...props} />;
}

/**
 * What a switch does, before it's confirmed: when it starts, the week's budget with the new
 * goal from tomorrow, what changes, and (for Pause) how long it runs.
 * @design C47 GoalSwitchSheet
 */
export function GoalSwitchPanel({ goalName, startsLine, week, changes, replaces, until, confirmLabel, busy, onConfirm, onCancel }: GoalSwitchPanelProps) {
  const selectedIndex = until ? until.options.findIndex((o) => o.id === until.selected) : -1;
  return (
    <div className={styles.panel}>
      <SheetTitle className={styles.title}>
        Switch to <b>{goalName}</b>?
      </SheetTitle>
      <p className={styles.starts}>{startsLine}</p>

      {week ? (
        <p className={styles.week}>
          {week.lead}
          <b>{week.total}</b>
          {week.tail ?? null}
        </p>
      ) : null}

      {changes.length > 0 ? (
        <>
          <h3 className={styles.heading}>What changes</h3>
          <ul className={styles.changes}>
            {changes.map((change, i) => (
              <li key={i} className={styles.change}>
                {changeIcon(i, until !== undefined)}
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {replaces ? <p className={styles.replaces}>{replaces}</p> : null}

      {until ? (
        <div className={styles.until}>
          <span className={styles.heading} aria-hidden="true">
            Until
          </span>
          <div className={styles.untilChips}>
            <ChipGroup
              kind="choice"
              label="Until"
              options={until.options}
              selectedIndex={selectedIndex}
              getLabel={(o) => o.label}
              onSelect={(i) => {
                const option = until.options[i];
                if (option) until.onSelect(option.id);
              }}
            />
          </div>
          {until.selected === 'date' ? (
            <div className={[styles.dateField, until.error ? styles.invalid : ''].filter(Boolean).join(' ')}>
              <input
                type="date"
                aria-label="Until date"
                aria-invalid={until.error ? true : undefined}
                className={styles.date}
                value={until.date}
                min={until.minDate}
                max={until.maxDate}
                onChange={(e) => {
                  if (e.target.value) until.onDate(e.target.value);
                }}
              />
            </div>
          ) : null}
          {until.line ? (
            <p className={styles.line} aria-live="polite">
              {until.line}
            </p>
          ) : null}
          {until.error ? (
            <p className={styles.error} role="alert">
              {until.error}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button size="lg" disabled={busy === true || until?.error !== undefined} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button size="lg" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** S44: the switch panel in a dismissible sheet (scrim, Escape and the handle cancel). */
export function GoalSwitchSheet({ open, ...panel }: GoalSwitchSheetProps) {
  return (
    <BottomSheet open={open} onClose={panel.onCancel} maxHeight="92%">
      <GoalSwitchPanel {...panel} />
    </BottomSheet>
  );
}
