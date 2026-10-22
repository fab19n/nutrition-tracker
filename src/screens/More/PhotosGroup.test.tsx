import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { useProfile } from '@/db/hooks';
import type { AuthResult, ConnectResult, DriveEngineState } from '@/drive';
import { resetUiState, useUiStore } from '@/state/ui';
import { PhotosGroup } from './PhotosGroup';

/**
 * Stands in for the Drive engine (src/drive/index.ts): the card reads its state, and every action
 * is a mock a test can hold or answer.
 */
const drive = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const base = {
    configured: true,
    profile: 'real' as const,
    keepPhotos: true,
    connected: false,
    gisReady: true,
    authBusy: false,
    running: false,
    online: true,
    counts: { uploads: 0, files: 0, failed: 0 },
  };
  const current: { state: DriveEngineState } = { state: base };
  return {
    base,
    current,
    listeners,
    set(patch: Partial<DriveEngineState>) {
      current.state = { ...current.state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    connectDrive: vi.fn<() => Promise<ConnectResult>>(async () => ({ ok: true, queued: 0 })),
    continueDrive: vi.fn<() => Promise<AuthResult>>(async () => ({ ok: true })),
    retryDrive: vi.fn<() => Promise<void>>(async () => {}),
    disconnectDrive: vi.fn<() => Promise<void>>(async () => {}),
    prepareDrive: vi.fn(),
  };
});

vi.mock('@/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/drive')>()),
  getDriveState: () => drive.current.state,
  subscribeDrive: (listener: () => void) => {
    drive.listeners.add(listener);
    return () => drive.listeners.delete(listener);
  },
  connectDrive: () => drive.connectDrive(),
  continueDrive: () => drive.continueDrive(),
  retryDrive: () => drive.retryDrive(),
  disconnectDrive: () => drive.disconnectDrive(),
  prepareDrive: () => drive.prepareDrive(),
}));

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const EMAIL = 'you@example.com';

function Harness() {
  const profile = useProfile();
  return profile ? <PhotosGroup profile={profile} /> : null;
}

function renderGroup() {
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

/** The Photos section, once its Drive card shows (found by the card's status line). */
async function card(): Promise<HTMLElement> {
  const status = await screen.findByRole('status');
  const found = status.closest('section');
  if (!(found instanceof HTMLElement)) throw new Error('No Photos section');
  return found;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
  drive.current.state = { ...drive.base };
  drive.connectDrive.mockReset().mockResolvedValue({ ok: true, queued: 0 });
  drive.continueDrive.mockReset().mockResolvedValue({ ok: true });
  drive.retryDrive.mockReset().mockResolvedValue(undefined);
  drive.disconnectDrive.mockReset().mockResolvedValue(undefined);
  drive.prepareDrive.mockClear();
  resetUiState();
  await resetAll();
  await loadDemoData();
  await db.profile.update('me', { demoMode: false });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetAll();
});

