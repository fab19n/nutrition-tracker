import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { BACKUP_FORMAT } from '@/db/export';
import { clearLastExport } from '@/db/settings';
import { resetUiState, useUiStore } from '@/state/ui';
import ExportScreen from './ExportScreen';

function renderExport() {
  const router = createMemoryRouter(
    [
      { path: '/more/export', element: <ExportScreen /> },
      { path: '/more/settings', element: <h1>Settings screen</h1> },
    ],
    { initialEntries: [PATHS.export] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Captures what would be downloaded: jsdom has no object URLs and can't follow <a download>. */
function captureDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:test/${blobs.length}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return { blobs, names, restore: () => click.mockRestore() };
}

let downloads: ReturnType<typeof captureDownloads>;

beforeEach(async () => {
  await resetAll();
  resetUiState();
  clearLastExport();
  await loadDemoData();
  downloads = captureDownloads();
});

afterEach(async () => {
  downloads.restore();
  clearLastExport();
  await resetAll();
});

describe('ExportScreen (S20)', () => {
  it('offers JSON, CSV and photos (coming later)', async () => {
    renderExport();

    expect(screen.getByRole('heading', { level: 1, name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Full backup \(JSON\)/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Spreadsheet files \(CSV\)/ })).toBeInTheDocument();
    expect(screen.getByText('Photos (zip)')).toBeInTheDocument();
    expect(screen.getByText('Coming later')).toBeInTheDocument();
    expect(screen.getByText('No export yet')).toBeInTheDocument();
  });

  it('exports a JSON backup blob and remembers the date', async () => {
    const user = userEvent.setup();
    renderExport();

    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloads.blobs).toHaveLength(1));
    const blob = downloads.blobs[0];
    expect(blob?.type).toBe('application/json');
    const backup = JSON.parse((await blob?.text()) ?? '{}') as { format: string; tables: { meals: unknown[]; profile: unknown[] } };
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.tables.meals.length).toBeGreaterThan(0);
    expect(backup.tables.profile).toHaveLength(1);
    expect(downloads.names).toEqual(['kira-makan-backup-2026-10-16.json']);

    expect(await screen.findByText('Last export: Full backup · Fri 16 Oct, 7:10pm')).toBeInTheDocument();
    expect(useUiStore.getState().toast?.message).toBe('Backup done · kira-makan-backup-2026-10-16.json');
  });

  it('exports the spreadsheet files', async () => {
    const user = userEvent.setup();
    renderExport();

    await user.click(screen.getByRole('radio', { name: /Spreadsheet files \(CSV\)/ }));
    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloads.blobs).toHaveLength(4));
    expect(downloads.blobs.every((b) => b.type.startsWith('text/csv'))).toBe(true);
    expect(downloads.names.every((n) => n.endsWith('.csv'))).toBe(true);
    expect(await screen.findByText(/^Last export: Spreadsheet files · /)).toBeInTheDocument();
  });
});
