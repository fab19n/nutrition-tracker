import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackupPreview, type BackupPreviewProps } from './BackupPreview';

const FULL: BackupPreviewProps = {
  fileName: 'kira-makan-backup-2026-10-16.json',
  exportedLine: 'Exported 16 Oct 2026, 7:10pm',
  agoLine: '34 days ago',
  rows: [
    { id: 'meals', label: 'Meals', value: '1,240' },
    { id: 'weights', label: 'Weigh-ins', value: '62' },
    { id: 'places', label: 'Places', value: '12' },
  ],
  spanLine: 'Meals from 3 Mar 2026 to 16 Oct 2026',
  photosLine: 'Photos: not in this file. Photos on this phone stay.',
};

describe('BackupPreview', () => {
  it('shows the file, when it was made, what is in it and what happens to photos', () => {
    render(<BackupPreview {...FULL} />);

    expect(screen.getByText('kira-makan-backup-2026-10-16.json')).toBeInTheDocument();
    expect(screen.getByText('Exported 16 Oct 2026, 7:10pm')).toBeInTheDocument();
    expect(screen.getByText('34 days ago')).toBeInTheDocument();
    expect(screen.getByText('Meals from 3 Mar 2026 to 16 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Photos: not in this file. Photos on this phone stay.')).toBeInTheDocument();
    const meals = screen.getByText('Meals').closest('div');
    expect(meals).not.toBeNull();
    expect(within(meals as HTMLElement).getByText('1,240').tagName).toBe('DD');
    expect(screen.getByText('Weigh-ins').tagName).toBe('DT');
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('Places')).toBeInTheDocument();
  });

  it('keeps the long file name to one line with an ellipsis, and the full name on hover', () => {
    const fileName = `${'kira-makan-backup-with-a-very-long-name-'.repeat(4)}.json`;
    render(<BackupPreview {...FULL} fileName={fileName} />);
    const name = screen.getByText(fileName);
    expect(name.className).toContain('fileName');
    expect(name).toHaveAttribute('title', fileName);
  });

  it('shows exactly the rows it is given, so a model that leaves out zero counts shows no zeros', () => {
    render(<BackupPreview {...FULL} rows={[{ id: 'meals', label: 'Meals', value: '0' }]} spanLine={undefined} agoLine={undefined} />);
    expect(screen.getAllByRole('term')).toHaveLength(1);
    expect(screen.getByText('Meals')).toBeInTheDocument();
    expect(screen.queryByText('Weigh-ins')).not.toBeInTheDocument();
    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Meals from/)).not.toBeInTheDocument();
  });

  it('has no list at all without rows', () => {
    render(<BackupPreview {...FULL} rows={[]} />);
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('says what will be lost in words with a warning icon', () => {
    const { container } = render(
      <BackupPreview
        {...FULL}
        note={{ tone: 'amber', text: 'On this phone but not in the backup: 12 meals and 3 weigh-ins. They will be lost.' }}
      />,
    );
    const note = screen.getByText('On this phone but not in the backup: 12 meals and 3 weigh-ins. They will be lost.');
    expect(note.closest('p')?.className).toContain('amber');
    const icon = note.closest('p')?.querySelector('svg');
    expect(icon).toHaveClass('lucide-triangle-alert');
    expect(icon?.closest('[aria-hidden="true"]') ?? icon).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('says nothing is lost without an icon', () => {
    const { container } = render(
      <BackupPreview {...FULL} note={{ tone: 'neutral', text: 'Everything on this phone is also in the backup.' }} />,
    );
    const note = screen.getByText('Everything on this phone is also in the backup.');
    expect(note.className).toContain('neutral');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('has no note when none is given', () => {
    const { container } = render(<BackupPreview {...FULL} exportedLine="Export date unknown" agoLine={undefined} />);
    expect(screen.getByText('Export date unknown')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText(/lost/)).not.toBeInTheDocument();
  });
});
