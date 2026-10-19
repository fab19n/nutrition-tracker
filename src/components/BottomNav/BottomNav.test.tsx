import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomNav } from './BottomNav';

describe('BottomNav', () => {
  it('marks the active tab as the current page', () => {
    render(<BottomNav active="diary" onNavigate={() => {}} onLog={() => {}} />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diary' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Today' })).not.toHaveAttribute('aria-current');
  });

  it('navigates between tabs and opens Log from the centre button', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onLog = vi.fn();
    render(<BottomNav active="today" onNavigate={onNavigate} onLog={onLog} />);
    await user.click(screen.getByRole('button', { name: 'Insights' }));
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    expect(onNavigate).toHaveBeenCalledWith('insights');
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it('keeps tab order Today, Diary, Log, Insights, More', () => {
    render(<BottomNav active="today" onNavigate={() => {}} onLog={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual([
      'Today',
      'Diary',
      'Log food',
      'Insights',
      'More',
    ]);
  });

  it('reads out a badge on the tab', () => {
    render(<BottomNav active="today" onNavigate={() => {}} onLog={() => {}} badges={{ today: true }} />);
    expect(screen.getByRole('button', { name: 'Today, Check-in waiting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insights' })).toBeInTheDocument();
  });
});
