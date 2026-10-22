import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isUnlocked, UnlockList, UnlockProgress, unlockPct } from './UnlockProgress';

describe('unlockPct', () => {
  it('is days logged over days needed, capped', () => {
    expect(unlockPct(9, 14)).toBeCloseTo(64.29, 1);
    expect(unlockPct(9, 21)).toBeCloseTo(42.86, 1);
    expect(unlockPct(30, 21)).toBe(100);
    expect(unlockPct(-1, 14)).toBe(0);
    expect(unlockPct(0, 0)).toBe(100);
  });

  it('unlocks once enough days are logged', () => {
    expect(isUnlocked(13, 14)).toBe(false);
    expect(isUnlocked(14, 14)).toBe(true);
  });
});

describe('UnlockProgress', () => {
  it('shows "9 of 14 days" while locked', () => {
    render(<UnlockProgress label="Timing patterns" have={9} need={14} />);
    expect(screen.getByText('9 of 14 days')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Timing patterns' });
    expect(bar).toHaveAttribute('aria-valuenow', '9');
    expect(bar).toHaveAttribute('aria-valuemax', '14');
  });

  it('shows "Unlocked" with a full bar once ready', () => {
    render(<UnlockProgress label="Timing patterns" have={16} need={14} />);
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '14');
  });

  it('counts in another unit when given one', () => {
    render(<UnlockProgress label="Weigh-ins for your maintenance" have={4} need={8} unit="weigh-ins" />);
    expect(screen.getByText('4 of 8 weigh-ins')).toBeInTheDocument();
  });

  it('counts days by default', () => {
    render(<UnlockProgress label="Your real maintenance" have={17} need={21} />);
    expect(screen.getByText('17 of 21 days')).toBeInTheDocument();
  });

  it('has no button unless it is given something to open', () => {
    render(<UnlockProgress label="Timing patterns" have={9} need={14} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('valueLabel', () => {
    it('replaces "9 of 14 days" while locked', () => {
      render(<UnlockProgress label="Top dishes check" have={12} need={30} valueLabel="12 of 30 checked" />);
      expect(screen.getByText('12 of 30 checked')).toBeInTheDocument();
      expect(screen.queryByText(/of 30 days/)).toBeNull();
      expect(screen.getByRole('progressbar', { name: 'Top dishes check' })).toHaveAttribute('aria-valuenow', '12');
    });

    it('replaces "Unlocked" once there is enough, keeping the tick', () => {
      render(<UnlockProgress label="Top dishes check" have={30} need={30} valueLabel="Checked" />);
      expect(screen.getByText('Checked')).toBeInTheDocument();
      expect(screen.queryByText('Unlocked')).toBeNull();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    });

    it('shows "Ready" with an empty bar', () => {
      render(<UnlockProgress label="Top dishes check" have={0} need={1} valueLabel="Ready" />);
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });
  });

  describe('onPress', () => {
    it('makes the label and value one button and calls it', async () => {
      const onPress = vi.fn();
      render(<UnlockProgress label="Top dishes check" have={0} need={1} valueLabel="Ready" onPress={onPress} />);
      const button = screen.getByRole('button', { name: 'Top dishes check Ready' });
      await userEvent.click(button);
      expect(onPress).toHaveBeenCalledTimes(1);
      // The bar stays outside the button, still announced.
      expect(button).not.toContainElement(screen.getByRole('progressbar', { name: 'Top dishes check' }));
    });

    it('also works with the default value text', async () => {
      const onPress = vi.fn();
      render(<UnlockProgress label="Timing patterns" have={9} need={14} onPress={onPress} />);
      await userEvent.click(screen.getByRole('button', { name: 'Timing patterns 9 of 14 days' }));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });
});

describe('UnlockList', () => {
  it('carries the new props through to each row', async () => {
    const onPress = vi.fn();
    render(
      <UnlockList
        items={[
          { label: 'Timing patterns', have: 9, need: 14 },
          { label: 'Top dishes check', have: 0, need: 1, valueLabel: 'Ready', onPress },
        ]}
      />,
    );
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Top dishes check/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
