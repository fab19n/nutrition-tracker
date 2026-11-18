import { render, screen } from '@testing-library/react';
import { addDays } from '@/domain/day';
import type { PlanPoint } from '@/domain/plan';
import { PLAN_CHART_HEIGHT, PLAN_CHART_WIDTH, PlanChart, planChartGeometry } from './PlanChart';

const START = '2026-10-05';
const point = (i: number, kg: number): PlanPoint => ({ day: addDays(START, i), kg });

describe('planChartGeometry', () => {
  it('draws nothing without points', () => {
    expect(planChartGeometry([], [])).toMatchObject({ actualPath: '', planPath: '' });
  });

  it('puts both lines on one scale, from the first day to the last of either', () => {
    const actual = [point(0, 80), point(14, 79.5), point(28, 79)];
    const plan = [point(0, 80), point(28, 78)];
    const g = planChartGeometry(actual, plan);
    expect(g.actualPath.startsWith('M0 ')).toBe(true);
    expect(g.planPath.startsWith('M0 ')).toBe(true);
    // Both end on the same day, so the same x; the plan is lower, so its y is larger.
    expect(g.actualEnd?.x).toBe(g.planEnd?.x);
    expect(g.planEnd!.y).toBeGreaterThan(g.actualEnd!.y);
    // The y-axis fits both lines.
    expect(g.domain.lo).toBeLessThan(78);
    expect(g.domain.hi).toBeGreaterThan(80);
  });

  it('keeps everything inside the viewBox', () => {
    const g = planChartGeometry([point(0, 80), point(20, 77)], [point(0, 80), point(20, 79)]);
    const numbers = [...g.actualPath.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(PLAN_CHART_WIDTH);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(PLAN_CHART_HEIGHT);
  });

  it('copes with a flat trend', () => {
    const g = planChartGeometry([point(0, 80), point(10, 80)], [point(0, 80), point(10, 80)]);
    expect(g.actualPath).not.toContain('NaN');
    expect(g.domain.hi).toBeGreaterThan(g.domain.lo);
  });
});

describe('PlanChart', () => {
  it('shows the trend and the plan with a legend and a text summary', () => {
    render(
      <PlanChart
        actual={[point(0, 80), point(14, 79.5)]}
        plan={[point(0, 80), point(14, 79)]}
        startLabel="Mon 5 Oct"
        endLabel="today"
        ariaLabel="Weight trend 79.5 kg, 0.5 kg short of the plan."
      />,
    );
    expect(screen.getByRole('img', { name: 'Weight trend 79.5 kg, 0.5 kg short of the plan.' })).toBeInTheDocument();
    expect(screen.getByText('Your trend')).toBeInTheDocument();
    expect(screen.getByText('Your plan')).toBeInTheDocument();
    expect(screen.getByText('Mon 5 Oct')).toBeInTheDocument();
  });

  it('says so instead of drawing a line from one point', () => {
    render(<PlanChart actual={[point(0, 80)]} plan={[point(0, 80)]} startLabel="a" endLabel="b" ariaLabel="x" />);
    expect(screen.getByText('Your trend appears after a few weigh-ins')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
