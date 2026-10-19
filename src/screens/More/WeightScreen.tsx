import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Trash2 } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { MetricRow, MetricTile, type MetricTone } from '@/components/MetricTile/MetricTile';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { WeightEntry } from '@/components/WeightEntry/WeightEntry';
import { WeightTrendChart, type WeightRange } from '@/components/WeightTrendChart/WeightTrendChart';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { deleteWeight } from '@/db/actions';
import { saveWeighIn } from '@/db/diary';
import { useActiveGoal, useNow, useProfile, useToday, useWeightTrend } from '@/db/hooks';
import type { TrendPoint } from '@/domain/trend';
import { DEFAULT_TZ, addDays, compareDays, zonedParts } from '@/domain/day';
import { fmtDayShort, fmtKg, fmtKgDelta, fmtTime } from '@/domain/format';
import type { Goal, LogicalDay, WeightLog } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { dayMonth, kgNumber } from '@/screens/Diary/diaryModel';
import styles from './WeightScreen.module.css';

const RANGE_DAYS: Record<WeightRange, number> = { '14d': 14, '30d': 30, '90d': 90 };
/** Weigh-ins listed before "Show all". */
const RECENT_COUNT = 7;

/** Points inside the range ending today (14d = today and the 13 days before). */
function pointsInRange(points: readonly TrendPoint[], range: WeightRange, today: LogicalDay): TrendPoint[] {
  const from = addDays(today, -(RANGE_DAYS[range] - 1));
  return points.filter((p) => compareDays(p.day, from) >= 0 && compareDays(p.day, today) <= 0);
}

/** "This week" is good news when it moves the way the goal does; never amber, a reading isn't a verdict. */
function changeTone(changeKg: number | null, goal: Pick<Goal, 'paceKgPerWeek' | 'template'> | undefined): MetricTone {
  if (changeKg === null || !goal || goal.template === 'pause' || goal.paceKgPerWeek === 0) return 'neutral';
  const rounded = Math.round(changeKg * 10) / 10;
  if (goal.paceKgPerWeek > 0) return rounded < 0 ? 'good' : 'neutral';
  return rounded > 0 ? 'good' : 'neutral';
}

function planTile(goal: Pick<Goal, 'paceKgPerWeek' | 'template'> | undefined): { value: string; sub: string } {
  if (!goal) return { value: '—', sub: 'no goal yet' };
  if (goal.template === 'pause') return { value: '—', sub: 'goal paused' };
  if (goal.paceKgPerWeek === 0) return { value: 'Hold', sub: 'steady weight' };
  // pace > 0 means losing: the plan reads "−0.5 kg a week".
  return { value: fmtKgDelta(-goal.paceKgPerWeek).replace(/ kg$/, ''), sub: 'kg a week' };
}

function chartLabel(points: TrendPoint[], weekChangeKg: number | null, latest: TrendPoint | undefined): string {
  if (!latest) return 'No weigh-ins yet';
  const change =
    weekChangeKg === null
      ? ''
      : `, ${weekChangeKg < 0 ? 'down' : 'up'} ${fmtKg(Math.abs(weekChangeKg))} this week`;
  const first = points[0];
  const last = points.at(-1);
  const span = first && last ? ` ${points.length} weigh-ins from ${fmtDayShort(first.day)} to ${fmtDayShort(last.day)}.` : '';
  return `Trend ${fmtKg(latest.trendKg)}${change}.${span}`;
}

interface WeighInRowProps {
  weight: WeightLog;
  tz: string;
  onDelete: (weight: WeightLog) => void;
}

