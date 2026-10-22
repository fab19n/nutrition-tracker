/*
 * Reminders (S38): More › Settings › Reminders › Turn on › Send a test notification, the whole app
 * over the sample week. The reminders engine (src/push) is a stand-in: Chrome already allows
 * notifications, so Turn on runs at once; nothing reaches a push service.
 */
import { screen, waitFor, within } from '@testing-library/react';
import type { PushEngineState, TestOutcome, TurnOnResult } from '@/push';
import { useUiStore } from '@/state/ui';
import { setupFlows, SLOW, startApp } from './harness';

const push = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: PushEngineState } = { state: { phase: 'off', permission: 'granted', hasRecord: false } };
  const set = (state: PushEngineState) => {
    current.state = state;
    for (const listener of [...listeners]) listener();
  };
  return {
    current,
    listeners,
    set,
    turnOnPush: vi.fn(async (): Promise<TurnOnResult> => {
      set({ phase: 'on', permission: 'granted', hasRecord: true, device: { failures: 0 } });
      return { ok: true };
    }),
    sendTestPush: vi.fn(async (): Promise<TestOutcome> => ({ ok: true })),
  };
});

vi.mock('@/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/push')>()),
  getPushState: () => push.current.state,
  subscribePush: (listener: () => void) => {
    push.listeners.add(listener);
    return () => push.listeners.delete(listener);
  },
  turnOnPush: () => push.turnOnPush(),
  sendTestPush: () => push.sendTestPush(),
  refreshPush: async () => {},
  forgetPush: async () => {},
}));

setupFlows();

beforeEach(() => {
  push.current.state = { phase: 'off', permission: 'granted', hasRecord: false };
});

describe('F-reminders', () => {
  it('turns reminders on for this phone and sends a test', async () => {
    const { user, router } = startApp('/more');

    await user.click(await screen.findByRole('button', { name: /^Settings/ }, SLOW));
    const row = await screen.findByRole('button', { name: /^Reminders/ }, SLOW);
    expect(row).toHaveTextContent('Off on this device');
    await user.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: 'Reminders' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/reminders');

    const card = (await screen.findByText('Off on this device', {}, SLOW)).closest('section') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Reminders on for this device'));
    expect(await screen.findByText('On for this device')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send a test notification' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Test sent. It should arrive in a few seconds.'));
    expect(push.turnOnPush).toHaveBeenCalledTimes(1);
    expect(push.sendTestPush).toHaveBeenCalledTimes(1);

    // Back to Settings, whose row now says so.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: /^Reminders/ }, SLOW)).toHaveTextContent('On · check-in at 10am');
  });
});
