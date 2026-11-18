import { daysBetween } from '@/domain/day';
import type { PlanPoint } from '@/domain/plan';
import { Card } from '@/components/ui/Card';
import styles from './PlanChart.module.css';

export interface PlanChartProps {
  /** Your weight trend from the start. */
  actual: readonly PlanPoint[];
  /** The straight line the plan's pace draws. */
  plan: readonly PlanPoint[];
  /** Axis captions under the chart: "5 Oct" / "today". */
  startLabel: string;
  endLabel: string;
  /** Summary for screen readers, e.g. "Trend 78.8 kg, 0.6 kg above the plan's line". */
  ariaLabel: string;
  /** Shown instead of the chart with fewer than two trend points. */
  emptyLabel?: string;
  className?: string;
}

export const PLAN_CHART_WIDTH = 320;
export const PLAN_CHART_HEIGHT = 120;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 108;
/** Room at the right edge for the end dot. */
const PLOT_RIGHT = PLAN_CHART_WIDTH - 6;
const GRID_YS = [36, 60, 84] as const;

export interface PlanChartGeometry {
  actualPath: string;
  planPath: string;
  /** Where the trend ends: the dot, and the plan line's end beside it. */
  actualEnd?: { x: number; y: number };
  planEnd?: { x: number; y: number };
  /** Visible kg range after padding. */
  domain: { lo: number; hi: number };
}

/**
 * Maps both lines into the 320×120 viewBox on one shared scale: days on x from the first point to
 * the last of either line, kg on y fitted to both lines with ~15% padding (at least 0.3 kg).
 */
export function planChartGeometry(actual: readonly PlanPoint[], plan: readonly PlanPoint[]): PlanChartGeometry {
  const all = [...actual, ...plan];
  if (all.length === 0) return { actualPath: '', planPath: '', domain: { lo: 0, hi: 0 } };
  const first = all.reduce((a, p) => (p.day < a ? p.day : a), all[0]!.day);
  const last = all.reduce((a, p) => (p.day > a ? p.day : a), all[0]!.day);
  const span = Math.max(1, daysBetween(first, last));
  const kgs = all.map((p) => p.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  const pad = Math.max(0.3, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const round = (n: number) => Math.round(n * 10) / 10;
  const xOf = (day: string) => round((daysBetween(first, day) / span) * PLOT_RIGHT);
  const yOf = (kg: number) => round(PLOT_TOP + ((hi - kg) / (hi - lo)) * (PLOT_BOTTOM - PLOT_TOP));
  const pathOf = (points: readonly PlanPoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.day)} ${yOf(p.kg)}`).join(' ');
  const endOf = (points: readonly PlanPoint[]) => {
    const p = points.at(-1);
    return p ? { x: xOf(p.day), y: yOf(p.kg) } : undefined;
  };
  const geometry: PlanChartGeometry = { actualPath: pathOf(actual), planPath: pathOf(plan), domain: { lo, hi } };
  const actualEnd = endOf(actual);
  const planEnd = endOf(plan);
  if (actualEnd) geometry.actualEnd = actualEnd;
  if (planEnd) geometry.planEnd = planEnd;
  return geometry;
}

/** @design C11 sibling: your trend as a solid line over the plan's dashed one, on one scale. */
export function PlanChart({ actual, plan, startLabel, endLabel, ariaLabel, emptyLabel = 'Your trend appears after a few weigh-ins', className }: PlanChartProps) {
  const geometry = planChartGeometry(actual, plan);
  return (
    <Card radius="card" padding="14px 16px" className={className}>
      <div className={styles.header}>
        <span className={styles.title}>Weight trend against your plan</span>
      </div>
      {actual.length < 2 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <>
          <svg className={styles.svg} viewBox={`0 0 ${PLAN_CHART_WIDTH} ${PLAN_CHART_HEIGHT}`} width="100%" height={PLAN_CHART_HEIGHT} role="img" aria-label={ariaLabel}>
            {GRID_YS.map((y) => (
              <line key={y} x1={0} y1={y} x2={PLAN_CHART_WIDTH} y2={y} className={styles.grid} />
            ))}
            <path d={geometry.planPath} className={styles.plan} />
            <path d={geometry.actualPath} className={styles.actual} />
            {geometry.actualEnd ? <circle cx={geometry.actualEnd.x} cy={geometry.actualEnd.y} r={4.5} className={styles.end} /> : null}
          </svg>
          <div className={styles.axis} aria-hidden="true">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
          <div className={styles.legend} aria-hidden="true">
            <span className={styles.key}>
              <span className={styles.swatchActual} />
              Your trend
            </span>
            <span className={styles.key}>
              <span className={styles.swatchPlan} />
              Your plan
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
