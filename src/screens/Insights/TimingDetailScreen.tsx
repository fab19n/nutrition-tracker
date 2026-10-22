import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, CircleCheck, Moon } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { Banner } from '@/components/Banner/Banner';
import { DayTimeline } from '@/components/DayTimeline/DayTimeline';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { TimingGrid } from '@/components/TimingGrid/TimingGrid';
import { TimingTag } from '@/components/TimingTag/TimingTag';
import { DateSwitcher, SubScreenHeader } from '@/components/TopBar/TopBar';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useNow, useProfile, useToday } from '@/db/hooks';
import { useTimingDetail, type TimingDetailView } from '@/db/timingDetail';
import { addDays, compareDays } from '@/domain/day';
import { fmtWeekday } from '@/domain/format';
import { dayTitle, parseDayParam, timelineFor } from '@/screens/Diary/diaryModel';
import {
  NO_MEALS_NOTE,
  PAUSED_NOTE,
  earlyNote,
  legendItems,
  mealRows,
  metricRows,
  numbersHeading,
  sleepExplainer,
  weekLabels,
  type LegendItem,
  type MetricRow,
} from './timingDetailModel';
import styles from './TimingDetail.module.css';

function LegendMark({ item }: { item: LegendItem }) {
  switch (item.key) {
    case 'late':
      return <span className={[styles.mark, styles.markLate].join(' ')} aria-hidden="true" />;
    case 'window':
      return <span className={[styles.mark, styles.markWindow].join(' ')} aria-hidden="true" />;
    case 'sleep':
      return (
        <span className={[styles.mark, styles.markSleep].join(' ')} aria-hidden="true">
          <Moon size={9} strokeWidth={2.5} />
        </span>
      );
    default:
      return <span className={[styles.mark, styles.markOn].join(' ')} aria-hidden="true" />;
  }
}

function Metric({ row }: { row: MetricRow }) {
  const { status } = row;
  return (
    <li className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{row.label}</span>
        <span className={styles.metricValue}>{row.value}</span>
      </div>
      {row.sub ? <p className={styles.metricSub}>{row.sub}</p> : null}
      {status ? (
        <p className={[styles.status, status.tone === 'ok' ? styles.statusOk : status.tone === 'over' ? styles.statusOver : ''].filter(Boolean).join(' ')}>
          {status.tone === 'ok' ? <CircleCheck size={14} strokeWidth={2} aria-hidden="true" /> : null}
          {status.tone === 'over' ? <CircleAlert size={14} strokeWidth={2} aria-hidden="true" /> : null}
          <span>{status.text}</span>
        </p>
      ) : null}
    </li>
  );
}

function DayBody({ view, now }: { view: TimingDetailView; now: Date }) {
  const { summary } = view;
  const timeline = timelineFor({
    day: view.day,
    isToday: view.isToday,
    meals: summary.meals,
    tags: summary.tags,
    window: summary.window,
    now,
    tz: view.tz,
    rolloverHour: view.rolloverHour,
    ...(summary.record?.sleepAt ? { sleepAt: summary.record.sleepAt } : {}),
    expanded: true,
  });
  const legend = legendItems(view, timeline);
  const rows = metricRows(view);
  const meals = mealRows(view);
  const week = weekLabels(view);
  const early = earlyNote(view.completeDays);

  return (
    <>
      {view.earlyRead ? (
        <div className={styles.bannerWrap}>
          <Banner tone="accent">
            <b>{early.lead}</b> {early.rest}
          </Banner>
        </div>
      ) : null}
      {view.paused ? (
        <div className={styles.bannerWrap}>
          <Banner tone="neutral">
            <b>{PAUSED_NOTE.lead}</b> {PAUSED_NOTE.rest}
          </Banner>
        </div>
      ) : null}

      <Card radius="card" padding="12px 16px" className={styles.card}>
        <DayTimeline
          size="expanded"
          windowStartPct={timeline.windowStartPct}
          windowEndPct={timeline.windowEndPct}
          dots={timeline.dots}
          nowPct={timeline.nowPct}
          sleep={timeline.sleep}
          ticks={timeline.ticks}
          captions={timeline.captions}
          header={timeline.header}
          ariaLabel={timeline.ariaLabel}
        />
        {legend.length > 0 ? (
          <ul className={styles.legend} aria-label="Timeline key">
            {legend.map((item) => (
              <li key={item.key} className={styles.legendItem}>
                <LegendMark item={item} />
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {meals.length === 0 ? <p className={styles.quiet}>{NO_MEALS_NOTE}</p> : null}

      {rows.length > 0 ? (
        <>
          <SectionHeading>{numbersHeading(view.isToday)}</SectionHeading>
          <Card radius="card" padding="4px 16px" className={styles.card}>
            <ul className={styles.metrics} aria-label="Timing numbers">
              {rows.map((row) => (
                <Metric key={row.key} row={row} />
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {meals.length > 0 ? (
        <>
          <SectionHeading>Meals</SectionHeading>
          <Card radius="card" padding="4px 16px" className={styles.card}>
            <ul className={styles.meals} aria-label="Meals">
              {meals.map((meal) => (
                <li key={meal.id} className={styles.meal}>
                  <span className={styles.mealText}>
                    <span className={styles.mealName}>
                      <b className={styles.mealTime}>{meal.time}</b> {meal.name}
                    </span>
                    <span className={styles.mealSlot}>{meal.slot}</span>
                  </span>
                  {meal.tag ? <TimingTag kind={meal.tag} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      <SectionHeading>{week.heading}</SectionHeading>
      <TimingGrid
        className={styles.inset}
        rows={view.week.rows}
        headerLeft={week.headerLeft}
        headerRight={week.headerRight}
        axisLabels={week.axisLabels}
        ariaLabel={week.ariaLabel}
      />

      <Card radius="card" padding="14px 16px" className={[styles.card, styles.explainer].join(' ')}>
        <h2 className={['t-insight', styles.explainerTitle].join(' ')}>Going to sleep</h2>
        {sleepExplainer({ rules: view.rules, usualSleepLogicalMin: view.usualSleepLogicalMin, rolloverHour: view.rolloverHour }).map((text) => (
          <p key={text} className={styles.explainerText}>
            {text}
          </p>
        ))}
      </Card>
    </>
  );
}

/** @design S35 Timing detail — one day's timing against your goal's rules, the week's grid, and what Going to sleep does. Read-only. */
export default function TimingDetailScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const profile = useProfile();
  const today = useToday();
  const now = useNow();
  const earliest = profile?.startedOn;
  const day = parseDayParam(params.get('day'), today, earliest);

  const loaded = useTimingDetail(day);
  // While another day loads, the hook still holds the previous one.
  const view = loaded?.day === day ? loaded : undefined;

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.insights, { replace: true }));
  const goToDay = (next: string) => {
    const search = new URLSearchParams(params);
    if (next === today) search.delete('day');
    else search.set('day', next);
    setParams(search, { replace: true });
  };

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const canGoBack = !earliest || compareDays(prev, earliest) >= 0;
  const canGoForward = compareDays(next, today) <= 0;

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Timing" onBack={back} />
      <DateSwitcher
        prevLabel={canGoBack ? fmtWeekday(prev) : undefined}
        label={dayTitle(day, today)}
        nextLabel={fmtWeekday(next)}
        onPrev={canGoBack ? () => goToDay(prev) : undefined}
        onNext={canGoForward ? () => goToDay(next) : undefined}
      />
      {view ? (
        <DayBody view={view} now={now} />
      ) : (
        <div className={styles.loading}>
          <SkeletonList count={2} label="Loading timing" />
        </div>
      )}
    </div>
  );
}
