import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { PATHS } from '@/app/paths';
import { Toast } from '@/components/Toast/Toast';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { getInsightFeedback } from '@/db/repo';
import { clearTargetNoticeSeen, getTargetView, readTargetNoticeSeen, TARGET_FEEDBACK_ID } from '@/db/targetSuggestion';
import { resetUiState, useUiStore } from '@/state/ui';
import { loadMaintenanceWorld, MAINTENANCE_WORLD as W, pinClock } from '@/test/maintenanceWorld';
import TargetScreen from './TargetScreen';
import { useTargetDecisions } from './useTargetDecisions';

function Shell() {
  const toast = useUiStore((s) => s.toast);
  const hideToast = useUiStore((s) => s.hideToast);
  return (
    <>
      <Outlet />
      {toast ? <Toast key={toast.id} message={toast.message} onUndo={toast.undo} onDismiss={() => hideToast(toast.id)} durationMs={null} /> : null}
    </>
  );
}

function Stub({ name }: { name: string }) {
  const location = useLocation();
  return (
    <h1>
      {name} screen {location.pathname}
    </h1>
  );
}

function renderTarget() {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: PATHS.target, element: <TargetScreen /> },
          { path: PATHS.insights, element: <Stub name="Insights" /> },
          { path: PATHS.weight, element: <Stub name="Weight" /> },
        ],
      },
    ],
    { initialEntries: [PATHS.target] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

function toastMessage(): string | undefined {
  return useUiStore.getState().toast?.message;
}

beforeEach(async () => {
  resetUiState();
  clearTargetNoticeSeen();
  await resetAll();
});

afterEach(() => {
  vi.useRealTimers();
  resetUiState();
  clearTargetNoticeSeen();
});

afterAll(async () => {
  await resetAll();
});

describe('S37 TargetScreen on the demo world (day 19)', () => {
  it('shows when the real maintenance unlocks and the target history', async () => {
    await loadDemoData();
    renderTarget();
    expect(await screen.findByRole('heading', { level: 1, name: 'Your target' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Your real maintenance unlocks after 21 complete days' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Complete days in the last 4 weeks' })).toHaveAttribute('aria-valuenow', '17');
    expect(screen.getByText('17 of 21 days')).toBeInTheDocument();
    const history = screen.getByRole('list', { name: 'Target history' });
    expect(within(history).getByText('1,800 a day')).toBeInTheDocument();
    expect(within(history).getByText('Since Mon 28 Sep · starting estimate · maintenance ~2,350 · 0.5 kg a week')).toBeInTheDocument();
    expect(within(history).getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Your target only changes when you approve a change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

describe('S37 TargetScreen with a suggestion (Fri 30 Oct)', () => {
  beforeEach(async () => {
    await loadMaintenanceWorld(db);
    pinClock();
  });

  it('shows the suggestion with the working, and opening it counts as seeing the notice', async () => {
    renderTarget();
    expect(await screen.findByRole('heading', { level: 1, name: 'Target suggestion' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Your real maintenance looks like ~2,100, not 2,350' })).toBeInTheDocument();
    expect(screen.getByText('You logged ~1,820 a day, and your trend dropped 0.25 kg a week.')).toBeInTheDocument();
    const rows = screen.getByLabelText('How it was worked out');
    expect(within(rows).getByText('~1,820 a day')).toBeInTheDocument();
    expect(within(rows).getByText('−0.25 kg a week ≈ +275 a day')).toBeInTheDocument();
    expect(within(rows).getByText('~2,100 a day')).toBeInTheDocument();
    expect(screen.getByText(/^From 28 complete days, Mon 28 Sep to Sun 25 Oct\./)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Now 1,800 a day, suggested 1,550 a day' })).toBeInTheDocument();
    expect(screen.getByText('Starts tomorrow (Sat). Today and earlier days keep their target.')).toBeInTheDocument();
    expect(screen.getByText('This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change pace instead/ })).toHaveTextContent('0.25 kg a week → 1,825 a day');
    await waitFor(() => expect(readTargetNoticeSeen()).toBe(W.expected.noticeKey));
  });

  it('approves from tomorrow, and "Keep 1,800 instead" withdraws it', async () => {
    const { user } = renderTarget();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toastMessage()).toBe('Target 1,550 from tomorrow'));
    expect(await screen.findByRole('heading', { name: 'New target 1,550 starts tomorrow (Sat)' })).toBeInTheDocument();
    expect(screen.getByText('Today and earlier days keep 1,800.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Target history' })).getByText('Starts Sat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Your target' })).toBeInTheDocument();
    expect(await db.goalVersions.count()).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Keep 1,800 instead' }));
    await waitFor(() => expect(toastMessage()).toBe('Target stays at 1,800'));
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(await db.goalVersions.count()).toBe(1);
  });

  it('undoes an approval from the toast', async () => {
    const { user } = renderTarget();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    await waitFor(async () => expect(await db.goalVersions.count()).toBe(1));
  });

  it('changes the pace instead', async () => {
    const { user } = renderTarget();
    await user.click(await screen.findByRole('button', { name: /Change pace instead/ }));
    await waitFor(() => expect(toastMessage()).toBe('0.25 kg a week, target 1,825 from tomorrow'));
    expect(await screen.findByRole('heading', { name: 'New target 1,825 starts tomorrow (Sat)' })).toBeInTheDocument();
    expect(screen.getByText('Today and earlier days keep 1,800. Pace becomes 0.25 kg a week.')).toBeInTheDocument();
  });

  it('keeps the current target, and Approve still works after', async () => {
    const { user } = renderTarget();
    await user.click(await screen.findByRole('button', { name: 'Keep current' }));
    await waitFor(() => expect(toastMessage()).toBe('Target stays at 1,800'));
    expect(
      await screen.findByText('You kept 1,800 on Fri 30 Oct. The suggestion comes back on Fri 27 Nov, or sooner if your maintenance moves by more than 100 kcal.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep current' })).toBeNull();
    expect((await getInsightFeedback(db, TARGET_FEEDBACK_ID))?.feedback).toBe('keepCurrent');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toastMessage()).toBe('Target 1,550 from tomorrow'));
    await waitFor(async () => expect(await getInsightFeedback(db, TARGET_FEEDBACK_ID)).toBeUndefined());
  });

  it('does not change the target by being opened', async () => {
    renderTarget();
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(await db.goalVersions.count()).toBe(1);
    // Opening it counts as seeing it: only the synced seen row (so it is never pushed), never a decision.
    await waitFor(async () => expect((await db.insightFeedback.toArray()).map((r) => r.ruleId)).toEqual(['targetNoticeSeen']));
    expect((await db.insightFeedback.get('targetNoticeSeen'))?.targetNoticeSeen?.key).toBe(W.expected.noticeKey);
  });

  it('goes back to Insights when opened directly', async () => {
    const { router, user } = renderTarget();
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe(PATHS.insights);
  });

  it('keeps the Undo toast when Approve is tapped again before the screen catches up', async () => {
    renderTarget();
    const first = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(first);
    // The approval is saved (its toast shows) but the live view hasn't re-read yet: the old card is still up.
    for (let i = 0; i < 200 && toastMessage() !== 'Target 1,550 from tomorrow'; i++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    expect(toastMessage()).toBe('Target 1,550 from tomorrow');
    const stale = screen.getByRole('button', { name: 'Approve' });
    expect(stale).toBeDisabled();
    fireEvent.click(stale);

    expect(await screen.findByRole('heading', { name: 'New target 1,550 starts tomorrow (Sat)' })).toBeInTheDocument();
    expect(toastMessage()).toBe('Target 1,550 from tomorrow');
    expect(useUiStore.getState().toast?.undo).toBeDefined();
    expect(await db.goalVersions.count()).toBe(2);
  });

  it('ignores a second decision on a card that still shows the first, and frees it on Undo', async () => {
    const view = (await getTargetView(db, { today: W.today }))!;
    // The view stays as it was read, like a screen whose live query hasn't caught up.
    const { result } = renderHook(() => useTargetDecisions(view));
    await act(() => result.current.approve(view, 'suggested', new Date(W.now)));
    expect(toastMessage()).toBe('Target 1,550 from tomorrow');
    expect(result.current.busy).toBe(true);
    await act(() => result.current.approve(view, 'suggested', new Date(W.now)));
    await act(() => result.current.keep(view));
    expect(toastMessage()).toBe('Target 1,550 from tomorrow');
    expect(await db.goalVersions.count()).toBe(2);

    await act(async () => useUiStore.getState().toast?.undo?.());
    await waitFor(async () => expect(await db.goalVersions.count()).toBe(1));
    expect(result.current.busy).toBe(false);
  });

  it('refuses numbers that changed since they were shown', async () => {
    const view = (await getTargetView(db, { today: W.today }))!;
    const setup = (await db.goalVersions.get(W.ids.setupVersion))!;
    await db.goalVersions.add({ ...setup, id: 'version-newer', effectiveFrom: W.tomorrow, dailyKcal: 1700, reason: 'manualEdit', createdAt: W.now });
    const { result } = renderHook(() => useTargetDecisions());
    await act(() => result.current.approve(view, 'suggested', new Date(W.now)));
    expect(toastMessage()).toBe('This suggestion changed. Have another look.');
    expect(await db.goalVersions.count()).toBe(2);
  });
});

describe('S37 TargetScreen at other times', () => {
  it('starts at 5am after midnight', async () => {
    await loadMaintenanceWorld(db);
    pinClock('2026-10-30T17:30:00.000Z');
    renderTarget();
    expect(await screen.findByText('Starts at 5am (Sat). Today and earlier days keep their target.')).toBeInTheDocument();
  });

  it('starts with the new week on a Sunday, with no week line', async () => {
    await loadMaintenanceWorld(db);
    pinClock('2026-11-01T11:10:00.000Z');
    renderTarget();
    expect(await screen.findByText('Starts tomorrow (Mon), with the new week. Today and earlier days keep their target.')).toBeInTheDocument();
    expect(screen.queryByText(/^This week:/)).toBeNull();
  });

  it('asks for weigh-ins and links to Weight', async () => {
    await loadMaintenanceWorld(db, { weighInEvery: 7 });
    pinClock();
    const { router, user } = renderTarget();
    expect(await screen.findByRole('heading', { name: 'Your trend needs a few more weigh-ins' })).toBeInTheDocument();
    expect(screen.getByText(/^4 of 8 weigh-ins in the last 4 weeks\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log a weigh-in' }));
    expect(router.state.location.pathname).toBe(PATHS.weight);
  });
});
