import { render, screen } from '@testing-library/react';
import { DayTimeline, dotSizeFor } from './DayTimeline';

describe('dotSizeFor', () => {
  it('matches the design sample sizes', () => {
    expect(dotSizeFor(560)).toBe(10); // breakfast
    expect(dotSizeFor(670)).toBe(12); // lunch
    expect(dotSizeFor(880)).toBe(14); // dinner
  });

  it('steps at 600 and 800 kcal', () => {
    expect(dotSizeFor(599)).toBe(10);
    expect(dotSizeFor(600)).toBe(12);
    expect(dotSizeFor(799)).toBe(12);
    expect(dotSizeFor(800)).toBe(14);
  });
});

describe('DayTimeline', () => {
  it('renders the summary, captions and the gap label', () => {
    render(
      <DayTimeline
        windowStartPct={25.7}
        windowEndPct={75.7}
        dots={[
          { pct: 25.7, kcal: 560, tone: 'onTime' },
          { pct: 44.4, kcal: 680, tone: 'onTime' },
        ]}
        gap={{ startPct: 44.4, endPct: 85.4, label: 'usual dinner 9pm' }}
        captions={['woke 10am', '11:10am', '3:40pm', 'slept 1:30am']}
        ariaLabel="Yesterday: meals at 11:10am and 3:40pm, nothing after"
      />,
    );
    expect(screen.getByRole('img', { name: 'Yesterday: meals at 11:10am and 3:40pm, nothing after' })).toBeInTheDocument();
    expect(screen.getByText('usual dinner 9pm')).toBeInTheDocument();
    expect(screen.getByText('slept 1:30am')).toBeInTheDocument();
  });

  it('sizes and places dots from the data', () => {
    render(<DayTimeline dots={[{ pct: 120, kcal: 900, tone: 'late' }]} captions={[]} ariaLabel="One late meal" />);
    const dot = screen.getByRole('img').firstElementChild as HTMLElement;
    expect(dot.style.width).toBe('14px');
    expect(dot.style.left).toBe('100%');
  });
});
