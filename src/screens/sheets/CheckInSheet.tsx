import { useState } from 'react';
import { useSheet } from '@/app/navigation';
import { SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { CheckInCard } from '@/components/CheckInCard/CheckInCard';
import { DayTimeline, type TimelineDot } from '@/components/DayTimeline/DayTimeline';
import { Button } from '@/components/ui/Button';
import { confirmDay, type CheckInChoice } from '@/db/actions';
import { useCheckIn, useDaySummary, useNow, useProfile, useToday } from '@/db/hooks';
import { CHECK_IN_PROMPT, type CheckIn } from '@/db/selectors';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, MINUTES_PER_DAY, addDays, minutesIntoLogicalDay, zonedParts } from '@/domain/day';
import { fmtClock, fmtDayShort, fmtInt, fmtTime } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { TimingTagKind } from '@/domain/timing';
import type { Instant, LogicalDay, MealSlot } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { joinNames } from '@/screens/Today/budgetText';
import styles from './CheckInSheet.module.css';

const SLOT_WORD: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  supper: 'supper',
};

const HOURS_PER_DAY = 24;
/** With more meals than this, the captions keep the first and last times only. */
const MAX_TIME_CAPTIONS = 3;
const LATE_TAGS: ReadonlySet<TimingTagKind> = new Set(['lateForYou', 'outsideWindow']);

