import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePickButton } from './FilePickButton';

const file = (name = 'backup.json') => new File(['{}'], name, { type: 'application/json' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FilePickButton', () => {
  it('opens the picker when the button is pressed', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<FilePickButton label="Choose a backup file" onFile={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Choose a backup file' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(screen.getByLabelText('Backup file'));
  });

  it('passes the chosen file on', async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<FilePickButton label="Choose a backup file" onFile={onFile} />);

    const chosen = file('kira-makan-backup-2026-10-16.json');
    await user.upload(screen.getByLabelText('Backup file'), chosen);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(chosen);
  });

  it('resets the picker, so the same file can be chosen again', async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<FilePickButton label="Choose a backup file" onFile={onFile} />);
    const input = screen.getByLabelText<HTMLInputElement>('Backup file');

    const chosen = file();
    await user.upload(input, chosen);
    expect(input.files).toHaveLength(0);
    await user.upload(input, chosen);
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the picker is cancelled', async () => {
    const onFile = vi.fn();
    render(<FilePickButton label="Choose a backup file" onFile={onFile} />);
    const input = screen.getByLabelText<HTMLInputElement>('Backup file');

    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFile).not.toHaveBeenCalled();
  });

  it('is disabled when told to be, and while busy', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    const { rerender } = render(<FilePickButton label="Choose a backup file" onFile={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Choose a backup file' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose a backup file' }));
    expect(click).not.toHaveBeenCalled();

    rerender(<FilePickButton label="Choose a backup file" onFile={() => {}} busy />);
    const button = screen.getByRole('button', { name: 'Choose a backup file' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('offers JSON files by default, and takes another accept and label', () => {
    const { rerender } = render(<FilePickButton label="Choose" onFile={() => {}} />);
    expect(screen.getByLabelText('Backup file')).toHaveAttribute('accept', '.json,application/json');
    expect(screen.getByLabelText('Backup file')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Backup file')).toHaveAttribute('tabindex', '-1');

    rerender(<FilePickButton label="Choose" onFile={() => {}} accept=".csv" inputLabel="Spreadsheet" />);
    expect(screen.getByLabelText('Spreadsheet')).toHaveAttribute('accept', '.csv');
  });

  it('is a secondary medium button unless told otherwise', () => {
    const { rerender } = render(<FilePickButton label="Choose" onFile={() => {}} />);
    expect(screen.getByRole('button', { name: 'Choose' }).className).toMatch(/secondary/);
    expect(screen.getByRole('button', { name: 'Choose' }).className).toMatch(/md/);

    rerender(<FilePickButton label="Choose" onFile={() => {}} variant="ghost" size="lg" />);
    expect(screen.getByRole('button', { name: 'Choose' }).className).toMatch(/ghost/);
    expect(screen.getByRole('button', { name: 'Choose' }).className).toMatch(/lg/);
  });
});
