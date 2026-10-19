import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chartGeometry, CHART_WIDTH, WeightTrendChart, type WeightPoint } from './WeightTrendChart';

const readings = [78.6, 78.3, 78.5, 78.1, 78.2, 78.0, 79.0, 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8];

function withTrend(values: number[], alpha = 0.25): WeightPoint[] {
  let ema = values[0] ?? 0;
  return values.map((kg) => {
    ema += (kg - ema) * alpha;
    return { kg, trendKg: ema };
  });
}

describe('chartGeometry', () => {
  const points = withTrend(readings);
  const g = chartGeometry(points);

  it('spreads readings across the full width', () => {
    expect(g.dots[0]?.x).toBe(0);
    expect(g.dots[13]?.x).toBe(CHART_WIDTH);
  });

  it('fits the y-axis to the data with padding', () => {
    expect(g.domain.lo).toBeLessThan(77.7);
    expect(g.domain.hi).toBeGreaterThan(79.0);
    expect(g.domain.hi - 79.0).toBeGreaterThanOrEqual(0.15);
    for (const d of g.dots) {
      expect(d.y).toBeGreaterThan(10);
      expect(d.y).toBeLessThan(100);
    }
  });

  it('puts the heaviest reading highest and the lightest lowest', () => {
    const ys = g.dots.map((d) => d.y);
    expect(Math.min(...ys)).toBe(g.dots[6]?.y); // 79.0, the Monday jump
    expect(Math.max(...ys)).toBe(g.dots[12]?.y); // 77.7
  });

  it('draws the trend as one path through every point', () => {
    expect(g.trendPath.startsWith('M0 ')).toBe(true);
    expect(g.trendPath.match(/L/g)).toHaveLength(13);
  });

  it('centres a flat series', () => {
    const flat = chartGeometry([
      { kg: 78, trendKg: 78 },
      { kg: 78, trendKg: 78 },
    ]);
    expect(flat.dots.map((d) => d.y)).toEqual([55, 55]);
    expect(flat.domain.lo).toBeCloseTo(77.85, 5);
  });

  it('handles one or no readings', () => {
    expect(chartGeometry([{ kg: 78, trendKg: 78 }]).dots[0]?.x).toBe(CHART_WIDTH / 2);
    expect(chartGeometry([]).trendPath).toBe('');
  });
});

describe('WeightTrendChart', () => {
  it('renders the chart with its annotation and switches range', async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    render(
      <WeightTrendChart
        points={withTrend(readings)}
        annotation={{ index: 6, text: 'Monday jump: salt and water' }}
        range="14d"
        onRangeChange={onRangeChange}
        startLabel="3 Oct"
        endLabel="today"
        ariaLabel="Weight trend 77.9 kg"
      />,
    );
    expect(screen.getByRole('img', { name: 'Weight trend 77.9 kg' })).toBeInTheDocument();
    expect(screen.getByText('Monday jump: salt and water')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '14d' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: '30d' }));
    expect(onRangeChange).toHaveBeenCalledWith('30d');
  });

  it('shows the empty message before there are two readings', () => {
    render(
      <WeightTrendChart
        points={withTrend([78.6])}
        range="14d"
        onRangeChange={() => {}}
        startLabel="16 Oct"
        endLabel="today"
        ariaLabel="One weigh-in"
      />,
    );
    expect(screen.getByText('Your trend appears after a few weigh-ins')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
