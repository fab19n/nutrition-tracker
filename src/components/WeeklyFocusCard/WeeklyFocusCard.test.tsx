import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WeeklyFocusCard, focusPhrase } from './WeeklyFocusCard';

describe('WeeklyFocusCard (C44)', () => {
  it('reads the focus mid-sentence with the progress on the right', () => {
    render(<WeeklyFocusCard label="Kurang manis for drinks" progressLabel="0 of 5" />);
    expect(screen.getByText("This week's focus:")).toBeInTheDocument();
    expect(screen.getByText(/kurang manis for drinks/)).toBeInTheDocument();
    expect(screen.getByText('0 of 5')).toBeInTheDocument();
  });

  it('gives screen readers the longer description', () => {
    render(<WeeklyFocusCard label="Kurang manis for drinks" progressLabel="2 of 3" progressDescription="2 of 3 drinks kurang or kosong so far" />);
    expect(screen.getByText('2 of 3')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('2 of 3 drinks kurang or kosong so far')).toHaveClass('sr-only');
  });

  it('is a button when it has an action', async () => {
    const onPress = vi.fn();
    render(<WeeklyFocusCard label="Half rice at nasi kandar" progressLabel="1 of 2" onPress={onPress} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /half rice at nasi kandar/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps a capitalised first word as it is', () => {
    expect(focusPhrase('Keep eating days under 12 hours')).toBe('keep eating days under 12 hours');
    expect(focusPhrase('MyFCD portions')).toBe('MyFCD portions');
  });
});
