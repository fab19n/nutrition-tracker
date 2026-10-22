import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, Utensils } from 'lucide-react';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { Banner } from '@/components/Banner/Banner';
import { DayStatusBadge } from '@/components/DayStatusBadge/DayStatusBadge';
import { DayTimeline } from '@/components/DayTimeline/DayTimeline';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { MealRow } from '@/components/MealRow/MealRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { DateSwitcher, TopBar } from '@/components/TopBar/TopBar';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { deleteMeal, duplicateMeal } from '@/db/actions';
import { useMealThumbUrl } from '@/db/diary';
import {
  useCheckIn,
  useDaySummary,
  useNow,
  usePlaces,
  useProfile,
  useToday,
  useWeekBudget,
  useWeightTrend,
  useWorkouts,
} from '@/db/hooks';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, weekStartOf } from '@/domain/day';
import { fmtApprox, fmtInt, fmtKcal, fmtKg, fmtRm, fmtSigned, fmtTime, fmtWeekday, roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { TimingTagKind } from '@/domain/timing';
import type { LogicalDay, MealLog, Workout } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { usePendingMealIds } from '@/sync/hooks';
import {
  DIARY_VIEWS,
  INTENSITY_LABEL,
  WORKOUT_LABEL,
  dayBadgeFor,
  dayTitle,
  diaryWeekPath,
  kgNumber,
  parseDayParam,
  timelineFor,
} from './diaryModel';
import { timingDayPath } from '@/screens/Insights/timingDetailModel';
import styles from './Diary.module.css';

function mealKcalLabel(meal: MealLog): string {
  return fmtApprox(roundTo10(mealMacros(meal).kcal));
}

interface DiaryMealRowProps {
  meal: MealLog;
  tag: TimingTagKind | undefined;
  placeName: string | undefined;
  tz: string;
  /** Still queued here while sync is stuck (usePendingMealIds). */
  pending: boolean;
  onOpen: (meal: MealLog) => void;
  onDuplicate: (meal: MealLog) => void;
  onDelete: (meal: MealLog) => void;
}

/** One ledger row: MealRow with its photo thumbnail (this device's, or the one synced from another) and price. */
function DiaryMealRow({ meal, tag, placeName, tz, pending, onOpen, onDuplicate, onDelete }: DiaryMealRowProps) {
  const thumbUrl = useMealThumbUrl(meal);
  return (
    <MealRow
      slotLabel={SLOT_LABEL[meal.slot]}
      timeLabel={fmtTime(meal.eatenAt, tz)}
      placeName={placeName}
      priceLabel={meal.priceRm !== undefined ? fmtRm(meal.priceRm) : undefined}
      name={meal.name}
      kcalLabel={mealKcalLabel(meal)}
      tag={meal.isGuess ? undefined : tag}
      thumbUrl={thumbUrl}
      finished={meal.finished}
      pending={pending}
      isGuess={meal.isGuess === true}
      animateIn={false}
      onPress={() => onOpen(meal)}
      onDuplicate={() => onDuplicate(meal)}
      onDelete={() => onDelete(meal)}
    />
  );
}

function WorkoutRow({ workout }: { workout: Workout }) {
  return (
    <Card radius="card" padding="12px 14px" className={styles.between}>
      <div>
        <div className={styles.caption}>Workout</div>
        <div className={styles.rowTitle}>
          {WORKOUT_LABEL[workout.type]} · {fmtInt(workout.minutes)} min · {INTENSITY_LABEL[workout.intensity]}
        </div>
      </div>
      <span className={styles.positive}>
        {fmtSigned(workout.netKcal)} kcal<span className="sr-only"> added to the budget</span>
      </span>
    </Card>
  );
}

/** @design S12 Diary day — status card with the day's timeline, then meals, weight and workouts. */
export default function DiaryDayScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sheet = useSheet();
  const showToast = useUiStore((s) => s.showToast);
  // A double tap on Duplicate logs one copy (per meal).
  const inFlight = useInFlight();

  const profile = useProfile();
  const today = useToday();
  const now = useNow();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const rolloverHour = profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const earliest = profile?.startedOn;
  const day = parseDayParam(params.get('day'), today, earliest);
  const isToday = day === today;

  const loadedSummary = useDaySummary(day);
  // While another day loads, the hook still holds the previous one.
  const summary = loadedSummary?.day === day ? loadedSummary : undefined;
  const week = useWeekBudget(day);
  const weights = useWeightTrend();
  const workouts = useWorkouts(weekStartOf(day));
  const places = usePlaces();
  const checkIn = useCheckIn();
  const pendingMealIds = usePendingMealIds();

  const placeNames = useMemo(() => new Map((places ?? []).map((p) => [p.id, p.name])), [places]);

  const goToDay = (next: LogicalDay) => {
    const search = new URLSearchParams(params);
    if (next === today) search.delete('day');
    else search.set('day', next);
    setParams(search, { replace: true });
  };

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const canGoBack = !earliest || compareDays(prev, earliest) >= 0;
  const canGoForward = compareDays(next, today) <= 0;

  const openMeal = (meal: MealLog) => navigate(PATHS.entry(meal.id));
  const duplicate = (meal: MealLog) =>
    inFlight.run(`duplicate:${meal.id}`, async () => {
      const copy = await duplicateMeal(meal.id);
      if (!copy) return;
      showToast(`Logged again today · ${mealKcalLabel(copy)} kcal`, () => {
        void deleteMeal(copy.id);
      });
    });
  const remove = async (meal: MealLog) => {
    const undo = await deleteMeal(meal.id);
    showToast('Entry deleted', () => {
      void undo();
    });
  };

  const budgetDay = week?.budget.days.find((d) => d.day === day);
  const paused = budgetDay?.kind === 'paused' || summary?.goal?.paused === true;
  const status = summary?.record?.status ?? null;
  const badge = dayBadgeFor({ day, today, status, paused });
  const baseKcal = budgetDay && !paused ? budgetDay.baseKcal : summary?.goal && !paused ? summary.goal.version.dailyKcal : undefined;

  const dayWeights = (weights?.entries ?? []).filter((w) => w.logicalDay === day);
  const weighIn = dayWeights[0];
  const trendPoint = weights?.points.find((p) => p.day === day);
  const dayWorkouts = (workouts ?? []).filter((w) => w.logicalDay === day);
  const guesses = (summary?.meals ?? []).filter((m) => m.isGuess);
  const waitingForCheckIn = checkIn?.needed === true && (checkIn.day === day || checkIn.queue.includes(day));

  const timeline = summary
    ? timelineFor({ day, isToday, meals: summary.meals, tags: summary.tags, window: summary.window, now, tz, rolloverHour })
    : undefined;

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
            value="day"
            onChange={(view) => {
              if (view === 'week') navigate(diaryWeekPath(weekStartOf(day), weekStartOf(today)), { replace: true });
            }}
          />
        }
      />
      <DateSwitcher
        prevLabel={canGoBack ? fmtWeekday(prev) : undefined}
        label={dayTitle(day, today)}
        nextLabel={fmtWeekday(next)}
        onPrev={canGoBack ? () => goToDay(prev) : undefined}
        onNext={canGoForward ? () => goToDay(next) : undefined}
      />

      {!summary || !timeline ? (
        <div className={styles.loading}>
          <SkeletonList count={2} label="Loading your diary" />
        </div>
      ) : (
        <>
          <Card radius="card" padding="12px 16px" className={styles.statusCard}>
            <div className={styles.between}>
              <DayStatusBadge status={badge} size="md" />
              <span className={styles.dayTotal}>
                {fmtInt(summary.kcal)}{' '}
                <span className={styles.dayTotalOf}>
                  {baseKcal !== undefined ? `of ${fmtKcal(baseKcal)}` : paused ? 'kcal · budget off' : 'kcal'}
                </span>
              </span>
            </div>
            <DayTimeline
              className={styles.timeline}
              windowStartPct={timeline.windowStartPct}
              windowEndPct={timeline.windowEndPct}
              dots={timeline.dots}
              nowPct={timeline.nowPct}
              captions={timeline.captions}
              header={timeline.header}
              ariaLabel={timeline.ariaLabel}
            />
            {badge !== 'paused' && summary.meals.some((m) => !m.isGuess) ? (
              <button type="button" className={styles.timingLink} onClick={() => navigate(timingDayPath(day, today))}>
                Timing details
                <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : null}
          </Card>

          {badge === 'notCounted' ? (
            <div className={styles.bannerWrap}>
              <Banner tone="neutral">
                <b>Not counted.</b> This day counts as exactly {baseKcal !== undefined ? fmtInt(baseKcal) : 'your target'}, whatever was
                logged. Missed meals never count as calories saved.
              </Banner>
            </div>
          ) : null}
          {badge === 'guess' && guesses.length > 0 ? (
            <div className={styles.bannerWrap}>
              <Banner tone="neutral">
                <b>Guess added.</b> {guesses.map((g) => `${g.name} (${mealKcalLabel(g)})`).join(', ')} fills in what wasn&apos;t logged.
                It counts toward the budget, not maintenance or timing insights.
              </Banner>
            </div>
          ) : null}
          {badge === 'unconfirmed' ? (
            <div className={styles.bannerWrap}>
              <Banner
                tone="amber"
                actionLabel={waitingForCheckIn ? 'Check' : undefined}
                // The sheet asks about the day on screen first (it reads this page's ?day=).
                onPress={waitingForCheckIn ? () => sheet.open('checkin') : undefined}
              >
                <b>Not confirmed yet.</b> Savings from this day wait for the check-in.
              </Banner>
            </div>
          ) : null}
          {badge === 'paused' ? (
            <div className={styles.bannerWrap}>
              <Banner tone="neutral">
                <b>Paused.</b> Logging is optional, and this day stays out of trends.
              </Banner>
            </div>
          ) : null}

          <section className={styles.list} aria-labelledby="diary-entries">
            <h2 id="diary-entries" className="sr-only">
              Entries
            </h2>
            {summary.meals.length === 0 ? (
              isToday ? (
                <EmptyState
                  icon={<Utensils />}
                  headline="Nothing logged yet today"
                  body="A rough guess is fine. Type it like a message."
                  actionLabel="Log a meal"
                  onAction={() => sheet.open('log')}
                />
              ) : (
                <EmptyState icon={<Utensils />} headline="Nothing logged this day" body="Meals you log for this day show up here." />
              )
            ) : (
              <div className={[styles.meals, badge === 'notCounted' ? styles.dimmed : ''].filter(Boolean).join(' ')}>
                {summary.meals.map((meal) => (
                  <DiaryMealRow
                    key={meal.id}
                    meal={meal}
                    tag={summary.tags[meal.id]}
                    placeName={meal.placeId ? placeNames.get(meal.placeId) : undefined}
                    tz={tz}
                    pending={pendingMealIds.has(meal.id)}
                    onOpen={openMeal}
                    onDuplicate={(m) => void duplicate(m)}
                    onDelete={(m) => void remove(m)}
                  />
                ))}
              </div>
            )}

            {weighIn ? (
              <Card radius="card" padding="12px 14px" className={styles.between} onPress={() => navigate(PATHS.weight)}>
                <div>
                  <div className={styles.caption}>Weight · {fmtTime(weighIn.measuredAt, tz)}</div>
                  <div className={styles.rowTitle}>{fmtKg(weighIn.kg)}</div>
                </div>
                {trendPoint ? <span className={styles.positive}>Trend {kgNumber(trendPoint.trendKg)}</span> : null}
              </Card>
            ) : isToday ? (
              <button type="button" className={styles.dashedRow} onClick={() => navigate(PATHS.weight)}>
                No weigh-in today
              </button>
            ) : null}

            {dayWorkouts.length > 0 ? (
              dayWorkouts.map((w) => <WorkoutRow key={w.id} workout={w} />)
            ) : (
              <div className={styles.dashedNote}>{isToday ? 'No workout today' : 'No workout this day'}</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
