import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { CategoryList } from '@/components/CategoryBar/CategoryBar';
import { InsightCard } from '@/components/InsightCard/InsightCard';
import { MetricRow, MetricTile, type MetricTone } from '@/components/MetricTile/MetricTile';
import { RecurringList } from '@/components/RecurringRow/RecurringRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { TargetSuggestionCard } from '@/components/TargetSuggestionCard/TargetSuggestionCard';
import { TimingGrid } from '@/components/TimingGrid/TimingGrid';
import { TopBar } from '@/components/TopBar/TopBar';
import { UnlockList } from '@/components/UnlockProgress/UnlockProgress';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useNow } from '@/db/hooks';
import { clearFeedback, recordFeedback, useInsights, type InsightsView, type Undo } from '@/db/insightsData';
import { useTargetView, type TargetView } from '@/db/targetSuggestion';
import { fmtClock, fmtInt, fmtKg, fmtKgDelta, fmtRm, fmtSigned, roundTo10 } from '@/domain/format';
import { fmtHours, type RankedInsight } from '@/domain/insights';
import { targetCardModel } from './targetModel';
import { useTargetDecisions } from './useTargetDecisions';
import styles from './InsightsScreen.module.css';

interface Dismissed {
  insight: RankedInsight;
  index: number;
  undo: Undo;
}

function budgetTile(view: InsightsView): { label: string; value: string; tone: MetricTone; sub: string } {
  const { budget, savedSoFarKcal } = view.tiles;
  if (budget) {
    const label = view.periodLabel === 'this week' ? 'This week' : 'Last week';
    if (budget.overKcal > 0) return { label, value: fmtSigned(budget.overKcal), tone: 'over', sub: 'over plan' };
    if (budget.overKcal < 0) return { label, value: fmtSigned(budget.overKcal), tone: 'good', sub: 'under plan' };
    return { label, value: '0', tone: 'neutral', sub: 'on plan' };
  }
  const saved = savedSoFarKcal ?? 0;
  return { label: 'This week', value: fmtSigned(saved), tone: saved > 0 ? 'good' : saved < 0 ? 'over' : 'neutral', sub: saved < 0 ? 'over so far' : 'saved so far' };
}

function trendTone(change: number | null, pace: number): MetricTone {
  if (change === null || Math.abs(change) < 0.05) return 'neutral';
  return (pace > 0 && change < 0) || (pace < 0 && change > 0) ? 'good' : 'neutral';
}

