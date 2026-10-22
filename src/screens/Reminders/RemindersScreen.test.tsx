import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import type { SessionState } from '@/auth/session';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import type { PushEngineState, TestOutcome, TurnOnResult } from '@/push';
import { resetUiState, useUiStore } from '@/state/ui';
import type { SyncPhase } from '@/sync';
import { NOTIFICATIONS_PRIMER, PRIMER_LINES } from './NotificationsSheet';
import RemindersScreen from './RemindersScreen';

/** Stands in for the reminders engine (src/push/index.ts): its state, and every action a mock. */
const push = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: PushEngineState } = { state: { phase: 'off', permission: 'default', hasRecord: false } };
  return {
    current,
    listeners,
    set(state: PushEngineState) {
      current.state = state;
      for (const listener of [...listeners]) listener();
    },
    turnOnPush: vi.fn<() => Promise<TurnOnResult>>(async () => ({ ok: true })),
    turnOffPush: vi.fn<() => Promise<void>>(async () => {}),
    sendTestPush: vi.fn<() => Promise<TestOutcome>>(async () => ({ ok: true })),
    retryPush: vi.fn<() => Promise<TurnOnResult>>(async () => ({ ok: true })),
    repairPush: vi.fn<() => Promise<TurnOnResult>>(async () => ({ ok: true })),
    refreshPush: vi.fn<() => Promise<void>>(async () => {}),
  };
});

vi.mock('@/push', () => ({
  getPushState: () => push.current.state,
  subscribePush: (listener: () => void) => {
    push.listeners.add(listener);
    return () => push.listeners.delete(listener);
  },
  turnOnPush: () => push.turnOnPush(),
  turnOffPush: () => push.turnOffPush(),
  sendTestPush: () => push.sendTestPush(),
  retryPush: () => push.retryPush(),
  repairPush: () => push.repairPush(),
  refreshPush: () => push.refreshPush(),
}));

const auth = vi.hoisted(() => ({
  configured: true,
  state: { status: 'signedIn', userId: 'user-1', email: 'you@example.com' } as SessionState,
  signIn: vi.fn<(email: string, password: string) => Promise<void>>(async () => {}),
}));

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => auth.configured,
  useSession: () => auth.state,
  signIn: (email: string, password: string) => auth.signIn(email, password),
}));

const sync = vi.hoisted(() => ({ phase: 'idle' as SyncPhase, syncNow: vi.fn<() => Promise<void>>(async () => {}) }));

vi.mock('@/sync/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/hooks')>()),
  useSyncView: () => ({ phase: sync.phase }),
}));

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  syncNow: () => sync.syncNow(),
}));

const ON: PushEngineState = { phase: 'on', permission: 'granted', hasRecord: true, device: { failures: 0 } };

