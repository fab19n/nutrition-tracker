import { render, screen } from '@testing-library/react';
import { isBehind, MacroBar, macroFillPct } from './MacroBar';

describe('isBehind', () => {
  it('is behind under 55% of the target', () => {
    expect(isBehind(42, 110)).toBe(true); // 42 < 60.5
    expect(isBehind(60, 110)).toBe(true);
  });

  it('is not behind at or above 55%', () => {
    expect(isBehind(60.5, 110)).toBe(false);
    expect(isBehind(145, 180)).toBe(false);
  });

  it('is never behind without a target', () => {
    expect(isBehind(0, 0)).toBe(false);
  });
});

describe('macroFillPct', () => {
  it('is the share of target, capped at 100', () => {
    expect(macroFillPct(145, 180)).toBeCloseTo(80.56, 1);
    expect(macroFillPct(70, 60)).toBe(100);
    expect(macroFillPct(-5, 60)).toBe(0);
    expect(macroFillPct(10, 0)).toBe(100);
  });
});

describe('MacroBar', () => {
  it('shows "· behind" and the value over target', () => {
    render(<MacroBar label="Protein" value={42} target={110} macro="protein" behind />);
    expect(screen.getByText('Protein · behind')).toBeInTheDocument();
    expect(screen.getByText('/110g')).toBeInTheDocument();
    expect(screen.getByText('42', { exact: false })).toBeInTheDocument();
  });

  it('shows the plain label when on track', () => {
    render(<MacroBar label="Carbs" value={145} target={180} macro="carbs" />);
    expect(screen.getByText('Carbs')).toBeInTheDocument();
  });

  it('shows "· reached" once the target is met', () => {
    render(<MacroBar label="Fat" value={60} target={60} macro="fat" reached />);
    expect(screen.getByText('Fat · reached')).toBeInTheDocument();
  });
});
