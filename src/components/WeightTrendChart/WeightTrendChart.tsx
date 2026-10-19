import { Card } from '@/components/ui/Card';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import styles from './WeightTrendChart.module.css';

export type WeightRange = '14d' | '30d' | '90d';

export interface WeightPoint {
  /** Daily reading. */
  kg: number;
  /** Smoothed trend at that reading (EMA, see src/domain/trend.ts). */
  trendKg: number;
}

export interface WeightTrendChartProps {
  points: WeightPoint[];
  /** Hollow amber circle on one reading with a short note ("Monday jump: salt and water"). */
  annotation?: { index: number; text: string };
  range: WeightRange;
  onRangeChange: (range: WeightRange) => void;
  /** Axis captions under the chart: "3 Oct" / "today". */
  startLabel: string;
  endLabel: string;
  /** Summary for screen readers, e.g. "Trend 77.9 kg, down 0.4 kg this week". */
  ariaLabel: string;
  /** Header text left of the range switch. */
  title?: string;
  /** Shown instead of the chart with fewer than two readings. */
  emptyLabel?: string;
  /** False drops the card so the chart can sit inside another card. */
  framed?: boolean;
  className?: string;
}

export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 110;
/** Plot area inside the 110px viewBox; the rest is breathing room for dots and the annotation. */
const PLOT_TOP = 10;
const PLOT_BOTTOM = 100;
const GRID_YS = [27.5, 55, 82.5] as const;
const RANGES: readonly SegmentedOption<WeightRange>[] = [
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

export interface ChartGeometry {
  dots: { x: number; y: number }[];
  trendPath: string;
  /** Visible kg domain after padding. */
  domain: { lo: number; hi: number };
}

/** Maps readings and trend into the 320×110 viewBox; the y-axis fits the data with ~15% padding (at least 0.15 kg). */
export function chartGeometry(points: readonly WeightPoint[]): ChartGeometry {
  if (points.length === 0) return { dots: [], trendPath: '', domain: { lo: 0, hi: 0 } };
  const values = points.flatMap((p) => [p.kg, p.trendKg]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(0.15, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const xOf = (i: number) => (points.length === 1 ? CHART_WIDTH / 2 : (i * CHART_WIDTH) / (points.length - 1));
  const yOf = (kg: number) => PLOT_TOP + ((hi - kg) / (hi - lo)) * (PLOT_BOTTOM - PLOT_TOP);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    dots: points.map((p, i) => ({ x: round(xOf(i)), y: round(yOf(p.kg)) })),
    trendPath: points.map((p, i) => `${i ? 'L' : 'M'}${round(xOf(i))} ${round(yOf(p.trendKg))}`).join(' '),
    domain: { lo, hi },
  };
}

/** Rough width of 10px text, used to keep the annotation inside the chart. */
const approxTextWidth = (text: string) => text.length * 5.2;

/** @design C11 WeightTrendChart — faint daily dots, a strong trend line, one annotation and a range switch. */
export function WeightTrendChart({
  points,
  annotation,
  range,
  onRangeChange,
  startLabel,
  endLabel,
  ariaLabel,
  title = 'Trend',
  emptyLabel = 'Your trend appears after a few weigh-ins',
  framed = true,
  className,
}: WeightTrendChartProps) {
  const geometry = chartGeometry(points);
  const marked = annotation ? geometry.dots[annotation.index] : undefined;
  const textOnLeft = marked && annotation ? marked.x + 10 + approxTextWidth(annotation.text) > CHART_WIDTH : false;

  const body = (
    <>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <Segmented label="Range" tone="inset" options={RANGES} value={range} onChange={onRangeChange} />
      </div>
      {points.length < 2 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <>
          <svg
            className={styles.svg}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            width="100%"
            height={CHART_HEIGHT}
            role="img"
            aria-label={ariaLabel}
          >
            {GRID_YS.map((y) => (
              <line key={y} x1={0} y1={y} x2={CHART_WIDTH} y2={y} className={styles.grid} />
            ))}
            {geometry.dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={3.5} className={styles.dot} />
            ))}
            <path d={geometry.trendPath} className={styles.trend} />
            {marked && annotation ? (
              <>
                <circle cx={marked.x} cy={marked.y} r={5} className={styles.mark} />
                <text
                  x={textOnLeft ? marked.x - 10 : marked.x + 10}
                  y={marked.y - 2}
                  textAnchor={textOnLeft ? 'end' : 'start'}
                  className={styles.note}
                >
                  {annotation.text}
                </text>
              </>
            ) : null}
          </svg>
          <div className={styles.axis} aria-hidden="true">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
        </>
      )}
    </>
  );

  if (!framed) return <div className={className}>{body}</div>;
  return (
    <Card radius="card" padding="14px 16px" className={className}>
      {body}
    </Card>
  );
}
