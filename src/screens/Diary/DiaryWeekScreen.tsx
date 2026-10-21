import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Star } from 'lucide-react';
import { PATHS } from '@/app/paths';
import { Banner } from '@/components/Banner/Banner';
import { DayStatusBadge } from '@/components/DayStatusBadge/DayStatusBadge';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { DateSwitcher, TopBar } from '@/components/TopBar/TopBar';
import { WeekBars } from '@/components/WeekBars/WeekBars';
import { Card } from '@/components/ui/Card';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { budgetUnderTarget, useWeekGoals } from '@/db/diary';
import { useActiveGoal, useProfile, useToday, useWeekBudget } from '@/db/hooks';
import type { BudgetDay } from '@/domain/budget';
import { addDays, compareDays, weekStartOf } from '@/domain/day';
import { fmtInt, fmtSigned, fmtWeekday } from '@/domain/format';
import type { LogicalDay } from '@/domain/types';
import {
  DIARY_VIEWS,
  budgetDayBadge,
  dayForWeek,
  dayRowKcal,
  diaryDayPath,
  parseWeekParam,
  relativeWeek,
  targetCaption,
  weekBarsFor,
  weekBarsLabel,
  weekInline,
  weekTitle,
} from './diaryModel';
import styles from './Diary.module.css';

type ViewUnder = 'atTheTime' | 'current';

const VIEW_UNDER: readonly SegmentedOption<ViewUnder>[] = [
  { value: 'atTheTime', label: 'Goal at the time' },
  { value: 'current', label: 'Current goal' },
];

/** Label for the week either side of the shown one. */
function neighbourLabel(weekStart: LogicalDay, thisWeek: LogicalDay, direction: -1 | 1): string {
  return relativeWeek(weekStart, thisWeek) ?? (direction < 0 ? 'Earlier' : 'Later');
}

interface DayRowProps {
  day: BudgetDay;
  makanDay: LogicalDay | undefined;
  switchedTo: string | undefined;
  onOpen?: () => void;
}

function DayRow({ day, makanDay, switchedTo, onOpen }: DayRowProps) {
  const { kcal, planned } = dayRowKcal(day);
  const finishedMakanDay = day.isFinished && day.day === makanDay;
  const content = (
    <>
      <span className={styles.dayRowLeft}>
        <span className={styles.dayName}>{fmtWeekday(day.day)}</span>
        <DayStatusBadge status={budgetDayBadge(day)} />
        {finishedMakanDay ? (
          <span className={styles.makanStar} title="Makan day">
            <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />
            <span className="sr-only">Makan day</span>
          </span>
        ) : null}
        {switchedTo ? <span className={styles.switchNote}>{switchedTo} from here</span> : null}
      </span>
      <span className={[styles.dayKcal, planned || day.kind === 'notCounted' ? styles.planned : ''].filter(Boolean).join(' ')}>
        {kcal === null ? '—' : fmtInt(kcal)}
        <span className="sr-only">{planned ? ' kcal planned' : ' kcal'}</span>
      </span>
    </>
  );
  if (!onOpen) return <div className={styles.dayRow}>{content}</div>;
  return (
    <button type="button" className={styles.dayRow} onClick={onOpen}>
      {content}
    </button>
  );
}

