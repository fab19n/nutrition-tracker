import { useState } from 'react';
import { SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { planMakanDay } from '@/db/actions';
import { useWeekBudget } from '@/db/hooks';
import { previewMakanDay } from '@/db/makan';
import { compareDays, weekDays, weekdayIndex } from '@/domain/day';
import { fmtInt, fmtSigned, fmtWeekday } from '@/domain/format';
import type { LogicalDay } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { weekdayLong } from '@/screens/Today/budgetText';
import styles from './MakanSheet.module.css';

const isWeekend = (day: LogicalDay) => weekdayIndex(day) >= 5;

/** @design S18 Plan a makan day — pick a day this week and see the room your savings make on it. */
export default function MakanSheet({ close }: { close: () => void }) {
  const view = useWeekBudget();
  const showToast = useUiStore((s) => s.showToast);
  const [picked, setPicked] = useState<LogicalDay | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!view) {
    return (
      <>
        <SheetTitle className={styles.title}>Plan a makan day</SheetTitle>
        <div className={styles.placeholder} role="status">
          <span className="sr-only">Loading the week</span>
        </div>
      </>
    );
  }

  const { budget, version } = view;
  const today = budget.today;
  const pausedDays = new Set(budget.days.filter((d) => d.kind === 'paused').map((d) => d.day));
  const remaining = weekDays(budget.weekStart).filter((d) => compareDays(d, today) >= 0 && !pausedDays.has(d));
  const weekend = remaining.filter(isWeekend);
  const weekdays = remaining.filter((d) => !isWeekend(d));
  const planned = budget.makanDay && remaining.includes(budget.makanDay) ? budget.makanDay : undefined;
  const chosen = picked ?? planned ?? weekend[0] ?? weekdays[0];
  const showWeekdays = weekdays.length > 0 && (otherOpen || (chosen !== undefined && !isWeekend(chosen)));

  const chipLabel = (day: LogicalDay) => (day === today ? 'Today' : fmtWeekday(day));
  const dayName = (day: LogicalDay) => (day === today ? 'today' : weekdayLong(day));

  // A preview of the week with this makan day, from the data layer (the same maths Today uses).
  const preview = chosen ? previewMakanDay(view, chosen) : undefined;
  const room = preview?.roomKcal;
  const base = preview?.baseKcal ?? 0;
  const hasRoom = room !== undefined && room > base;

  let caption: string;
  if (!hasRoom) caption = 'No savings to set aside yet. Days under budget add to it.';
  else if (chosen === today) caption = `Today's budget plus your ${fmtSigned(budget.savedKcal)} saved`;
  else caption = `if today and the other days stay at ${fmtInt(version.dailyKcal)}`;

  const confirm = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    try {
      await planMakanDay(budget.weekStart, chosen);
      close();
      showToast(`Saving for ${dayName(chosen)}`, () => void planMakanDay(budget.weekStart, planned ?? null));
    } catch {
      setSaving(false);
      showToast("Couldn't plan that day. Try again.");
    }
  };

  const remove = async () => {
    if (!planned || saving) return;
    setSaving(true);
    try {
      await planMakanDay(budget.weekStart, null);
      close();
      showToast('Makan day removed', () => void planMakanDay(budget.weekStart, planned));
    } catch {
      setSaving(false);
      showToast("Couldn't remove it. Try again.");
    }
  };

  const pick = (day: LogicalDay) => {
    setPicked(day);
    if (isWeekend(day)) setOtherOpen(false);
  };

  return (
    <>
      <SheetTitle className={styles.title}>Plan a makan day</SheetTitle>

      <div role="group" aria-label="Makan day" className={styles.chips}>
        {weekend.map((day) => (
          <Chip key={day} kind="choice" selected={day === chosen} onClick={() => pick(day)}>
            {chipLabel(day)}
          </Chip>
        ))}
        {weekdays.length > 0 ? (
          <Chip
            kind="choice"
            selected={showWeekdays}
            aria-expanded={showWeekdays}
            onClick={() => {
              setOtherOpen(true);
              if (!chosen || isWeekend(chosen)) setPicked(weekdays[0] ?? null);
            }}
          >
            {weekend.length > 0 ? 'Other' : 'Pick a day'}
          </Chip>
        ) : null}
      </div>

      {showWeekdays ? (
        <div role="group" aria-label="Other days" className={[styles.chips, styles.weekdays].join(' ')}>
          {weekdays.map((day) => (
            <Chip key={day} kind="portion" selected={day === chosen} onClick={() => pick(day)}>
              {chipLabel(day)}
            </Chip>
          ))}
        </div>
      ) : null}

      {chosen && room !== undefined ? (
        <div className={styles.room} aria-live="polite">
          <div className={styles.roomLabel}>{chosen === today ? 'Room today' : `Room on ${weekdayLong(chosen)}`}</div>
          <div className={['t-hero-sheet', styles.roomValue].join(' ')}>
            <span>{`~${fmtInt(room)}`}</span> <span className={styles.unit}>kcal</span>
          </div>
          <div className={styles.caption}>{caption}</div>
          {budget.pendingSavedKcal > 0 ? (
            <div className={styles.caption}>Up to {fmtSigned(budget.pendingSavedKcal)} more once you confirm the days waiting for a check-in</div>
          ) : null}
        </div>
      ) : null}

      <Button className={styles.confirm} onClick={() => void confirm()} disabled={!chosen || saving}>
        Confirm
      </Button>
      {planned ? (
        <Button variant="ghost" size="md" className={styles.remove} onClick={() => void remove()} disabled={saving}>
          Remove makan day
        </Button>
      ) : null}
    </>
  );
}
