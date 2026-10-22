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

  it('is larger on the expanded strip, with the same thresholds', () => {
    expect(dotSizeFor(560, 'expanded')).toBe(14);
    expect(dotSizeFor(599, 'expanded')).toBe(14);
    expect(dotSizeFor(600, 'expanded')).toBe(18);
    expect(dotSizeFor(799, 'expanded')).toBe(18);
    expect(dotSizeFor(800, 'expanded')).toBe(22);
    expect(dotSizeFor(880, 'compact')).toBe(14);
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

  it('keeps the compact strip as it was: no ticks, no sleep marker, 10px dots', () => {
    const { container } = render(
      <DayTimeline dots={[{ pct: 40, kcal: 560, tone: 'onTime' }]} ticks={[16.7, 33.3]} captions={['5am', 'now', '5am']} ariaLabel="Compact" />,
    );
    const track = screen.getByRole('img', { name: 'Compact' });
    expect(track.children).toHaveLength(1);
    expect((track.firstElementChild as HTMLElement).style.width).toBe('10px');
    expect(container.querySelector('svg')).toBeNull();
  });

  describe('expanded', () => {
    it('uses the larger dots', () => {
      render(<DayTimeline size="expanded" dots={[{ pct: 40, kcal: 560, tone: 'onTime' }, { pct: 70, kcal: 880, tone: 'late' }]} captions={[]} ariaLabel="Expanded" />);
      const dots = Array.from(screen.getByRole('img', { name: 'Expanded' }).children) as HTMLElement[];
      expect(dots.map((d) => d.style.width)).toEqual(['14px', '22px']);
      expect(dots.map((d) => d.style.marginLeft)).toEqual(['-7px', '-11px']);
    });

    it('draws a line for each tick, before the dots', () => {
      render(
        <DayTimeline
          size="expanded"
          dots={[{ pct: 40, kcal: 560, tone: 'onTime' }]}
          ticks={[16.67, 33.33, 150]}
          captions={['5am', '9am', '1pm']}
          ariaLabel="Ticks"
        />,
      );
      const children = Array.from(screen.getByRole('img', { name: 'Ticks' }).children) as HTMLElement[];
      expect(children).toHaveLength(4);
      expect(children.slice(0, 3).map((c) => c.style.left)).toEqual(['16.67%', '33.33%', '100%']);
      expect(children[3]?.style.width).toBe('14px');
      expect(screen.getByText('9am')).toBeInTheDocument();
    });

    it('puts each caption at the same percentage as its hour line, the first and last inside the edges', () => {
      const captions = ['5am', '9am', '1pm', '5pm', '9pm', '1am', '5am'];
      const ticks = [1, 2, 3, 4, 5].map((k) => (k / 6) * 100);
      const { container } = render(<DayTimeline size="expanded" dots={[]} ticks={ticks} captions={captions} ariaLabel="Aligned" />);
      const labels = Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span'));
      expect(labels.map((l) => l.textContent)).toEqual(captions);
      const left = labels.map((l) => Number.parseFloat(l.style.left));
      expect(left[0]).toBe(0);
      expect(left[6]).toBe(100);
      ticks.forEach((t, i) => expect(left[i + 1]).toBeCloseTo(t, 6));
      // Ends are anchored inside the strip, the rest centred on their line.
      expect(labels[0]?.className).toMatch(/captionFirst/);
      expect(labels[6]?.className).toMatch(/captionLast/);
      expect(labels[3]?.className).not.toMatch(/captionFirst|captionLast/);
    });

    it('keeps the compact captions spread evenly in a row, not positioned', () => {
      const { container } = render(<DayTimeline dots={[]} captions={['5am', 'now', '5am']} ariaLabel="Row" />);
      const labels = Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span'));
      expect(labels).toHaveLength(3);
      expect(labels.every((l) => l.style.left === '')).toBe(true);
    });

    it('places the Going to sleep marker at its position, hidden from screen readers', () => {
      const { container } = render(
        <DayTimeline
          size="expanded"
          dots={[]}
          sleep={{ pct: 83.3 }}
          captions={[]}
          ariaLabel="Going to sleep tap at 1:30am."
        />,
      );
      const track = screen.getByRole('img', { name: 'Going to sleep tap at 1:30am.' });
      const marker = track.firstElementChild as HTMLElement;
      expect(marker.style.left).toBe('83.3%');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(marker.querySelector('svg')).not.toBeNull();
      expect(container.querySelectorAll('svg')).toHaveLength(1);
    });

    it('clamps the marker to the strip', () => {
      render(<DayTimeline size="expanded" dots={[]} sleep={{ pct: 140 }} captions={[]} ariaLabel="Late tap" />);
      expect((screen.getByRole('img', { name: 'Late tap' }).firstElementChild as HTMLElement).style.left).toBe('100%');
    });

    it('shows the marker on the compact strip too', () => {
      render(<DayTimeline dots={[]} sleep={{ pct: 50 }} captions={[]} ariaLabel="Compact sleep" />);
      expect((screen.getByRole('img', { name: 'Compact sleep' }).firstElementChild as HTMLElement).style.left).toBe('50%');
    });
  });
});
