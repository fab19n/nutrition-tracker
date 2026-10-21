import { render, screen } from '@testing-library/react';
import { isUnlocked, UnlockProgress, unlockPct } from './UnlockProgress';

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
});