function renderReminders(entries: string[] = [PATHS.reminders]) {
  const router = createMemoryRouter(
    [
      { path: '/more/reminders', element: <RemindersScreen /> },
      { path: '/more/settings', element: <h1>Settings screen</h1> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const toast = () => useUiStore.getState().toast?.message;
const reminders = async () => (await db.profile.get('me'))?.reminders;

/** The device card, found by its status line. */
async function card(): Promise<HTMLElement> {
  const status = await screen.findByRole('status');
  const found = status.closest('section');
  if (!(found instanceof HTMLElement)) throw new Error('No device card');
  return found;
}

beforeEach(async () => {
  push.current.state = { phase: 'off', permission: 'default', hasRecord: false };
  for (const mock of [push.turnOnPush, push.retryPush, push.repairPush]) mock.mockReset().mockResolvedValue({ ok: true });
  push.turnOffPush.mockReset().mockResolvedValue(undefined);
  push.sendTestPush.mockReset().mockResolvedValue({ ok: true });
  push.refreshPush.mockReset().mockResolvedValue(undefined);
  auth.configured = true;
  auth.state = { status: 'signedIn', userId: 'user-1', email: 'you@example.com' };
  auth.signIn.mockReset().mockResolvedValue(undefined);
  sync.phase = 'idle';
  sync.syncNow.mockReset().mockResolvedValue(undefined);
  resetUiState();
  await resetAll();
  // The sample week: its clock is pinned, so the quiet hours and the gap count never move.
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('S38 Reminders › this device', () => {
  it('says reminders are not in this version, with nothing to set', async () => {
    push.current.state = { phase: 'unconfigured', permission: 'unsupported', hasRecord: false };
    renderReminders();
    expect(await screen.findByRole('heading', { level: 1, name: 'Reminders' })).toBeInTheDocument();
    expect(screen.getByText('A few gentle nudges, never during quiet hours.')).toBeInTheDocument();
    expect(await screen.findByText("Reminders aren't set up in this version")).toBeInTheDocument();
    expect(screen.queryByText('What to send')).toBeNull();
    expect(screen.queryByRole('button', { name: /Quiet hours/ })).toBeNull();
  });

  it('is off in demo mode, and the preferences still change', async () => {
    const user = userEvent.setup();
    push.current.state = { phase: 'demo', permission: 'default', hasRecord: false };
    renderReminders();
    expect(await screen.findByText('Off in demo mode')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
    await user.click(await screen.findByRole('switch', { name: 'Weekly review' }));
    await waitFor(async () => expect(await reminders()).toEqual({ weeklyReview: false }));
  });

  it('asks to sign in, and the sign-in sheet signs in', async () => {
    const user = userEvent.setup();
    push.current.state = { phase: 'signedOut', permission: 'default', hasRecord: false };
    renderReminders();
    expect(await screen.findByText('Sign in to get reminders')).toBeInTheDocument();
    await user.click(within(await card()).getByRole('button', { name: 'Sign in' }));
    const sheet = await screen.findByRole('dialog', { name: 'Sign in' });
    await user.type(within(sheet).getByLabelText('Email'), 'you@example.com');
    await user.type(within(sheet).getByLabelText('Password'), 'secret');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(toast()).toBe('Signed in'));
    expect(auth.signIn).toHaveBeenCalledWith('you@example.com', 'secret');
    expect(sync.syncNow).toHaveBeenCalled();
    expect(push.refreshPush).toHaveBeenCalledTimes(2);
  });

  it('says reminders may still arrive when signed out with a subscription here', async () => {
    push.current.state = { phase: 'signedOut', permission: 'granted', hasRecord: true };
    renderReminders();
    expect(await screen.findByText('Sign in to manage reminders')).toBeInTheDocument();
    expect(screen.getByText('Reminders can still arrive on this device. Sign in again to check them or turn them off.')).toBeInTheDocument();
  });

  describe('turning on', () => {
    it('explains first, then asks Chrome from the tap', async () => {
      const user = userEvent.setup();
      renderReminders();
      expect(await screen.findByText('Off on this device')).toBeInTheDocument();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      expect(within(sheet).getByRole('heading', { name: 'A quick check each morning?' })).toBeInTheDocument();
      expect(within(sheet).getByText('One question about yesterday, so missed meals never count as savings. Quiet hours follow your sleep taps.')).toBeInTheDocument();
      await user.click(within(sheet).getByRole('button', { name: 'Turn on reminders' }));
      expect(push.turnOnPush).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn on reminders' })).toBeNull());
      expect(toast()).toBe('Reminders on for this device');
    });

    it('says so when the prompt was closed, and stays open to ask again', async () => {
      const user = userEvent.setup();
      push.turnOnPush.mockResolvedValue({ ok: false, problem: 'dismissed' });
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      await user.click(within(sheet).getByRole('button', { name: 'Turn on reminders' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent("Notifications weren't allowed. Tap Turn on reminders to ask again.");
      expect(screen.getByRole('dialog', { name: 'Turn on reminders' })).toBeInTheDocument();
      expect(toast()).toBeUndefined();
    });

    it('closes with a toast when Chrome blocked it', async () => {
      const user = userEvent.setup();
      push.turnOnPush.mockResolvedValue({ ok: false, problem: 'denied' });
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      await user.click(within(await screen.findByRole('dialog', { name: 'Turn on reminders' })).getByRole('button', { name: 'Turn on reminders' }));
      await waitFor(() => expect(toast()).toBe('Chrome blocked notifications for Kira Makan'));
      expect(screen.queryByRole('dialog', { name: 'Turn on reminders' })).toBeNull();
    });

    it('waits for a connection', async () => {
      const user = userEvent.setup();
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(within(sheet).getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
      expect(within(sheet).getByRole('alert')).toHaveTextContent("You're offline. Reminders can be turned on once you're back online.");
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(within(sheet).getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
    });

    it("stays open with a line when the app isn't ready to ask", async () => {
      const user = userEvent.setup();
      push.turnOnPush.mockResolvedValue({ ok: false, problem: 'noWorker' });
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      await user.click(within(sheet).getByRole('button', { name: 'Turn on reminders' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent("The app isn't ready yet. Close Kira Makan fully, open it again and try once more.");
      expect(screen.getByRole('dialog', { name: 'Turn on reminders' })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
      expect(toast()).toBeUndefined();
    });

    it.each<TurnOnResult>([
      { ok: false, problem: 'notSetUp' },
      { ok: false, problem: 'offline' },
      { ok: false, problem: 'unreachable' },
      { ok: false, problem: 'needsSignIn' },
      { ok: false, problem: 'failed' },
    ])('closes without a toast on %o: the card says what happened', async (result) => {
      const user = userEvent.setup();
      push.turnOnPush.mockResolvedValue(result);
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      await user.click(within(sheet).getByRole('button', { name: 'Turn on reminders' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn on reminders' })).toBeNull());
      expect(toast()).toBeUndefined();
    });

    it('says Turning on… while Chrome and the account answer, and holds the sheet open', async () => {
      const user = userEvent.setup();
      let answer: (result: TurnOnResult) => void = () => undefined;
      push.turnOnPush.mockImplementation(() => new Promise<TurnOnResult>((resolve) => (answer = resolve)));
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      const sheet = await screen.findByRole('dialog', { name: 'Turn on reminders' });
      await user.click(within(sheet).getByRole('button', { name: 'Turn on reminders' }));

      const busy = await within(sheet).findByRole('button', { name: 'Turning on…' });
      expect(busy).toHaveAttribute('aria-busy', 'true');
      expect(busy).toBeDisabled();
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(sheet.parentElement?.previousElementSibling as HTMLElement);
      expect(within(sheet).queryByRole('button', { name: 'Close' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Turn on reminders' })).toBeInTheDocument();
      expect(push.turnOnPush).toHaveBeenCalledTimes(1);

      await act(async () => answer({ ok: true }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Turn on reminders' })).toBeNull());
      expect(toast()).toBe('Reminders on for this device');
    });

    it('turns on at once when Chrome already allows notifications', async () => {
      const user = userEvent.setup();
      push.current.state = { phase: 'off', permission: 'granted', hasRecord: false };
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn on' }));
      expect(push.turnOnPush).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Turn on reminders' })).toBeNull();
      await waitFor(() => expect(toast()).toBe('Reminders on for this device'));
    });
  });

  it.each<[PushEngineState['phase'], string]>([
    ['denied', 'Notifications are blocked'],
    ['unsupported', "This browser can't show reminders"],
    ['iosNeedsInstall', 'Add Kira Makan to your Home Screen first'],
    ['devServer', 'Reminders work in the built app'],
  ])('explains %s', async (phase, title) => {
    push.current.state = { phase, permission: phase === 'denied' ? 'denied' : 'default', hasRecord: false };
    renderReminders();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(within(await card()).queryAllByRole('button')).toHaveLength(0);
  });

  describe('on', () => {
    it('says when the last reminder went, and sends a test', async () => {
      const user = userEvent.setup();
      push.current.state = { ...ON, device: { failures: 0, lastOkAt: new Date(Date.now() - 5 * 60_000).toISOString() } };
      renderReminders();
      expect(await screen.findByText('On for this device')).toBeInTheDocument();
      expect(screen.getByText('Last reminder sent 5 min ago')).toBeInTheDocument();

      const outcomes: [TestOutcome, string][] = [
        [{ ok: true }, 'Test sent. It should arrive in a few seconds.'],
        [{ ok: false, kind: 'notSetUp' }, "Reminders aren't set up on the server yet."],
        [{ ok: false, kind: 'offline' }, "You're offline. Try again when you're back online."],
        [{ ok: false, kind: 'rateLimited' }, "That's a few tests already. Try again in a few minutes."],
        [{ ok: false, kind: 'keyMismatch' }, 'This app and the server use different reminder keys. See DEPLOY.md part 10.'],
      ];
      for (const [outcome, line] of outcomes) {
        push.sendTestPush.mockResolvedValueOnce(outcome);
        await user.click(within(await card()).getByRole('button', { name: 'Send a test notification' }));
        await waitFor(() => expect(toast()).toBe(line));
        await waitFor(() => expect(within(screen.getByRole('status').closest('section') as HTMLElement).getByRole('button', { name: 'Send a test notification' })).toBeEnabled());
      }
      expect(push.sendTestPush).toHaveBeenCalledTimes(5);
    });

    it('turns off', async () => {
      const user = userEvent.setup();
      push.current.state = ON;
      renderReminders();
      await user.click(within(await card()).getByRole('button', { name: 'Turn off' }));
      expect(push.turnOffPush).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(toast()).toBe('Reminders off for this device'));
    });

    it('offers Set up again when reminders stop arriving', async () => {
      const user = userEvent.setup();
      push.current.state = { ...ON, device: { failures: 3, lastError: 'http 403' } };
      renderReminders();
      expect(await screen.findByText("Reminders aren't reaching this device")).toBeInTheDocument();
      await user.click(within(await card()).getByRole('button', { name: 'Set up again' }));
      expect(push.repairPush).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(toast()).toBe('Reminders on for this device'));
    });

    it('says sync is off here, when it is', async () => {
      push.current.state = ON;
      sync.phase = 'paused';
      renderReminders();
      expect(await screen.findByText('Sync is off on this device, so reminders go by what your account last had.')).toBeInTheDocument();
    });

    it('keeps the buttons waiting while a test goes', async () => {
      push.current.state = { ...ON, busy: 'test' };
      renderReminders();
      expect(within(await card()).getByRole('button', { name: 'Sending…' })).toBeDisabled();
      expect(within(await card()).getByRole('button', { name: 'Turn off' })).toBeDisabled();
    });
  });

  it('tries again when the server is not set up', async () => {
    const user = userEvent.setup();
    push.current.state = { phase: 'problem', permission: 'granted', hasRecord: true, error: 'notSetUp' };
    renderReminders();
    expect(await screen.findByText("Reminders aren't set up on the server")).toBeInTheDocument();
    expect(screen.getByText('Your diary is fine. Once the reminder setup is done in Supabase, tap Try again.')).toBeInTheDocument();
    await user.click(within(await card()).getByRole('button', { name: 'Try again' }));
    expect(push.retryPush).toHaveBeenCalledTimes(1);
  });

  it('waits for a connection on the card, and Try again tries at once', async () => {
    const user = userEvent.setup();
    push.current.state = { phase: 'problem', permission: 'granted', hasRecord: true, error: 'offline' };
    renderReminders();
    expect(await screen.findByText('Waiting for a connection')).toBeInTheDocument();
    expect(screen.getByText("It finishes turning on when you're back online.")).toBeInTheDocument();
    push.retryPush.mockResolvedValue({ ok: false, problem: 'offline' });
    await user.click(within(await card()).getByRole('button', { name: 'Try again' }));
    expect(push.retryPush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(screen.getByRole('status').closest('section') as HTMLElement).getByRole('button', { name: 'Try again' })).toBeEnabled());
    expect(toast()).toBeUndefined();
  });

  it('says nothing more when Set up again fails: the card does', async () => {
    const user = userEvent.setup();
    push.current.state = { ...ON, device: { failures: 3 } };
    push.repairPush.mockResolvedValue({ ok: false, problem: 'unreachable' });
    renderReminders();
    await user.click(within(await card()).getByRole('button', { name: 'Set up again' }));
    expect(push.repairPush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(screen.getByRole('status').closest('section') as HTMLElement).getByRole('button', { name: 'Set up again' })).toBeEnabled());
    expect(toast()).toBeUndefined();
  });

  it('checks this device when it opens', async () => {
    renderReminders();
    await screen.findByText('Off on this device');
    expect(push.refreshPush).toHaveBeenCalledTimes(1);
  });
});

describe('S38 Reminders › what to send', () => {
  it('saves each switch to the synced profile', async () => {
    const user = userEvent.setup();
    renderReminders();
    await user.click(await screen.findByRole('switch', { name: 'Gap nudges' }));
    await user.click(screen.getByRole('switch', { name: 'Weekly review' }));
    await user.click(screen.getByRole('switch', { name: 'Target suggestions' }));
    await waitFor(async () => expect(await reminders()).toEqual({ gapNudges: false, weeklyReview: false, targetSuggestion: false }));
    expect(screen.getByRole('switch', { name: 'Gap nudges' })).not.toBeChecked();

    expect(screen.getByRole('button', { name: /^Check-in time/ })).toHaveTextContent('10am');
    await user.click(screen.getByRole('switch', { name: 'Morning check-in' }));
    await waitFor(async () => expect((await reminders())?.checkIn).toBe(false));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Check-in time/ })).toBeNull());
  });

  it('picks the check-in time', async () => {
    const user = userEvent.setup();
    renderReminders();
    await user.click(await screen.findByRole('button', { name: /^Check-in time/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Morning check-in' });
    const chips = within(within(sheet).getByRole('group', { name: 'Send it at' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['7am', '8am', '9am', '10am', '11am', '12pm']);
    expect(within(sheet).getByText("Only when yesterday isn't confirmed yet. If your quiet hours run later, it waits until they end.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '9am' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast()).toBe('Morning check-in at 9am'));
    expect(await reminders()).toEqual({ checkInAtMin: 540 });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Check-in time/ })).toHaveTextContent('9am'));
    expect(screen.queryByRole('dialog', { name: 'Morning check-in' })).toBeNull();
  });

  it('keeps gap nudges locked until the app knows your pattern', async () => {
    await db.days.clear();
    await db.profile.update('me', { startedOn: '2026-10-10' });
    await db.days.bulkPut(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'].map((logicalDay) => ({ logicalDay, status: 'complete' as const })));
    renderReminders();
    expect(await screen.findByText('Switches on once the app knows your pattern (5 of 14 days)')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Gap nudges' })).toBeNull();
  });

  it('sets quiet hours, and goes back to the sleep taps', async () => {
    const user = userEvent.setup();
    renderReminders();
    const row = await screen.findByRole('button', { name: /^Quiet hours/ });
    expect(row).toHaveTextContent('From when you usually eat, until you tap Going to sleep a few times');

    await user.click(row);
    let sheet = await screen.findByRole('dialog', { name: 'Quiet hours' });
    expect(within(sheet).getByRole('radio', { name: /Follow my sleep taps/ })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: /Follow my sleep taps/ })).toHaveTextContent(/Right now .+ to .+/);
    expect(within(sheet).queryByRole('group', { name: 'From' })).toBeNull();
    await user.click(within(sheet).getByRole('radio', { name: /Set my own/ }));
    const from = within(sheet).getByRole('group', { name: 'From' });
    expect(within(from).getAllByRole('button').map((c) => c.textContent)).toEqual(['9pm', '10pm', '11pm', '12am', '1am', '2am']);
    const until = within(sheet).getByRole('group', { name: 'Until' });
    expect(within(until).getAllByRole('button').map((c) => c.textContent)).toEqual(['6am', '7am', '8am', '9am', '10am', '11am']);
    await user.click(within(from).getByRole('button', { name: '11pm' }));
    await user.click(within(until).getByRole('button', { name: '8am' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast()).toBe('Quiet hours 11pm to 8am'));
    expect(await reminders()).toEqual({ quiet: { fromMin: 1380, untilMin: 480 } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Quiet hours/ })).toHaveTextContent('11pm–8am'));
    expect(screen.getByRole('button', { name: /^Quiet hours/ })).toHaveTextContent('Your own hours');

    await user.click(screen.getByRole('button', { name: /^Quiet hours/ }));
    sheet = await screen.findByRole('dialog', { name: 'Quiet hours' });
    expect(within(sheet).getByRole('radio', { name: /Set my own/ })).toBeChecked();
    expect(within(within(sheet).getByRole('group', { name: 'From' })).getByRole('button', { name: '11pm' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('radio', { name: /Follow my sleep taps/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast()).toBe('Quiet hours follow your sleep taps'));
    expect(await reminders()).toEqual({});
  });
});

describe('S38 Reminders › copy', () => {
  it('keeps the primer and its lines to the copy rules', () => {
    for (const line of [...Object.values(NOTIFICATIONS_PRIMER), ...Object.values(PRIMER_LINES)]) {
      expect(line).not.toMatch(/!|please|successfully/i);
      expect(line.charAt(0)).toBe(line.charAt(0).toUpperCase());
    }
  });
});

describe('S38 Reminders › back', () => {
  it('steps back to where it came from', async () => {
    const user = userEvent.setup();
    const router = renderReminders([PATHS.settings, PATHS.reminders]);
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Settings screen' })).toBeInTheDocument();
    expect(router.state.historyAction).toBe('POP');
  });

  it('opens Settings when it was opened directly', async () => {
    const user = userEvent.setup();
    const router = renderReminders();
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Settings screen' })).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
