import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAll } from '@/db/actions';
import { createDb, db, type KiraMakanDb } from '@/db/db';
import { loadDemo } from '@/db/seed/demo';
import { clearLastExport } from '@/db/settings';
import { resetUiState, useUiStore } from '@/state/ui';
import type { EngineState } from '@/sync';
import { backupFileOf, jsonFile } from '@/test/backupFiles';
import type { RestoreReach } from './backupsModel';
import { useBackupImport } from './useBackupImport';

/** Stands in for the sync engine (src/sync): nothing real runs, and a test says what state it ends in. */
const sync = vi.hoisted(() => ({
  state: { phase: 'idle' } as EngineState,
  syncNow: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  getEngineState: () => sync.state,
  syncNow: () => sync.syncNow(),
}));

let source: KiraMakanDb;

beforeEach(async () => {
  await resetAll();
  resetUiState();
  clearLastExport();
  sync.state = { phase: 'idle' };
  sync.syncNow.mockReset().mockResolvedValue(undefined);
  source = createDb(`hook-source-${crypto.randomUUID()}`);
  await loadDemo(source);
});

afterEach(async () => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  await source.delete();
  await resetAll();
});

function renderFlow(reach: RestoreReach = 'none', extra: { today?: string; onBackupChanged?: () => void } = {}) {
  return renderHook(() => useBackupImport({ reach, word: 'phone', ...extra }));
}

