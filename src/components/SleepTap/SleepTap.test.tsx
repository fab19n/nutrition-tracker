import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SleepTap } from './SleepTap';

describe('SleepTap', () => {
  it('shown: a single "Going to sleep" button', async () => {
    const user = userEvent.setup();
    const onTap = vi.fn();
    render(<SleepTap state="shown" onTap={onTap} onUndo={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Going to sleep' }));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('tapped: announces good night with the time and offers Undo', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(<SleepTap state="tapped" timeLabel="1:30am" onTap={() => {}} onUndo={onUndo} />);
    expect(screen.getByRole('status')).toHaveTextContent('Good night · 1:30am');
    expect(screen.queryByRole('button', { name: 'Going to sleep' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
