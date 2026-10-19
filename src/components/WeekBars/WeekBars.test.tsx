import { render, screen } from '@testing-library/react';
import { scaleWeekBars, WeekBars, type WeekBar } from './WeekBars';

// Design sample week (design_handoff.md §9.2): today is Friday, Saturday is the makan day.
const sampleWeek: WeekBar[] = [
  { label: 'M', kind: 'logged', valueKcal: 1620 },
  { label: 'T', kind: 'logged', valueKcal: 1710 },
  { label: 'W', kind: 'logged', valueKcal: 1540 },
  { label: 'T', kind: 'logged', valueKcal: 1680 },
  { label: 'F', kind: 'today', valueKcal: 1800, fillKcal: 1230 },
  { label: 'S', kind: 'makan', valueKcal: 2450 },
  { label: 'S', kind: 'planned', valueKcal: 1800 },
];

describe('scaleWeekBars', () => {
  it('lets the tallest bar fill the height when it beats target × 1.15', () => {
    const { bars, targetTopPx } = scaleWeekBars(sampleWeek, 1800, 64);
    expect(bars.map((b) => b.heightPx)).toEqual([42, 45, 40, 44, 47, 64, 47]);
    // 1,800 of a 2,450 ceiling is 47px from the bottom of a 64px chart.
    expect(targetTopPx).toBe(17);
  });

  it('keeps 15% headroom above the target when no bar reaches it', () => {
    const flat: WeekBar[] = Array.from({ length: 7 }, () => ({ label: 'M', kind: 'planned', valueKcal: 1800 }));
    const { bars, targetTopPx } = scaleWeekBars(flat, 1800, 96);
    // ceiling = 1,800 × 1.15 = 2,070 → 1,800 / 2,070 × 96 = 83.5
    expect(bars.every((b) => b.heightPx === 83)).toBe(true);
    expect(targetTopPx).toBe(13);
  });

  it("fills today's outline by eaten / allowance", () => {
    const today = scaleWeekBars(sampleWeek, 1800, 64).bars[4];
    expect(today?.fill).toBeCloseTo(1230 / 1800, 5);
  });

  it('grows today past the target when eaten is over, filled completely', () => {
    const over = sampleWeek.map((b) => (b.kind === 'today' ? { ...b, fillKcal: 2110 } : b.kind === 'makan' ? { ...b, valueKcal: 2140 } : b));
    const { bars } = scaleWeekBars(over, 1800, 64);
    expect(bars[4]).toEqual({ heightPx: 63, fill: 1 });
    expect(bars[5]?.heightPx).toBe(64);
  });

  it('scales to the data alone without a target', () => {
    const paused: WeekBar[] = [
      { label: 'M', kind: 'paused', valueKcal: 2000 },
      { label: 'T', kind: 'paused', valueKcal: 1000 },
    ];
    const { bars, targetTopPx } = scaleWeekBars(paused, null, 64);
    expect(targetTopPx).toBeNull();
    expect(bars.map((b) => b.heightPx)).toEqual([64, 32]);
  });

  it('handles an empty week without dividing by zero', () => {
    const empty: WeekBar[] = [{ label: 'M', kind: 'paused', valueKcal: 0 }];
    expect(scaleWeekBars(empty, null, 64).bars[0]).toEqual({ heightPx: 0, fill: 0 });
  });
});

describe('WeekBars', () => {
  it('exposes the summary and marks the makan day with a star', () => {
    const { container } = render(
      <WeekBars bars={sampleWeek} targetKcal={1800} height={64} ariaLabel="This week: 7,780 eaten so far" />,
    );
    expect(screen.getByRole('img', { name: 'This week: 7,780 eaten so far' })).toBeInTheDocument();
    // One svg: the star next to the makan day's letter.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.textContent).toContain('MTWTFSS');
  });
});
