import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RangeTotal } from './RangeTotal';
import { afterThis } from './afterThis';

// Friday sample: 1,230 eaten, 570 left, +650 saved.
const today = { eatenTodayKcal: 1230, leftTodayKcal: 570, savedKcal: 650 };

describe('afterThis', () => {
  it('reports what is left when the meal fits', () => {
    const r = afterThis({ ...today, mealKcal: 450 });
    expect(r.afterKcal).toBe(120);
    expect(r.fitKcal).toBe(450);
    expect(r.overKcal).toBe(0);
    expect(r.line).toBe('After this: 120 kcal left today');
  });

  it('splits the meal into fit and overflow and says savings cover it (880 → 310 over)', () => {
    const r = afterThis({ ...today, mealKcal: 880 });
    expect(r.fitKcal).toBe(570);
    expect(r.overKcal).toBe(310);
    expect(r.overTodayKcal).toBe(310);
    expect(r.coveredBySavings).toBe(true);
    expect(r.line).toBe('After this: 310 over today · covered by your +650 saved');
  });

  it('drops the savings clause when savings do not cover the overspend', () => {
    const r = afterThis({ ...today, mealKcal: 880, savedKcal: 200 });
    expect(r.coveredBySavings).toBe(false);
    expect(r.line).toBe('After this: 310 over today');
  });

  it('never claims cover from zero or negative savings', () => {
    expect(afterThis({ ...today, mealKcal: 880, savedKcal: 0 }).line).toBe('After this: 310 over today');
    expect(afterThis({ ...today, mealKcal: 880, savedKcal: -100 }).coveredBySavings).toBe(false);
  });

  it('counts savings exactly equal to the overspend as covered', () => {
    expect(afterThis({ ...today, mealKcal: 880, savedKcal: 310 }).coveredBySavings).toBe(true);
  });

  it('treats a meal that uses exactly the allowance as 0 left', () => {
    const r = afterThis({ ...today, mealKcal: 570 });
    expect(r.overKcal).toBe(0);
    expect(r.line).toBe('After this: 0 kcal left today');
  });

  it('puts the whole meal in overflow when today is already over, and totals the day', () => {
    const r = afterThis({ eatenTodayKcal: 1900, leftTodayKcal: -100, savedKcal: 650, mealKcal: 300 });
    expect(r.fitKcal).toBe(0);
    expect(r.overKcal).toBe(300);
    expect(r.overTodayKcal).toBe(400);
    expect(r.line).toBe('After this: 400 over today · covered by your +650 saved');
  });

  it('formats thousands', () => {
    expect(afterThis({ eatenTodayKcal: 0, leftTodayKcal: 1800, savedKcal: 0, mealKcal: 500 }).line).toBe(
      'After this: 1,300 kcal left today',
    );
  });
});

describe('RangeTotal', () => {
  it('shows the best guess, the range and the action', async () => {
    const onAction = vi.fn();
    render(<RangeTotal placement="inline" totalKcalLabel="880 kcal" rangeLabel="750–1,010" actionLabel="Save" onAction={onAction} />);
    expect(screen.getByText('Best guess')).toBeInTheDocument();
    expect(screen.getByText('880 kcal')).toBeInTheDocument();
    expect(screen.getByText('likely 750–1,010')).toBeInTheDocument();
    expect(screen.queryByText(/After this/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('renders the after-this line when given today’s numbers', () => {
    render(
      <RangeTotal
        placement="inline"
        totalKcalLabel="880 kcal"
        rangeLabel="750–1,010"
        actionLabel="Save"
        onAction={() => {}}
        after={{ ...today, mealKcal: 880 }}
      />,
    );
    expect(screen.getByText('After this: 310 over today · covered by your +650 saved')).toBeInTheDocument();
  });

  it('does not fire a disabled action', async () => {
    const onAction = vi.fn();
    render(<RangeTotal placement="inline" totalKcalLabel="670 kcal" rangeLabel="570–770" actionLabel="Review" onAction={onAction} disabled />);
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onAction).not.toHaveBeenCalled();
  });
});
