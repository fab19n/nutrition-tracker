import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimePicker, type TimeOption } from './TimePicker';

const OPTIONS: TimeOption[] = [
  { id: 'now', label: 'Now' },
  { id: '30m', label: '30 min ago' },
  { id: '1h', label: '1 h ago' },
];

describe('TimePicker', () => {
  it('marks the selected quick option and reports picks', async () => {
    const onSelect = vi.fn();
    render(<TimePicker options={OPTIONS} selectedId="now" onSelect={onSelect} onCustom={() => {}} />);
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '1 h ago' }));
    expect(onSelect).toHaveBeenCalledWith('1h');
  });

  it('reports a custom time and shows the after-midnight hint', () => {
    const onCustom = vi.fn();
    render(
      <TimePicker options={OPTIONS} onSelect={() => {}} customValue="00:40" onCustom={onCustom} afterMidnightHint="Counts toward Thu" />,
    );
    const input = screen.getByLabelText('Pick a time');
    expect(input).toHaveValue('00:40');
    expect(screen.getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Counts toward Thu')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '01:15' } });
    expect(onCustom).toHaveBeenCalledWith('01:15');
  });
});