/** @design S13 Diary week — WeekBars, one row per day, and "View under" (S45). */
export default function DiaryWeekScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profile = useProfile();
  const today = useToday();
  const thisWeek = weekStartOf(today);
  const earliestWeek = profile ? weekStartOf(profile.startedOn) : undefined;
  const weekStart = parseWeekParam(params.get('week'), thisWeek, earliestWeek);
  const isThisWeek = weekStart === thisWeek;
  const reference = dayForWeek(weekStart, today);

  const loadedView = useWeekBudget(reference);
  // While another week loads, the hook still holds the previous one.
  const view = loadedView?.budget.weekStart === weekStart ? loadedView : undefined;
  const current = useActiveGoal();
  const goals = useWeekGoals(weekStart);
  const [under, setUnder] = useState<ViewUnder>('atTheTime');

  const currentTarget = current ? (current.paused ? null : current.version.dailyKcal) : undefined;
  const viewingCurrent = under === 'current' && currentTarget !== undefined;
  const budget = useMemo(() => {
    if (!view) return undefined;
    return viewingCurrent ? budgetUnderTarget(view, currentTarget ?? null) : view.budget;
  }, [view, viewingCurrent, currentTarget]);

  const goToWeek = (next: LogicalDay) => {
    const search = new URLSearchParams(params);
    if (next === thisWeek) search.delete('week');
    else search.set('week', next);
    setParams(search, { replace: true });
  };
  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const canGoBack = !earliestWeek || compareDays(prev, earliestWeek) >= 0;

  const targets = viewingCurrent ? [currentTarget ?? null] : (view?.days.map((d) => d.targetKcal) ?? []);
  const lineTarget = viewingCurrent ? (currentTarget ?? null) : ([...targets].reverse().find((t) => t !== null) ?? null);
  const switchedTo = new Map((goals ?? []).filter((g) => g.switched && g.goal).map((g) => [g.day, g.goal?.name]));

  return (
    <div className={styles.tabScreen}>
      <TopBar
        title="Diary"
        onSearch={() => navigate(PATHS.search)}
        searchLabel="Search your diary"
        right={
          <Segmented
            label="Diary view"
            options={DIARY_VIEWS}
            value="week"
            onChange={(v) => {
              if (v === 'day') navigate(diaryDayPath(dayForWeek(weekStart, today), today), { replace: true });
            }}
          />
        }
      />
      <DateSwitcher
        prevLabel={canGoBack ? neighbourLabel(prev, thisWeek, -1) : undefined}
        label={weekTitle(weekStart, thisWeek)}
        nextLabel={isThisWeek ? undefined : neighbourLabel(next, thisWeek, 1)}
        onPrev={canGoBack ? () => goToWeek(prev) : undefined}
        onNext={isThisWeek ? undefined : () => goToWeek(next)}
      />

      {viewingCurrent && current ? (
        <div className={styles.bannerWrap}>
          <Banner tone="accent" actionLabel="Switch back" onPress={() => setUnder('atTheTime')}>
            Viewing {weekInline(weekStart, thisWeek)} under {current.goal.name}. Your meals haven&apos;t changed.
          </Banner>
        </div>
      ) : null}

      {!view || !budget ? (
        <div className={styles.loading}>
          <SkeletonList count={3} label="Loading the week" />
        </div>
      ) : (
        <>
          <Card radius="lg" padding="16px 18px" className={styles.barsCard}>
            <WeekBars bars={weekBarsFor(budget)} targetKcal={lineTarget} height={96} ariaLabel={weekBarsLabel(budget)} />
            <div className={styles.barsCaptions}>
              <span>{targetCaption(targets)}</span>
              {lineTarget !== null ? (
                budget.savedKcal >= 0 ? (
                  <span>
                    {isThisWeek ? 'Saved so far' : 'Saved'} <b className={styles.saved}>{fmtSigned(budget.savedKcal)}</b>
                  </span>
                ) : (
                  <span>
                    {isThisWeek ? 'Over so far' : 'Over'} <b className={styles.over}>{fmtSigned(-budget.savedKcal)}</b>
                  </span>
                )
              ) : null}
            </div>
          </Card>

          <Card radius="card" padding="4px 14px" className={styles.rowsCard}>
            <h2 className="sr-only">Days</h2>
            {budget.days.map((d) => (
              <DayRow
                key={d.day}
                day={d}
                makanDay={budget.makanDay}
                switchedTo={switchedTo.get(d.day)}
                onOpen={compareDays(d.day, today) <= 0 ? () => navigate(diaryDayPath(d.day, today)) : undefined}
              />
            ))}
          </Card>

          <div className={styles.viewUnder}>
            <span aria-hidden="true">View under</span>
            <Segmented label="View under" options={VIEW_UNDER} value={under} onChange={setUnder} tone="inset" />
          </div>
        </>
      )}
    </div>
  );
}