/** A promise the test settles by hand. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useBackupImport', () => {
  async function pickValid(result: { current: ReturnType<typeof useBackupImport> }, name = 'kira-makan-backup-2026-10-16.json') {
    const file = await backupFileOf(source, { real: true, name });
    act(() => result.current.choose(file));
    await waitFor(() => expect(result.current.stage.stage).toBe('preview'));
  }

  it('starts idle and closed, and is dismissible', () => {
    const { result } = renderFlow();
    expect(result.current.stage).toEqual({ stage: 'idle' });
    expect(result.current.open).toBe(false);
    expect(result.current.dismissible).toBe(true);
  });

  it('reads, then previews the file without writing', async () => {
    const { result } = renderFlow();
    await pickValid(result);

    expect(result.current.open).toBe(true);
    expect(result.current.stage).toMatchObject({ stage: 'preview', fileName: 'kira-makan-backup-2026-10-16.json', comparison: null, savedAs: null, exporting: false, confirming: false });
    expect(await db.profile.count()).toBe(0);
  });

  it('compares with this device for a diary that something would be lost from, not otherwise', async () => {
    const device = renderFlow('device');
    await pickValid(device.result);
    expect(device.result.current.stage).toMatchObject({ stage: 'preview', comparison: { meals: 0, onlyHere: { meals: 0, weights: 0 } } });
    device.unmount();

    for (const reach of ['none', 'sample'] as const) {
      const { result, unmount } = renderFlow(reach);
      await pickValid(result);
      expect(result.current.stage).toMatchObject({ stage: 'preview', comparison: null });
      unmount();
    }
  });

  it('goes to an error stage for a file it can not use', async () => {
    const { result } = renderFlow();
    act(() => result.current.choose(jsonFile('nope', 'notes.json')));
    await waitFor(() => expect(result.current.stage.stage).toBe('error'));
    expect(result.current.stage).toMatchObject({ fileName: 'notes.json', problem: { title: "That file isn't a backup" } });

    act(() => result.current.close());
    expect(result.current.stage).toEqual({ stage: 'idle' });
  });

  it('ignores a second pick while the first is being read, and shows the first', async () => {
    const { result } = renderFlow();
    const slow = deferred();
    const first = await backupFileOf(source, { real: true, name: 'first.json' });
    const read = first.text.bind(first);
    Object.defineProperty(first, 'text', { value: async () => (await slow.promise, read()) });

    act(() => result.current.choose(first));
    expect(result.current.stage).toEqual({ stage: 'reading', fileName: 'first.json' });
    act(() => result.current.choose(jsonFile('{}', 'second.json')));
    expect(result.current.stage).toEqual({ stage: 'reading', fileName: 'first.json' });

    await act(async () => slow.resolve());
    await waitFor(() => expect(result.current.stage).toMatchObject({ stage: 'preview', fileName: 'first.json' }));
  });

  it('drops a read that finishes after the sheet was closed, even when another file was picked', async () => {
    const { result } = renderFlow();
    const slow = deferred();
    const first = await backupFileOf(source, { real: true, name: 'first.json' });
    const read = first.text.bind(first);
    Object.defineProperty(first, 'text', { value: async () => (await slow.promise, read()) });

    act(() => result.current.choose(first));
    act(() => result.current.close());
    expect(result.current.stage).toEqual({ stage: 'idle' });
    await pickValid(result, 'second.json');

    await act(async () => slow.resolve());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.stage).toMatchObject({ stage: 'preview', fileName: 'second.json' });
  });

  it('writes at once for none and sample, and says so with a toast on none', async () => {
    const { result } = renderFlow('none');
    await pickValid(result);
    act(() => result.current.restore());

    await waitFor(() => expect(result.current.stage).toEqual({ stage: 'idle' }));
    expect(await db.profile.count()).toBe(1);
    expect(useUiStore.getState().toast?.message).toBe(`Restored · ${await source.meals.count()} meals`);
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('asks for a confirm first for a device, and can take it back', async () => {
    const { result } = renderFlow('device');
    await pickValid(result);

    act(() => result.current.restore());
    expect(result.current.stage).toMatchObject({ stage: 'preview', confirming: true });
    expect(await db.profile.count()).toBe(0);
    act(() => result.current.cancelConfirm());
    expect(result.current.stage).toMatchObject({ stage: 'preview', confirming: false });
    // Confirming what was never asked for does nothing.
    act(() => result.current.confirm());
    expect(result.current.stage).toMatchObject({ stage: 'preview', confirming: false });
    expect(await db.profile.count()).toBe(0);

    act(() => result.current.restore());
    act(() => result.current.confirm());
    await waitFor(() => expect(result.current.stage.stage).toBe('done'));
    expect(result.current.stage).toMatchObject({ reach: 'device', word: 'phone' });
    expect(await db.profile.count()).toBe(1);
  });

  it('restores once when Restore is pressed twice quickly', async () => {
    const { result } = renderFlow('none');
    await pickValid(result);
    const write = vi.spyOn(db, 'transaction');

    act(() => {
      result.current.restore();
      result.current.restore();
    });
    await waitFor(() => expect(result.current.stage).toEqual({ stage: 'idle' }));

    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    // One transaction wrote the diary (the later calls are the live queries reading it).
    expect(write.mock.calls.filter(([mode]) => mode === 'rw')).toHaveLength(1);
  });

  it('sets no state and loses no toast when the sheet unmounts mid-restore', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { result, unmount } = renderFlow('none');
    await pickValid(result);

    act(() => result.current.restore());
    unmount();

    await waitFor(() => expect(useUiStore.getState().toast?.message).toMatch(/^Restored · /));
    expect(await db.profile.count()).toBe(1);
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('is not dismissible while restoring, and closing then does nothing', async () => {
    sync.syncNow.mockReturnValueOnce(new Promise<void>(() => {}));
    const { result } = renderFlow('account');
    await pickValid(result);
    act(() => result.current.restore());
    act(() => result.current.confirm());

    await waitFor(() => expect(result.current.stage).toMatchObject({ stage: 'restoring', step: 'catchUp' }));
    expect(result.current.dismissible).toBe(false);
    act(() => result.current.close());
    expect(result.current.stage).toMatchObject({ stage: 'restoring' });
    // Picking another file is ignored too.
    act(() => result.current.choose(jsonFile('{}', 'other.json')));
    expect(result.current.stage).toMatchObject({ stage: 'restoring', fileName: 'kira-makan-backup-2026-10-16.json' });
  });

  it('stops before writing when the catch-up does not end up to date', async () => {
    sync.syncNow.mockImplementationOnce(async () => {
      sync.state = { phase: 'offline', error: 'offline' };
    });
    const { result } = renderFlow('account');
    await pickValid(result);
    act(() => result.current.restore());
    act(() => result.current.confirm());

    await waitFor(() => expect(result.current.stage.stage).toBe('failed'));
    expect(result.current.stage).toMatchObject({ problem: { title: "Couldn't reach your account", canRetry: true } });
    expect(await db.profile.count()).toBe(0);

    // Back online, Try again re-reads nothing and restores.
    sync.state = { phase: 'idle' };
    act(() => result.current.restore());
    await waitFor(() => expect(result.current.stage.stage).toBe('done'));
    expect(await db.profile.count()).toBe(1);
  });

  it.each(['needsSignIn', 'cloudReset', 'otherAccount', 'choose', 'notSetUp'] as const)(
    'says Sync needs you, with no Try again, when the catch-up ends in %s',
    async (phase) => {
      sync.syncNow.mockImplementationOnce(async () => {
        sync.state = { phase };
      });
      const { result } = renderFlow('account');
      await pickValid(result);
      act(() => result.current.restore());
      act(() => result.current.confirm());

      await waitFor(() => expect(result.current.stage.stage).toBe('failed'));
      expect(result.current.stage).toMatchObject({ problem: { title: 'Sync needs you first', canRetry: false, needsSettings: true } });
      expect(await db.profile.count()).toBe(0);
    },
  );

  it.each(['offline', 'error'] as const)('keeps the connection message when the catch-up ends in %s', async (phase) => {
    sync.syncNow.mockImplementationOnce(async () => {
      sync.state = { phase };
    });
    const { result } = renderFlow('account');
    await pickValid(result);
    act(() => result.current.restore());
    act(() => result.current.confirm());

    await waitFor(() => expect(result.current.stage.stage).toBe('failed'));
    expect(result.current.stage).toMatchObject({ problem: { title: "Couldn't reach your account", canRetry: true } });
    expect(result.current.stage).not.toMatchObject({ problem: { needsSettings: true } });
  });

  it('does nothing for Restore outside a preview or a failure', () => {
    const { result } = renderFlow('none');
    act(() => {
      result.current.restore();
      result.current.confirm();
      result.current.cancelConfirm();
      result.current.exportFirst();
    });
    expect(result.current.stage).toEqual({ stage: 'idle' });
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  it('offers Export first only on a diary with something to lose, and when it can name the file', async () => {
    expect(renderFlow('device', { today: '2026-10-21' }).result.current.canExportFirst).toBe(true);
    expect(renderFlow('account', { today: '2026-10-21' }).result.current.canExportFirst).toBe(true);
    expect(renderFlow('device').result.current.canExportFirst).toBe(false);
    expect(renderFlow('sample', { today: '2026-10-21' }).result.current.canExportFirst).toBe(false);
    expect(renderFlow('none', { today: '2026-10-21' }).result.current.canExportFirst).toBe(false);

    // And it does nothing where it isn't offered.
    const { result } = renderFlow('none', { today: '2026-10-21' });
    await pickValid(result);
    act(() => result.current.exportFirst());
    expect(result.current.stage).toMatchObject({ stage: 'preview', exporting: false, savedAs: null });
  });

  it('lets the screen know when a backup date changed', async () => {
    const onBackupChanged = vi.fn();
    const { result } = renderFlow('none', { onBackupChanged });
    await pickValid(result);
    act(() => result.current.restore());
    await waitFor(() => expect(result.current.stage).toEqual({ stage: 'idle' }));
    expect(onBackupChanged).toHaveBeenCalledTimes(1);
  });
});
