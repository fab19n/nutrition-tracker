import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BONUS_LIMITS, checkBonus } from './bonusForm';
import { OneOffBonus } from './OneOffBonus';

describe('checkBonus', () => {
  it('accepts a whole number of kcal and trims the reason', () => {
    expect(checkBonus('300', '  A hike ')).toEqual({ kcal: 300, reason: 'A hike', errors: {}, valid: true });
    expect(checkBonus('1,200', '')).toMatchObject({ kcal: 1200, reason: '', valid: true });
    expect(checkBonus(' 3000 ', 'Futsal tournament')).toMatchObject({ kcal: 3000, valid: true });
  });

  it('explains a missing, odd or out-of-range amount', () => {
    expect(checkBonus('', 'A hike').errors.kcal).toBe('Enter how many kcal to add.');
    expect(checkBonus('abc', '').errors.kcal).toBe('Use a whole number, like 300.');
    expect(checkBonus('250.5', '').errors.kcal).toBe('Use a whole number, like 300.');
    expect(checkBonus('-50', '').errors.kcal).toBe('Use a whole number, like 300.');
    expect(checkBonus('0', '').errors.kcal).toBe('Add at least 1 kcal.');
    expect(checkBonus('3001', '').errors.kcal).toBe('Up to 3,000 kcal for one day.');
    expect(checkBonus('3001', '').valid).toBe(false);
  });

  it('keeps the reason short', () => {
    const long = 'x'.repeat(BONUS_LIMITS.maxReason + 1);
    expect(checkBonus('300', long)).toMatchObject({ valid: false, errors: { reason: 'Keep it to 60 characters.' } });
    expect(checkBonus('300', 'x'.repeat(BONUS_LIMITS.maxReason)).valid).toBe(true);
  });
});

describe('OneOffBonus (C52)', () => {
  it('reads "+ … kcal today" and submits the amount and reason', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<OneOffBonus onSubmit={onSubmit} />);

    expect(screen.getByText('kcal today')).toBeInTheDocument();
    const kcal = screen.getByRole('textbox', { name: 'Extra kcal today' });
    expect(kcal).toHaveAttribute('placeholder', '300');
    expect(screen.getByRole('textbox', { name: 'Reason (optional)' })).toHaveAttribute('placeholder', 'A hike');

    await user.type(kcal, '300');
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'Futsal tournament');
    await user.click(screen.getByRole('button', { name: 'Add bonus' }));
    expect(onSubmit).toHaveBeenCalledWith({ kcal: 300, reason: 'Futsal tournament' });
  });

  it('shows messages instead of submitting when the amount is missing or too big', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<OneOffBonus onSubmit={onSubmit} />);

    expect(screen.queryByText('Enter how many kcal to add.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add bonus' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const kcal = screen.getByRole('textbox', { name: 'Extra kcal today' });
    expect(kcal).toHaveAttribute('aria-invalid', 'true');
    expect(kcal).toHaveAccessibleDescription('Enter how many kcal to add.');

    await user.type(kcal, '5000{Enter}');
    expect(screen.getByText('Up to 3,000 kcal for one day.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(kcal);
    await user.type(kcal, '450{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ kcal: 450, reason: '' });
  });

  it('flags a long reason', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<OneOffBonus onSubmit={onSubmit} defaultKcal="300" />);
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'y'.repeat(61));
    await user.click(screen.getByRole('button', { name: 'Add bonus' }));
    expect(screen.getByText('Keep it to 60 characters.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('names the day, waits while saving and can open with values and messages', () => {
    const onSubmit = vi.fn();
    render(<OneOffBonus onSubmit={onSubmit} dayLabel="yesterday" busy defaultKcal="abc" defaultTried autoFocus />);
    expect(screen.getByText('kcal yesterday')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Extra kcal yesterday' })).toHaveFocus();
    expect(screen.getByText('Use a whole number, like 300.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add bonus' })).toBeDisabled();
  });
});
