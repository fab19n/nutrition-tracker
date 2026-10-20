import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatus, type SyncStatusProps } from './SyncStatus';

describe('SyncStatus', () => {
  it.each<{ tone: SyncStatusProps['tone']; icon: string; pill: string }>([
    { tone: 'ok', icon: 'cloud-check', pill: 'accent' },
    { tone: 'busy', icon: 'loader-circle', pill: 'neutral' },
    { tone: 'waiting', icon: 'cloud-off', pill: 'neutral' },
    { tone: 'attention', icon: 'cloud-alert', pill: 'amber' },
    { tone: 'off', icon: 'cloud-off', pill: 'neutral' },
  ])('$tone: the $icon icon and a $pill pill', ({ tone, icon, pill }) => {
    const { container } = render(<SyncStatus tone={tone} pill="Pill word" title="Title words" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass(`lucide-${icon}`);
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
    // Only the busy icon spins.
    expect(svg?.getAttribute('class')?.includes('spin')).toBe(tone === 'busy');
    expect(screen.getByText('Pill word').className).toContain(pill);
  });

  it('puts the title and pill in the status region, the detail and facts outside it', () => {
    render(
      <SyncStatus
        tone="ok"
        pill="Up to date"
        title="Up to date"
        detail="Last synced 5 min ago"
        facts={[{ label: 'Account', value: 'you@example.com' }]}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Up to date');
    expect(status).not.toHaveTextContent('Last synced');
    expect(screen.getByText('Last synced 5 min ago')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('you@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows progress with its value and maximum', () => {
    render(<SyncStatus tone="busy" pill="Syncing" title="Backing up" detail="340 of 1,840 entries" progress={{ done: 340, total: 1840 }} />);
    const bar = screen.getByRole('progressbar', { name: 'Backing up' });
    expect(bar).toHaveAttribute('aria-valuenow', '340');
    expect(bar).toHaveAttribute('aria-valuemax', '1840');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
  });

  it('clamps progress past the total, and shows no bar until the total is known', () => {
    const { rerender } = render(<SyncStatus tone="busy" pill="Syncing" title="Backing up" progress={{ done: 2000, total: 1840 }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1840');
    rerender(<SyncStatus tone="busy" pill="Syncing" title="Backing up" progress={{ done: 0, total: 0 }} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('runs each action', async () => {
    const user = userEvent.setup();
    const upload = vi.fn();
    const turnOff = vi.fn();
    render(
      <SyncStatus
        tone="attention"
        pill="Needs you"
        title="The copy in your account was deleted"
        actions={[
          { id: 'uploadAfterReset', label: "Upload this phone's data", onPress: upload },
          { id: 'turnOff', label: 'Turn off sync', variant: 'ghost', onPress: turnOff },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: "Upload this phone's data" }));
    await user.click(screen.getByRole('button', { name: 'Turn off sync' }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(turnOff).toHaveBeenCalledTimes(1);
  });

  it('disables a busy action and marks it busy', async () => {
    const user = userEvent.setup();
    const syncNow = vi.fn();
    render(<SyncStatus tone="busy" pill="Syncing" title="Syncing…" actions={[{ id: 'syncNow', label: 'Sync now', busy: true, onPress: syncNow }]} />);
    const button = screen.getByRole('button', { name: 'Sync now' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('announces extra as an alert', () => {
    render(<SyncStatus tone="ok" pill="Up to date" title="Up to date" extra="1 change couldn't sync. It stays on this phone." />);
    expect(screen.getByRole('alert')).toHaveTextContent("1 change couldn't sync. It stays on this phone.");
  });
});