function ReviewCard({ view }: { view: InsightsView }) {
  const navigate = useNavigate();
  const { review } = view;
  if (!review.available) return null;
  const open = () => navigate(`${PATHS.weekly}?week=${review.weekStart}`);
  if (review.seen) {
    return (
      <button type="button" className={[styles.review, styles.reviewSeen].join(' ')} onClick={open}>
        <span>
          <span className={styles.reviewLabel}>{review.rangeLabel}</span>
          <span className={styles.reviewTitle}>Last week's review</span>
        </span>
        <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className={styles.review} onClick={open}>
      <span>
        <span className={styles.reviewLabel}>{review.sundayNight ? 'Sunday night' : `Last week · ${review.rangeLabel}`}</span>
        <span className={styles.reviewTitle}>Your weekly review is ready</span>
      </span>
      <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function TopInsights({ view }: { view: InsightsView }) {
  const { open } = useSheet();
  const [dismissed, setDismissed] = useState<Dismissed[]>([]);

  const live = view.top.filter((i) => !dismissed.some((d) => d.insight.ruleId === i.ruleId));
  const cards: { insight: RankedInsight; dismissed?: Dismissed }[] = live.map((insight) => ({ insight }));
  for (const d of [...dismissed].sort((a, b) => a.index - b.index)) cards.splice(Math.min(d.index, cards.length), 0, { insight: d.insight, dismissed: d });

  const notForMe = async (insight: RankedInsight, index: number) => {
    const undo = await recordFeedback(insight.ruleId, 'notForMe', view.today);
    setDismissed((list) => [...list.filter((d) => d.insight.ruleId !== insight.ruleId), { insight, index, undo }]);
  };
  const undoDismiss = async (d: Dismissed) => {
    await d.undo();
    setDismissed((list) => list.filter((x) => x.insight.ruleId !== d.insight.ruleId));
  };
  const toggleUseful = async (insight: RankedInsight) => {
    if (view.feedback[insight.ruleId]?.feedback === 'useful') await clearFeedback(insight.ruleId);
    else await recordFeedback(insight.ruleId, 'useful', view.today);
  };

  if (cards.length === 0) {
    return <p className={styles.quiet}>Nothing stands out yet. Keep logging and patterns will show here.</p>;
  }
  return (
    <div className={styles.stack}>
      {cards.map(({ insight, dismissed: d }, index) => (
        <InsightCard
          key={insight.ruleId}
          headline={insight.headline}
          evidence={insight.evidence}
          linkLabel={insight.linkLabel || undefined}
          onLink={insight.evidenceEntries.length > 0 ? () => open('evidence', { rule: insight.ruleId }) : undefined}
          tryText={insight.tryText}
          meta={insight.meta}
          useful={view.feedback[insight.ruleId]?.feedback === 'useful'}
          onUseful={() => void toggleUseful(insight)}
          onNotForMe={() => void notForMe(insight, index)}
          dismissed={d !== undefined}
          onUndo={d ? () => void undoDismiss(d) : undefined}
        />
      ))}
    </div>
  );
}

function PlaceList({ view }: { view: InsightsView }) {
  const places = view.places.slice(0, 4);
  if (places.length === 0) return null;
  return (
    <div className={styles.places}>
      <h3 className={styles.cardLabel}>By Place</h3>
      <ul className={styles.placeList}>
        {places.map((p) => (
          <li key={p.placeId} className={styles.placeRow}>
            <span className={styles.placeName}>{p.name}</span>
            <span className={styles.placeNumbers}>
              <b>{fmtInt(roundTo10(p.kcal))}</b> kcal{p.spendRm > 0 ? ` · ${fmtRm(p.spendRm)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhenYouAte({ view }: { view: InsightsView }) {
  const { timing } = view;
  const headerLeft = timing.averageWindowHours === null ? 'Average window —' : `Average window ${fmtHours(timing.averageWindowHours)}`;
  const headerRight = timing.earlyRead ? `Early read · ${fmtInt(timing.completeDays)} days` : 'This week';
  const late = timing.rows.filter((r) => r.dots.some((d) => d.late)).length;
  return (
    <TimingGrid
      className={styles.inset}
      rows={timing.rows}
      headerLeft={headerLeft}
      headerRight={headerRight}
      axisLabels={[fmtClock(timing.rolloverHour * 60, { compact: true }), 'noon', '6pm', 'midnight']}
      ariaLabel={`${headerLeft}. Late meals on ${fmtInt(late)} days this week.`}
    />
  );
}

/** C45 in compact form, first under the TopBar while a target suggestion waits (not kept). */
function TargetCard({ target }: { target: TargetView }) {
  const navigate = useNavigate();
  const now = useNow();
  const { approve, keep, busy } = useTargetDecisions(target);
  const card = target.check.kind === 'suggestion' ? targetCardModel(target, { now, variant: 'compact' }) : undefined;
  if (!card) return null;
  return (
    <TargetSuggestionCard
      className={styles.target}
      {...card.props}
      onApprove={() => void approve(target, 'suggested', now)}
      onKeep={() => void keep(target)}
      onDetails={() => navigate(PATHS.target)}
      busy={busy}
    />
  );
}

/** @design S31 Insights — this week's numbers, top 3, where calories came from, timing, unlocks. */
export default function InsightsScreen() {
  const view = useInsights();
  const target = useTargetView();

  if (!view) {
    return (
      <div className={styles.screen}>
        <TopBar title="Insights" />
        <div className={styles.loading}>
          <SkeletonList count={3} label="Loading insights" />
        </div>
      </div>
    );
  }

  const budget = budgetTile(view);
  const { tiles } = view;
  const locked = view.unlocks.filter((u) => u.have < u.need);

  return (
    <div className={styles.screen}>
      <TopBar title="Insights" right={<span className={styles.caption}>{view.headerLabel}</span>} />

      {target ? <TargetCard target={target} /> : null}

      <MetricRow className={styles.tiles}>
        <MetricTile label={budget.label} value={budget.value} tone={budget.tone} sub={budget.sub} />
        <MetricTile
          label="Trend"
          value={tiles.trendChangeKg === null ? '—' : fmtKgDelta(tiles.trendChangeKg)}
          tone={trendTone(tiles.trendChangeKg, tiles.paceKgPerWeek)}
          sub={tiles.latestTrendKg === undefined ? 'no weigh-ins yet' : `${fmtKg(tiles.latestTrendKg)} now`}
        />
        <MetricTile label="Complete" value={`${fmtInt(tiles.complete.done)} of ${fmtInt(tiles.complete.of)}`} sub="days logged" />
      </MetricRow>

      <ReviewCard view={view} />

      {view.early ? (
        <div className={styles.early}>
          <h2 className={['t-insight', styles.earlyTitle].join(' ')}>More insights unlock as you log</h2>
          <p className={styles.earlyBody}>
            Your budget and where your calories came from show from day 1. Patterns, recurring calories and your first weekly review start on day 7.
          </p>
        </div>
      ) : (
        <>
          <SectionHeading>Top 3 this week</SectionHeading>
          <TopInsights view={view} />
        </>
      )}

      {view.categories.length > 0 ? (
        <>
          <SectionHeading>Where it came from</SectionHeading>
          <CategoryList
            className={styles.inset}
            label="Where it came from"
            items={view.categories.map((c) => ({ name: c.name, pct: c.pct, highlighted: c.id === view.highlightCategory }))}
          />
          <PlaceList view={view} />
        </>
      ) : null}

      {view.recurring.length > 0 ? (
        <>
          <SectionHeading>Recurring calories</SectionHeading>
          <RecurringList
            className={styles.inset}
            label="Recurring calories"
            items={view.recurring.slice(0, 4).map((r) => ({
              key: r.key,
              name: r.name,
              frequencyLabel: `~${fmtInt(r.perWeek)} a week`,
              kcalLabel: `≈ ${fmtInt(roundTo10(r.kcalPerWeek))}`,
            }))}
          />
        </>
      ) : null}

      {!view.early ? (
        <>
          <SectionHeading>When you ate</SectionHeading>
          <WhenYouAte view={view} />
        </>
      ) : null}

      {locked.length > 0 ? (
        <>
          <SectionHeading>Unlocks as you log</SectionHeading>
          <UnlockList className={styles.inset} items={view.unlocks} />
        </>
      ) : null}
    </div>
  );
}
