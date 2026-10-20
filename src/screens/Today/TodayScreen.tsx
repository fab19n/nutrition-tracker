import { useNavigate } from 'react-router';
import { Utensils } from 'lucide-react';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { Banner } from '@/components/Banner/Banner';
import { EmptySlot } from '@/components/EmptySlot/EmptySlot';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { GoalPill } from '@/components/GoalPill/GoalPill';
import { HeroCard } from '@/components/HeroCard/HeroCard';
import { isBehind, MacroBar, MacroRow } from '@/components/MacroBar/MacroBar';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { SleepTap } from '@/components/SleepTap/SleepTap';
import { TopBar } from '@/components/TopBar/TopBar';
import { WeeklyFocusCard } from '@/components/WeeklyFocusCard/WeeklyFocusCard';
import { deleteMeal, duplicateMeal, setSleepTap } from '@/db/actions';
import {
  useActiveGoal,
  useCheckIn,
  useDaySummary,
  useFestiveDaysInRange,
  useMealsInRange,
  useNow,
  usePlaces,
  useProfile,
  useProteinLeft,
  useToday,
  useWeekBudget,
} from '@/db/hooks';
import { useHasAnyMeal, useUsualSleepMinutes } from '@/db/today';
import { now as clockNow } from '@/domain/clock';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, minutesIntoLogicalDay, weekStartOf, zonedParts } from '@/domain/day';
import { focusProgress, focusRuleIdOf } from '@/domain/focus';
import { fmtApprox, fmtDayShort, fmtTime, roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { MealLog } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { usePendingMealIds } from '@/sync/hooks';
import { TodayMealRow } from './TodayMealRow';
import {
  checkInBanner,
  eatenCaption,
  goalPillLabel,
  heroAriaLabel,
  heroFigures,
  makanCaption,
  nextMainSlot,
  nudgeLine,
  sleepTapVisible,
  weekBarsFor,
} from './todayModel';
import styles from './TodayScreen.module.css';

/** @design S08 Today — what's left, what you've eaten and what's next. */
export default function TodayScreen() {
  const navigate = useNavigate();
  const { open } = useSheet();
  const showToast = useUiStore((s) => s.showToast);
  // A double tap on Duplicate logs one copy (per meal).
  const inFlight = useInFlight();

  const today = useToday();
  const now = useNow();
  const profile = useProfile();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const rolloverHour = profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);

  const active = useActiveGoal();
  const view = useWeekBudget();
  const summary = useDaySummary(today);
  const checkIn = useCheckIn();
  const proteinLeft = useProteinLeft();
  const festive = useFestiveDaysInRange(weekStart, weekEnd);
  const weekMeals = useMealsInRange(weekStart, weekEnd);
  const places = usePlaces();
  const usualSleep = useUsualSleepMinutes(today);
  const hasAnyMeal = useHasAnyMeal();
  const pendingMealIds = usePendingMealIds();

  const header = (
    <TopBar
      title="Today"
      subtitle={fmtDayShort(today)}
      right={active ? <GoalPill label={goalPillLabel(active, today)} onPress={() => navigate(PATHS.soon('goals'))} /> : undefined}
    />
  );

  if (!view || !summary || !active) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.placeholder} role="status">
          <span className="sr-only">Loading today</span>
        </div>
      </div>
    );
  }

  const { budget, version } = view;
  const paused = active.paused;
  const firstDay = hasAnyMeal === false;

  // Hero
  const figures = heroFigures({ view, paused, proteinLeft, festive });
  const closesAt = summary.window.closesAt;

  // Check-in banner
  const banner = checkIn ? checkInBanner(checkIn, today) : undefined;

  // Weekly focus
  const focus = view.plan?.focus;
  const ruleId = focusRuleIdOf(focus);
  const progress =
    ruleId && weekMeals ? focusProgress(ruleId, { meals: weekMeals, today, weekStart, tz, rolloverHour }) : undefined;

  // Meals and what's next
  const meals = summary.meals;
  const placeName = new Map((places ?? []).map((p) => [p.id, p.name]));
  const wall = zonedParts(now, tz);
  const nextSlot = nextMainSlot(meals, summary.baselines, wall.hour * 60 + wall.minute, rolloverHour);
  const proteinEaten = Math.round(summary.macros.proteinG);
  const nudge = nudgeLine({
    meals,
    proteinBehind: isBehind(proteinEaten, version.proteinG),
    proteinLeftG: version.proteinG - proteinEaten,
    nextSlot,
    closesAt,
    now,
    tz,
  });

  // Sleep tap
  const sleepAt = summary.record?.sleepAt;
  const nowLogical = minutesIntoLogicalDay(now, tz, rolloverHour);
  const sleepState: 'shown' | 'tapped' | null = sleepAt
    ? 'tapped'
    : usualSleep !== undefined && sleepTapVisible(nowLogical, usualSleep, rolloverHour)
      ? 'shown'
      : null;

  const handleDelete = async (meal: MealLog) => {
    try {
      const undo = await deleteMeal(meal.id);
      showToast(`Deleted · ${meal.name}`, () => void undo());
    } catch {
      showToast("Couldn't delete that. Try again.");
    }
  };

  const handleDuplicate = (meal: MealLog) =>
    inFlight.run(`duplicate:${meal.id}`, async () => {
      try {
        const copy = await duplicateMeal(meal.id);
        if (!copy) return;
        showToast(`Logged again · ${fmtApprox(roundTo10(mealMacros(copy).kcal))} kcal`, () => void deleteMeal(copy.id));
      } catch {
        showToast("Couldn't log that again. Try again.");
      }
    });

  return (
    <div className={styles.screen}>
      {header}

      {banner ? (
        <div className={styles.banner}>
          <Banner tone={banner.tone} actionLabel="Check" onPress={() => open('checkin')}>
            <b>{banner.lead}</b>
            {banner.rest ? ` ${banner.rest}` : null}
          </Banner>
        </div>
      ) : null}

      <HeroCard
        className={styles.hero}
        {...figures}
        bars={weekBarsFor(view, paused)}
        captionLeft={eatenCaption({ mealCount: meals.length, kcal: summary.kcal, closesAt, now, tz })}
        captionRight={paused ? undefined : makanCaption(budget)}
        onPress={() => open('budget')}
        ariaLabel={heroAriaLabel(figures, paused)}
      />

      {firstDay ? (
        <div className={styles.empty}>
          <h2 className="sr-only">Today&apos;s meals</h2>
          <EmptyState
            icon={<Utensils size={24} strokeWidth={2} />}
            headline="Log your first meal"
            body="A rough guess is fine."
            actionLabel="Log a meal"
            onAction={() => open('log')}
          />
        </div>
      ) : (
        <>
          <MacroRow className={styles.macros}>
            <MacroBar
              label="Protein"
              macro="protein"
              value={proteinEaten}
              target={version.proteinG}
              behind={isBehind(proteinEaten, version.proteinG)}
            />
            <MacroBar label="Carbs" macro="carbs" value={Math.round(summary.macros.carbsG)} target={version.carbsG} />
            <MacroBar label="Fat" macro="fat" value={Math.round(summary.macros.fatG)} target={version.fatG} />
          </MacroRow>

          {focus ? (
            <WeeklyFocusCard
              className={styles.focus}
              label={focus.label}
              progressLabel={progress?.label}
              progressDescription={progress?.description}
            />
          ) : null}

          <section className={styles.meals} aria-labelledby="today-meals">
            <h2 id="today-meals" className="sr-only">
              Today&apos;s meals
            </h2>
            {meals.map((meal) => (
              <TodayMealRow
                key={meal.id}
                meal={meal}
                placeName={meal.placeId ? placeName.get(meal.placeId) : undefined}
                tag={summary.tags[meal.id]}
                tz={tz}
                pending={pendingMealIds.has(meal.id)}
                onOpen={(m) => navigate(PATHS.entry(m.id))}
                onDuplicate={(m) => void handleDuplicate(m)}
                onDelete={(m) => void handleDelete(m)}
              />
            ))}
            {nextSlot ? <EmptySlot slotLabel={SLOT_LABEL[nextSlot]} onAction={() => navigate(PATHS.ideas)} /> : null}
          </section>

          {nudge ? <p className={styles.nudge}>{nudge}</p> : null}
        </>
      )}

      {sleepState ? (
        <div className={styles.sleep}>
          <SleepTap
            state={sleepState}
            timeLabel={sleepAt ? fmtTime(sleepAt, tz) : undefined}
            onTap={() => void setSleepTap(today, clockNow().toISOString())}
            onUndo={() => void setSleepTap(today, null)}
          />
        </div>
      ) : null}
    </div>
  );
}
