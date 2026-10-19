import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CorrectionScopePrompt, ScopePicker, type CorrectionScope } from './CorrectionScopePrompt';

function Harness({ initial = 'once' as CorrectionScope }) {
  const [value, setValue] = useState<CorrectionScope>(initial);
  return <ScopePicker value={value} onChange={setValue} />;
}

describe('CorrectionScopePrompt', () => {
  it('offers Yes and Just this time', async () => {
    const onYes = vi.fn();
    const onJustThisTime = vi.fn();
    render(
      <CorrectionScopePrompt
        message="You've corrected the rice portion here twice. Make big rice the default?"
        onYes={onYes}
        onJustThisTime={onJustThisTime}
      />,
    );
    expect(screen.getByRole('region', { name: /Make big rice the default\?/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Just this time' }));
    expect(onYes).toHaveBeenCalledOnce();
    expect(onJustThisTime).toHaveBeenCalledOnce();
  });
});

describe('ScopePicker', () => {
  it('is a radio group with one checked option', () => {
    render(<Harness initial="place" />);
    expect(screen.getByRole('radiogroup', { name: 'Apply this fix' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Always at this Place' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'This time' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps only the checked option in the tab order', () => {
    render(<Harness initial="dish" />);
    expect(screen.getByRole('radio', { name: 'Always for this dish' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'This time' })).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'Always for this dish' }));
    expect(screen.getByRole('radio', { name: 'Always for this dish' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves and selects with arrow keys, wrapping at the ends', async () => {
    render(<Harness />);
    const first = screen.getByRole('radio', { name: 'This time' });
    first.focus();
    await userEvent.keyboard('{ArrowDown}');
    const place = screen.getByRole('radio', { name: 'Always at this Place' });
    expect(place).toHaveAttribute('aria-checked', 'true');
    expect(place).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    const dish = screen.getByRole('radio', { name: 'Always for this dish' });
    expect(dish).toHaveAttribute('aria-checked', 'true');
    expect(dish).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(first).toHaveAttribute('aria-checked', 'true');
  });
});
