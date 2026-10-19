import { act, fireEvent, render, screen } from '@testing-library/react';
import { Toast, TOAST_DURATION_MS } from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the message and dismisses itself after 3.5s', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved · ~880 kcal" onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved · ~880 kcal');
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays up when durationMs is null', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Couldn't save" tone="error" durationMs={null} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('runs Undo and then dismisses', () => {
    const calls: string[] = [];
    render(<Toast message="Saved · ~880 kcal" onUndo={() => calls.push('undo')} onDismiss={() => calls.push('dismiss')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls).toEqual(['undo', 'dismiss']);
  });

  it('hides the action without onUndo', () => {
    render(<Toast message="Yesterday confirmed" onDismiss={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('pauses the timer while the action has focus', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Saved · ~880 kcal" onUndo={() => {}} onDismiss={onDismiss} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.focus(undo);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(undo);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not restart the timer when the parent re-renders with a new callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Toast message="Saving for Saturday" onDismiss={first} />);
    act(() => vi.advanceTimersByTime(2000));
    rerender(<Toast message="Saving for Saturday" onDismiss={second} />);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 2000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