function greeting(now: Date, tz: string): string {
  const hour = zonedParts(now, tz).hour;
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface TimelineParts {
  dots: TimelineDot[];
  windowStartPct?: number;
  windowEndPct?: number;
  gap?: { startPct: number; endPct: number; label: string };
  captions: string[];
  ariaLabel: string;
}

/** The day's meals as a C12 strip across the logical day, with the gap box over the missing meal. */
function timelineParts(
  checkIn: CheckIn,
  window: { opensAt?: Instant; closesAt?: Instant } | undefined,
  tags: Record<string, TimingTagKind>,
  dayName: string,
  tz: string,
  rolloverHour: number,
): TimelineParts {
  const pct = (at: Instant) => (minutesIntoLogicalDay(at, tz, rolloverHour) / MINUTES_PER_DAY) * 100;
  const hoursPct = (hours: number) => (hours / HOURS_PER_DAY) * 100;
  const logged = checkIn.meals.filter((m) => !m.isGuess);
  const dots: TimelineDot[] = logged.map((m) => ({
    pct: pct(m.eatenAt),
    kcal: mealMacros(m).kcal,
    tone: LATE_TAGS.has(tags[m.id] ?? 'onTime') ? 'late' : 'onTime',
  }));

  const parts: TimelineParts = { dots, captions: [], ariaLabel: '' };
  if (window?.opensAt && window.closesAt) {
    const start = pct(window.opensAt);
    const spanHours = (Date.parse(window.closesAt) - Date.parse(window.opensAt)) / 3_600_000;
    parts.windowStartPct = start;
    parts.windowEndPct = Math.min(100, start + hoursPct(spanHours));
  }
  const gap = checkIn.analysis.gap;
  if (gap) {
    const start = pct(gap.from);
    parts.gap = {
      startPct: start,
      endPct: Math.min(100, start + hoursPct(gap.hours)),
      label: `usual ${SLOT_WORD[gap.missingSlot]} ${gap.usualLabel}`,
    };
  }

  // Spread under the track like the design's "woke 10am · 11:10am · 3:40pm · slept 1:30am": the day
  // starts at the rollover (there's no wake time to show) and ends at the sleep tap, else the next rollover.
  const times = logged.map((m) => fmtTime(m.eatenAt, tz));
  const shown = times.length > MAX_TIME_CAPTIONS ? [times[0] ?? '', times[times.length - 1] ?? ''] : times;
  const sleepAt = checkIn.record?.sleepAt;
  const rollover = fmtClock(rolloverHour * 60, { compact: true });
  parts.captions = [`day starts ${rollover}`, ...shown, sleepAt ? `slept ${fmtTime(sleepAt, tz)}` : `ends ${rollover}`];

  const spokenTimes = times.length > 0 ? `meals at ${joinNames(times)}` : 'nothing logged';
  const spokenGap = gap ? `, then nothing for ${fmtInt(Math.round(gap.hours))} hours` : '';
  const spokenSleep = sleepAt ? `. Slept at ${fmtTime(sleepAt, tz)}` : '';
  parts.ariaLabel = `${dayName}: ${spokenTimes}${spokenGap}${spokenSleep}.`;
  return parts;
}

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function dayParam(value: string | null): LogicalDay | undefined {
  return value && DAY_PARAM.test(value) ? value : undefined;
}

function toastFor(choice: Exclude<CheckInChoice, 'addMore'>, dayName: string, checkIn: CheckIn): string {
  if (choice === 'fillTypical' && checkIn.guess) return `${dayName} · typical ${SLOT_WORD[checkIn.guess.slot]} added as a guess`;
  return `${dayName} confirmed`;
}

/**
 * @design S15 Morning check-in — confirm a finished day so missed meals never turn into savings.
 * Older days still waiting are answered one at a time, newest first.
 */
export default function CheckInSheet({ close }: { close: () => void }) {
  const { open, params } = useSheet();
  // Opened from the Diary on an older waiting day (?day=): that day comes first, then the rest.
  const [askFirst, setAskFirst] = useState<LogicalDay | undefined>(() => dayParam(params.get('day')));
  const checkIn = useCheckIn(askFirst);
  const today = useToday();
  const now = useNow();
  const profile = useProfile();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const rolloverHour = profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const yesterday = addDays(today, -1);
  const summary = useDaySummary(checkIn?.day ?? yesterday);
  const showToast = useUiStore((s) => s.showToast);
  const [selection, setSelection] = useState<{ day: LogicalDay; id: CheckInChoice } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!checkIn) {
    return (
      <div className={styles.placeholder} role="status">
        <span className="sr-only">Loading the check-in</span>
      </div>
    );
  }

  // Asked about a day that doesn't need it (already confirmed, or never waiting): the queue instead.
  if (askFirst && (!checkIn.needed || !checkIn.queue.includes(askFirst))) {
    setAskFirst(undefined);
    return null;
  }

  if (!checkIn.needed) {
    return (
      <div className={styles.caughtUp}>
        <SheetTitle>All caught up</SheetTitle>
        <p className={styles.body}>Every finished day this week is confirmed.</p>
        <Button onClick={close}>Close</Button>
      </div>
    );
  }

  const day = checkIn.day;
  const dayName = day === yesterday ? 'Yesterday' : fmtDayShort(day);
  const later = checkIn.queue.filter((d) => d !== day).length;
  const subtitle = later > 0 ? `${greeting(now, tz)} · ${fmtInt(later)} more ${later === 1 ? 'day' : 'days'} after this` : greeting(now, tz);
  const selectedId = selection?.day === day ? selection.id : undefined;
  const selected = checkIn.options.find((o) => o.id === selectedId);
  const timeline = timelineParts(checkIn, summary?.day === day ? summary.window : undefined, summary?.day === day ? summary.tags : {}, dayName, tz, rolloverHour);

  const addMore = () => open('log', { at: checkIn.addMoreAt });

  const answer = async (choice: CheckInChoice) => {
    if (busy) return;
    if (choice === 'addMore') {
      addMore();
      return;
    }
    setBusy(true);
    // The last day closes the sheet straight away; with more waiting, the next one comes up here.
    if (later === 0) close();
    try {
      const result = await confirmDay(day, choice, checkIn.guess);
      if (day === askFirst) setAskFirst(undefined);
      showToast(toastFor(choice, dayName, checkIn), () => void result.undo());
    } catch {
      showToast(`Couldn't save the check-in. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CheckInCard
      variant={checkIn.variant}
      subtitle={subtitle}
      title={checkIn.title}
      timeline={
        <DayTimeline
          dots={timeline.dots}
          windowStartPct={timeline.windowStartPct}
          windowEndPct={timeline.windowEndPct}
          gap={checkIn.variant === 'full' ? timeline.gap : undefined}
          captions={[]}
          ariaLabel={timeline.ariaLabel}
        />
      }
      captions={timeline.captions}
      explanation={checkIn.explanation}
      options={checkIn.options.map((o) => ({ id: o.id, label: o.label }))}
      selectedId={selectedId}
      onSelect={(id) => {
        const option = checkIn.options.find((o) => o.id === id);
        if (option) setSelection({ day, id: option.id });
      }}
      consequence={selected?.consequence ?? CHECK_IN_PROMPT}
      onDone={() => void answer(checkIn.variant === 'light' ? 'complete' : (selectedId ?? 'complete'))}
      onAddMore={addMore}
    />
  );
}