function WeighInRow({ weight, tz, onDelete }: WeighInRowProps) {
  return (
    <li className={styles.entry}>
      <div>
        <div className={styles.entryDay}>{fmtDayShort(weight.logicalDay)}</div>
        <div className={styles.entryTime}>{fmtTime(weight.measuredAt, tz)}</div>
      </div>
      <div className={styles.entryEnd}>
        <span className={styles.entryKg}>{fmtKg(weight.kg)}</span>
        <button
          type="button"
          className={styles.delete}
          aria-label={`Delete weigh-in, ${fmtDayShort(weight.logicalDay)}, ${fmtKg(weight.kg)}`}
          onClick={() => onDelete(weight)}
        >
          <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/** @design S16 Weight — number pad weigh-in, trend chart with ranges, three tiles and recent weigh-ins. */
export default function WeightScreen() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const profile = useProfile();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const today = useToday();
  const now = useNow();
  const trend = useWeightTrend();
  const active = useActiveGoal();

  const location = useLocation();
  // Weight opens from More, Settings and the Diary: Back returns to whichever it was.
  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.more, { replace: true }));

  const [typed, setTyped] = useState<string | null>(null);
  const [savedTrendKg, setSavedTrendKg] = useState<number | null>(null);
  const [range, setRange] = useState<WeightRange>('14d');
  const [showAll, setShowAll] = useState(false);

  const entries = trend?.entries ?? [];
  const latestKg = entries[0]?.kg;
  const value = typed ?? (latestKg !== undefined ? kgNumber(latestKg) : '');
  const caption = zonedParts(now, tz).hour < 12 ? 'This morning' : 'Today';

  // One weigh-in per tap: repeat taps while it saves are ignored.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveWeighIn(Number(value));
      setTyped(kgNumber(saved.weight.kg));
      setSavedTrendKg(saved.trendKg);
    } catch (error) {
      if (error instanceof RangeError) showToast('Enter a weight between 20 and 400 kg');
      else throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (weight: WeightLog) => {
    const undo = await deleteWeight(weight.id);
    setSavedTrendKg(null);
    showToast('Weigh-in deleted', () => {
      void undo();
    });
  };

  const points = trend ? pointsInRange(trend.points, range, today) : [];
  const annotationIndex = trend?.annotation ? points.findIndex((p) => p.day === trend.annotation?.day) : -1;
  const annotation = trend?.annotation && annotationIndex >= 0 ? { index: annotationIndex, text: trend.annotation.text } : undefined;
  const first = points[0];
  const last = points.at(-1);
  const latest = trend?.latest;
  const weekChangeKg = trend?.weekChangeKg ?? null;
  const plan = planTile(active?.goal);
  const shown = showAll ? entries : entries.slice(0, RECENT_COUNT);

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Weight" onBack={back} backLabel={location.key !== 'default' ? 'Back' : 'Back to More'} />

      <div className={styles.entryCard}>
        <WeightEntry
          value={value}
          caption={caption}
          saved={savedTrendKg !== null}
          savedLabel={savedTrendKg !== null ? `Saved · trend ${fmtKg(savedTrendKg)}` : undefined}
          onChange={(next) => {
            setTyped(next);
            setSavedTrendKg(null);
          }}
          onSave={() => void save()}
          busy={saving}
        />
      </div>

      <div className={styles.block}>
        <WeightTrendChart
          points={points}
          annotation={annotation}
          range={range}
          onRangeChange={setRange}
          startLabel={first ? dayMonth(first.day) : ''}
          endLabel={last ? (last.day === today ? 'today' : dayMonth(last.day)) : ''}
          ariaLabel={chartLabel(points, weekChangeKg, latest)}
        />
      </div>

      {latest ? (
        <>
          <MetricRow className={styles.tiles}>
            <MetricTile label="Trend" value={fmtKg(latest.trendKg)} />
            <MetricTile
              label="This week"
              value={weekChangeKg !== null ? fmtKgDelta(weekChangeKg) : '—'}
              tone={changeTone(weekChangeKg, active?.goal)}
              sub={weekChangeKg === null ? 'after a week of weigh-ins' : undefined}
            />
            <MetricTile label="Plan" value={plan.value} sub={plan.sub} />
          </MetricRow>

          <SectionHeading>Recent weigh-ins</SectionHeading>
          <Card radius="card" padding="4px 14px" className={styles.listCard}>
            <ul className={styles.list}>
              {shown.map((w) => (
                <WeighInRow key={w.id} weight={w} tz={tz} onDelete={(row) => void remove(row)} />
              ))}
            </ul>
          </Card>
          {entries.length > RECENT_COUNT ? (
            <div className={styles.more}>
              <Button variant="ghost" size="pill" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${entries.length}`}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.first}>One reading a morning is plenty. The trend smooths out salt and water swings.</p>
      )}
    </div>
  );
}