describe('Settings › Photos', () => {
  it('saves Keep photos', async () => {
    const user = userEvent.setup();
    renderGroup();
    expect(await screen.findByRole('heading', { level: 2, name: 'Photos' })).toBeInTheDocument();
    const toggle = await screen.findByRole('switch', { name: 'Keep photos' });
    expect(screen.getByText('Kept as a visual diary')).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(async () => expect((await db.profile.get('me'))?.keepPhotos).toBe(false));
    expect(await screen.findByText('Photos clear after estimating')).toBeInTheDocument();
  });

  it('has no Drive card without a client id', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    renderGroup();
    expect(await screen.findByRole('switch', { name: 'Keep photos' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Google Drive');
    expect(drive.prepareDrive).not.toHaveBeenCalled();
  });

  it('offers Connect when not connected, and prepares Google meanwhile', async () => {
    renderGroup();
    const box = await card();
    expect(within(box).getByText('Photos are on this device only')).toBeInTheDocument();
    expect(within(box).getByText(/Connect Google Drive to keep meal photos in your own Drive/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
    await waitFor(() => expect(drive.prepareDrive).toHaveBeenCalled());
  });

  it('Connect opens the primer; Continue with Google connects from the click, then toasts', async () => {
    const user = userEvent.setup();
    const answer = deferred<ConnectResult>();
    drive.connectDrive.mockReturnValueOnce(answer.promise);
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));

    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    expect(within(sheet).getByText('Keep meal photos in Google Drive?')).toBeInTheDocument();
    expect(within(sheet).getByText(/The app can only see files it creates\./)).toBeInTheDocument();
    const allow = within(sheet).getByRole('button', { name: 'Continue with Google' });
    // Synchronously inside the click: Chrome only opens Google's window then.
    fireEvent.click(allow);
    expect(drive.connectDrive).toHaveBeenCalledTimes(1);
    expect(await within(sheet).findByRole('button', { name: 'Connecting…' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      answer.resolve({ ok: true, queued: 2 });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connect Google Drive' })).not.toBeInTheDocument());
    expect(useUiStore.getState().toast?.message).toBe('Google Drive connected · 2 photos to upload');
  });

  it('waits as Getting ready until Google has loaded', async () => {
    const user = userEvent.setup();
    drive.current.state = { ...drive.base, gisReady: false };
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    const waiting = within(sheet).getByRole('button', { name: 'Getting ready…' });
    expect(waiting).toBeDisabled();
    act(() => drive.set({ gisReady: true }));
    expect(within(sheet).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it("after Google's script failed to load, says so and lets the button load it again", async () => {
    const user = userEvent.setup();
    drive.connectDrive.mockImplementationOnce(async () => {
      // The engine loads it again from the tap: on its way, then loaded.
      drive.set({ gisFailed: undefined });
      return { ok: false, problem: 'unavailable' };
    });
    drive.current.state = { ...drive.base, gisReady: false, gisFailed: true };
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    expect(within(sheet).getByRole('alert')).toHaveTextContent("Couldn't reach Google. Check your connection and try again.");
    const allow = within(sheet).getByRole('button', { name: 'Continue with Google' });
    expect(allow).toBeEnabled();

    await user.click(allow);
    expect(drive.connectDrive).toHaveBeenCalledTimes(1);
    expect(await within(sheet).findByRole('button', { name: 'Getting ready…' })).toBeDisabled();
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument();
    act(() => drive.set({ gisReady: true }));
    expect(within(sheet).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so offline, with the button off', async () => {
    const user = userEvent.setup();
    drive.current.state = { ...drive.base, online: false };
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    expect(within(sheet).getByRole('alert')).toHaveTextContent("You're offline. Try again when you're back online.");
    expect(within(sheet).getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  });

  it('keeps the sheet open with the reason when the window was blocked, and says nothing when closed', async () => {
    const user = userEvent.setup();
    drive.connectDrive.mockResolvedValueOnce({ ok: false, problem: 'popupBlocked' }).mockResolvedValueOnce({ ok: false, problem: 'popupClosed' });
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    await user.click(within(sheet).getByRole('button', { name: 'Continue with Google' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("The Google window didn't open. Try again.");

    await user.click(within(sheet).getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(drive.connectDrive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Connect Google Drive' })).toBeInTheDocument();
    expect(useUiStore.getState().toast).toBeNull();

    await user.click(within(sheet).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connect Google Drive' })).not.toBeInTheDocument());
  });

  it('when up to date, shows the account and disconnects after a confirm', async () => {
    const user = userEvent.setup();
    drive.current.state = { ...drive.base, connected: true, email: EMAIL, tokenExpiresAt: Date.now() + 30 * 60_000, counts: { uploads: 0, files: 0, failed: 0 } };
    renderGroup();
    const box = await card();
    expect(within(box).getAllByText('Up to date').length).toBeGreaterThan(0);
    expect(within(box).getByText('Google account')).toBeInTheDocument();
    expect(within(box).getByText(EMAIL)).toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Google Drive?' });
    expect(dialog).toHaveAccessibleDescription(
      'Photos stop uploading from this device. Photos already in Google Drive stay there, and your other devices keep showing them.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(drive.disconnectDrive).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Google Drive disconnected'));
  });

  it('says how many photos stay when disconnecting, and when it fails', async () => {
    const user = userEvent.setup();
    drive.disconnectDrive.mockRejectedValueOnce(new Error('db closed'));
    drive.current.state = { ...drive.base, connected: true, keepPhotos: false, counts: { uploads: 3, files: 0, failed: 0 } };
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Google Drive?' });
    expect(dialog).toHaveAccessibleDescription(
      "Photos stop uploading from this device. Photos already in Google Drive stay there, and your other devices keep showing them. 3 photos that haven't uploaded stay on this device.",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't disconnect. Try again."));
  });

  it('says one photo in the singular when disconnecting', async () => {
    const user = userEvent.setup();
    drive.current.state = { ...drive.base, connected: true, keepPhotos: false, counts: { uploads: 1, files: 0, failed: 0 } };
    renderGroup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Google Drive?' });
    expect(dialog).toHaveAccessibleDescription(expect.stringMatching(/ 1 photo that hasn't uploaded stays on this device\.$/));
  });

  it('Needs you: Continue asks Google from the click, and says why when it fails', async () => {
    drive.continueDrive.mockResolvedValueOnce({ ok: false, problem: 'otherAccount' });
    drive.current.state = { ...drive.base, connected: true, email: EMAIL, counts: { uploads: 3, files: 0, failed: 0 } };
    renderGroup();
    const box = await card();
    expect(within(box).getByText('3 photos waiting for Google Drive')).toBeInTheDocument();
    await waitFor(() => expect(drive.prepareDrive).toHaveBeenCalled());
    fireEvent.click(within(box).getByRole('button', { name: 'Continue' }));
    expect(drive.continueDrive).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(useUiStore.getState().toast?.message).toBe("That's a different Google account. Continue with you@example.com, or disconnect first."),
    );
  });

  it('Try again runs in place', async () => {
    const user = userEvent.setup();
    drive.current.state = { ...drive.base, connected: true, error: 'driveFull', tokenExpiresAt: Date.now() + 30 * 60_000, counts: { uploads: 2, files: 0, failed: 0 } };
    renderGroup();
    expect(await screen.findByText('Your Google Drive is full')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(drive.retryDrive).toHaveBeenCalledTimes(1);
  });

  it('in demo mode, says photo sync is off, with no buttons', async () => {
    drive.current.state = { ...drive.base, profile: 'demo' };
    renderGroup();
    const box = await card();
    expect(within(box).getByText('Photo sync is off in demo mode')).toBeInTheDocument();
    expect(within(box).queryByRole('button')).not.toBeInTheDocument();
    expect(drive.prepareDrive).not.toHaveBeenCalled();
  });
});
