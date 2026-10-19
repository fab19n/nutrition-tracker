import { useId, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { InsightCard } from '@/components/InsightCard/InsightCard';
import { OptionGroup } from '@/components/OptionRow/OptionRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { WeekBars, type WeekBar } from '@/components/WeekBars/WeekBars';
import { Button } from '@/components/ui/Button';
import { setWeeklyFocus } from '@/db/actions';
import { useReviewWeekStart, useWeeklyReview, type WeeklyReviewView } from '@/db/insightsData';
import { useToday } from '@/db/hooks';
import { compareDays, weekStartOf } from '@/domain/day';
import { fmtClock, fmtDayLetter, fmtInt, fmtKgDelta, fmtSigned } from '@/domain/format';
import { fmtWeekdayLong } from '@/domain/insights';
import type { LogicalDay } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import styles from './WeeklyReviewScreen.module.css';

const STEPS = 3;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Within this of the plan's weekly change reads as "on plan". */
const ON_PLAN_KG = 0.2;

function weekFromParam(value: string | null): LogicalDay | undefined {
  if (!value || !DAY_PATTERN.test(value)) return undefined;
  try {
    return weekStartOf(value);
  } catch {
    return undefined;
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

function barsOf(review: WeeklyReviewView): WeekBar[] {
  return (review.budget?.days ?? []).map((d) => {
    const bar: WeekBar = {
      label: fmtDayLetter(d.day),
      kind: d.kind,
      valueKcal: d.isFinished || d.kind === 'paused' ? d.eatenKcal : d.plannedKcal,
      isToday: d.isToday,
    };
    if (d.kind === 'today') bar.fillKcal = d.eatenKcal;
    return bar;
  });
}

function trendSub(change: number | null, pace: number): string {
  if (change === null) return 'no weigh-ins that week';
  const planned = -pace;
  if (Math.abs(change - planned) <= ON_PLAN_KG) return 'on plan';
  return pace === 0 ? 'plan: steady' : `plan ${fmtKgDelta(planned)}`;
}

function WeekCard({ review }: { review: WeeklyReviewView }) {
  const budget = review.budget;
  const over = budget?.overKcal ?? 0;
  const change = review.trend.changeKg;
  const pace = review.trend.paceKgPerWeek;
  const trendGood = change !== null && ((pace > 0 && change < 0) || (pace < 0 && change > 0));
  const bars = barsOf(review);
  const overDays = bars.filter((b) => b.kind === 'over').length;
  const notCounted = review.notCountedDays.map(fmtWeekdayLong);
  const focus = review.lastFocus;

  return (
    <section className={styles.card} aria-label={`Your week, ${review.rangeLabel}`}>
      <div className={styles.range}>{review.rangeLabel}</div>
      {review.firstWeek && review.learned ? (
        <Learned review={review} />
      ) : (
        <div className={styles.figures}>
          <div>
            <div className={styles.figureLabel}>Budget</div>
            <div className={['t-metric-lg', over > 0 ? styles.amber : styles.good].join(' ')}>{budget ? fmtSigned(over) : '—'}</div>
            <div className={styles.figureSub}>{budget ? `${fmtInt(budget.countedKcal)} of ${fmtInt(budget.budgetKcal)}` : 'no budget that week'}</div>
          </div>
          <div>
            <div className={styles.figureLabel}>Trend</div>
            <div className={['t-metric-lg', trendGood ? styles.good : ''].filter(Boolean).join(' ')}>{change === null ? '—' : fmtKgDelta(change)}</div>
            <div className={styles.figureSub}>{trendSub(change, pace)}</div>
          </div>
        </div>
      )}
      {bars.length > 0 ? (
        <WeekBars
          className={styles.bars}
          bars={bars}
          targetKcal={budget?.targetKcal ?? null}
          height={72}
          ariaLabel={`${review.rangeLabel}: ${fmtInt(overDays)} ${overDays === 1 ? 'day' : 'days'} over target${notCounted.length > 0 ? `, ${joinNames(notCounted)} not counted` : ''}`}
        />
      ) : null}
      <p className={styles.summary}>
        {fmtInt(review.completeDays)} of {fmtInt(review.daysInUse)} days complete.
        {notCounted.length > 0 ? ` ${joinNames(notCounted)} ${notCounted.length === 1 ? "wasn't" : "weren't"} counted.` : ''}
        {focus ? (
          focus.total > 0 ? (
            <>
              {' '}
              Last focus, {lowerFirst(focus.label)}: <b className={styles.strong}>{fmtInt(focus.done)} of {fmtInt(focus.total)}</b>.
            </>
          ) : (
            ` Last focus, ${lowerFirst(focus.label)}: nothing to count that week.`
          )
        ) : null}
      </p>
    </section>
  );
}

/** Day-7 version: usual times, top Places and meals, no judging. */
function Learned({ review }: { review: WeeklyReviewView }) {
  const learned = review.learned;
  if (!learned) return null;
  const rows: { label: string; value: string }[] = [];
  if (learned.usualTimes.length > 0) {
    rows.push({
      label: 'Your usual times',
      value: learned.usualTimes.map((t) => `${SLOT_LABEL[t.slot]} around ${fmtClock(t.minutes, { compact: true })}`).join(' · '),
    });
  }
  if (learned.topPlaces.length > 0) {
    rows.push({ label: 'Where you eat most', value: learned.topPlaces.map((p) => `${p.name} (${fmtInt(p.visits)})`).join(' · ') });
  }
  if (learned.topFoods.length > 0) {
    rows.push({ label: 'What you have most', value: learned.topFoods.map((f) => `${f.name} (${fmtInt(f.count)})`).join(' · ') });
  }
  return (
    <div className={styles.learned}>
      <h2 className={['t-sheet-title', styles.learnedTitle].join(' ')}>What we learned about you</h2>
      <dl className={styles.learnedList}>
        {rows.map((row) => (
          <div key={row.label} className={styles.learnedRow}>
            <dt className={styles.figureLabel}>{row.label}</dt>
            <dd className={styles.learnedValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** @design S33 Weekly review — your week, top 3, pick one thing to try next week. */
export default function WeeklyReviewScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const defaultWeek = useReviewWeekStart();
  const today = useToday();
  const weekStart = weekFromParam(params.get('week')) ?? defaultWeek;
  const review = useWeeklyReview(weekStart);
  const [step, setStep] = useState(1);
  const [pick, setPick] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const pickHeadingId = useId();

  const back = () => {
    if (step > 1) setStep(step - 1);
    else if (location.key !== 'default') goBack(navigate);
    else navigate(PATHS.insights, { replace: true });
  };
  const header = (
    <SubScreenHeader
      title="Your week"
      onBack={back}
      backLabel={step > 1 ? 'Back to the previous step' : 'Back to Insights'}
      right={<span aria-live="polite">{`Step ${fmtInt(step)} of ${fmtInt(STEPS)}`}</span>}
    />
  );
  const progress = (
    <div className={styles.progress} role="progressbar" aria-label="Weekly review" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step}>
      {Array.from({ length: STEPS }, (_, i) => (
        <span key={i} className={[styles.segment, i < step ? styles.segmentOn : ''].filter(Boolean).join(' ')} />
      ))}
    </div>
  );

  if (!review) {
    return (
      <div className={styles.screen}>
        {header}
        {progress}
        <div className={styles.loading}>
          <SkeletonList count={2} label="Loading your week" />
        </div>
      </div>
    );
  }

  if (review.daysInUse === 0) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.loading}>
          <EmptyState headline="Your first review comes on day 7" body="Log your meals this week, even roughly. The review sums it up on Sunday night." />
        </div>
      </div>
    );
  }

  const chosen = pick ?? review.currentFocus?.ruleId;
  const option = review.focusOptions.find((o) => o.ruleId === chosen);

  const done = async () => {
    if (!option || saving) return;
    setSaving(true);
    try {
      await setWeeklyFocus(review.focusWeekStart, { label: option.label, sub: option.sub, ruleId: option.ruleId });
      // Sunday night's review picks for the week ahead: Today shows it from Monday.
      const startsLater = compareDays(review.focusWeekStart, weekStartOf(today)) > 0;
      showToast(startsLater ? "Got it. It's on your Today screen from Monday" : "Got it. It's on your Today screen");
      // Replaces the review, so the phone's back button from Today goes to Insights, not to step 1 again.
      navigate(PATHS.today, { replace: true });
    } catch {
      setSaving(false);
      showToast("Couldn't save your pick. Try again.");
    }
  };

  return (
    <div className={styles.screen}>
      {header}
      {progress}

      {step === 1 ? (
        <>
          <WeekCard review={review} />
          <div className={styles.actions}>
            <Button onClick={() => setStep(2)}>Next · top 3</Button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className={styles.stack}>
            {review.top.length > 0 ? (
              review.top.map((insight) => (
                <InsightCard
                  key={insight.ruleId}
                  headingLevel="h2"
                  headline={insight.headline}
                  evidence={insight.evidence}
                  tryText={insight.tryText}
                  footer={false}
                />
              ))
            ) : (
              <EmptyState headline="Nothing stood out this week" body="That's fine. Pick one small thing to try anyway, or keep the same rhythm." />
            )}
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setStep(3)}>Next · pick one thing</Button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h2 id={pickHeadingId} className={['t-sheet-title', styles.pickTitle].join(' ')}>
            Pick one thing to try next week
          </h2>
          <div className={styles.options}>
            <OptionGroup
              labelledBy={pickHeadingId}
              size="lg"
              options={review.focusOptions.map((o) => ({ id: o.ruleId, label: o.label, sub: o.sub }))}
              value={chosen}
              onChange={setPick}
            />
          </div>
          <div className={styles.actions}>
            <Button onClick={() => void done()} disabled={!option || saving}>
              Got it, put it on Today
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
