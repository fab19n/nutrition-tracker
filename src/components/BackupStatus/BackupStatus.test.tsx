import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackupStatus, type BackupStatusProps } from './BackupStatus';

function setup(state: BackupStatusProps['state']) {
  const props = {
    state,
    lastBackupLabel: 'Sun 9:00pm',
    keepLabel: 'Last 12',
    onConnect: vi.fn(),
    onBackupNow: vi.fn(),
    onDisconnect: vi.fn(),
    onRetry: vi.fn(),
  };
  render(<BackupStatus {...props} />);
  return props;
}

describe('BackupStatus', () => {
  it('not connected: explains the scope and offers Connect only', async () => {
    const props = setup('notConnected');
    expect(screen.getByText(/can only see files it creates/)).toBeInTheDocument();
    expect(screen.queryByText('Last backup')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect Google Drive' }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it('connected: shows last backup and keeps, with Back up now and Disconnect', async () => {
    const props = setup('connected');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(screen.getByText('Sun 9:00pm')).toBeInTheDocument();
    expect(screen.getByText('Last 12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(props.onBackupNow).toHaveBeenCalledTimes(1);
    expect(props.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('in progress: the backup button is busy', () => {
    setup('inProgress');
    expect(screen.getByRole('status')).toHaveTextContent('Backing up');
    expect(screen.getByRole('button', { name: 'Backing up…' })).toBeDisabled();
  });

  it('failed: shows the error and Retry', async () => {
    const props = setup('failed');
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach Google Drive.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
