import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { deleteDayRecord, updateProfile } from '@/db/repo';
import { resetUiState, useUiStore } from '@/state/ui';
import { setOnline } from '@/test/network';
import { routes } from './routes';

/*
 * The screens and sheet contents belong to other parts of the build; stubs keep this test about
 * the shell (bootstrap, redirects, nav, sheets, toasts, offline). The data layer is real.
 */
const stubs = vi.hoisted(() => ({
  screen: (label: string) => async () => {
    const { createElement } = await import('react');
    return { default: () => createElement('h1', null, label) };
  },
  sheet: (label: string) => async () => {
    const { createElement } = await import('react');
    return {
      default: ({ close }: { close: () => void }) =>
        createElement('div', null, createElement('p', null, label), createElement('button', { type: 'button', onClick: close }, 'Done')),
    };
  },
}));

vi.mock('@/screens/Today/TodayScreen', stubs.screen('Today screen'));
vi.mock('@/screens/Diary/DiaryDayScreen', stubs.screen('Diary screen'));
// Review with a local sheet (like its Add an item sheet), to test the phone's back button.
vi.mock('@/screens/Log/ReviewScreen', async () => {
  const { createElement, Fragment, useState } = await import('react');
  const { useNavigate } = await import('react-router');
  const { BottomSheet } = await import('@/components/BottomSheet/BottomSheet');
  const { goBack } = await import('./history');
  function ReviewStub() {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    return createElement(
      Fragment,
      null,
      createElement('h1', null, 'Review screen'),
      createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Add an item'),
      createElement(BottomSheet, {
        open,
        onClose: () => setOpen(false),
        title: 'Add an item',
        children: createElement('button', { type: 'button', onClick: () => goBack(navigate) }, 'Leave'),
      }),
    );
  }
  return { default: ReviewStub };
});
vi.mock('@/screens/Setup/SetupFlow', stubs.screen('Setup screen'));
vi.mock('@/screens/sheets/LogSheet', stubs.sheet('Log sheet content'));
vi.mock('@/screens/sheets/BudgetSheet', stubs.sheet('Budget sheet content'));
vi.mock('@/screens/sheets/CheckInSheet', stubs.sheet('Check-in sheet content'));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

const nav = () => screen.queryByRole('navigation', { name: 'Main' });

beforeEach(() => {
  // jsdom has no scrolling; ScrollRestoration calls it on every navigation.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  resetUiState();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

describe('AppShell — first run', () => {
  beforeEach(async () => {
    await resetAll();
  });

  it('redirects to setup when there is no profile', async () => {
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    expect(nav()).toBeNull();
  });

  it('stays on setup sub-steps without a profile', async () => {
    const { router } = renderAt('/setup/goal');
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup/goal');
  });
});

describe('AppShell — with the demo world', () => {
  beforeEach(async () => {
    await resetAll();
    await loadDemoData();
  });

  it('shows the bottom nav on Today and switches tabs through PATHS', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Today screen' })).toBeInTheDocument();
    const bar = nav();
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(bar as HTMLElement).getByRole('button', { name: 'Diary' }));
    expect(await screen.findByRole('heading', { name: 'Diary screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('does not redirect away from /setup when a profile exists (SetupFlow decides)', async () => {
    const { router } = renderAt('/setup');
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('hides the nav on sub-screens such as /log/review', async () => {
    renderAt('/log/review');
    expect(await screen.findByRole('heading', { name: 'Review screen' })).toBeInTheDocument();
    expect(nav()).toBeNull();
  });

  it('sends unknown paths to Today', async () => {
    const { router } = renderAt('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Today screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('opens the log sheet on +, keeps the nav, and closes it on Escape', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log food' });
    expect(await within(dialog).findByText('Log sheet content')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?sheet=log');
    // 88%, capped by the visible height while the on-screen keyboard is up.
    expect(dialog.style.maxHeight).toMatch(/^min\(88%, /);
    expect(nav()).not.toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
  });

  it('closes a sheet through its content’s close()', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/?sheet=budget');
    const dialog = await screen.findByRole('dialog', { name: "This week's budget" });
    await user.click(await within(dialog).findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
  });

  it('keeps the check-in sheet open on Escape (not dismissible)', async () => {
    const user = userEvent.setup();
    renderAt('/?sheet=checkin');
    const dialog = await screen.findByRole('dialog', { name: 'Morning check-in' });
    expect(await within(dialog).findByText('Check-in sheet content')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Morning check-in' })).toBeInTheDocument();
  });

  it('shows the ui store toast with Undo', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });

    const undo = vi.fn();
    act(() => {
      useUiStore.getState().showToast('Saved · ~880 kcal', undo);
    });
    expect(await screen.findByText('Saved · ~880 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Saved · ~880 kcal')).toBeNull());
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('shows one toast at a time: a new one replaces the old', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    act(() => {
      useUiStore.getState().showToast('Saving for Saturday');
    });
    expect(await screen.findByText('Saving for Saturday')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => {
      useUiStore.getState().showToast('Yesterday confirmed');
    });
    expect(await screen.findByText('Yesterday confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Saving for Saturday')).toBeNull();
  });

  it("closes a screen's own sheet on the phone's back button, and the next back leaves the screen", async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    await act(() => router.navigate('/log/review'));
    await user.click(await screen.findByRole('button', { name: 'Add an item' }));
    expect(screen.getByRole('dialog', { name: 'Add an item' })).toBeInTheDocument();

    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/log/review');
    expect(screen.getByRole('heading', { name: 'Review screen' })).toBeInTheDocument();

    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it("lets the app's own Back through while a screen's sheet is open", async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    await act(() => router.navigate('/log/review'));
    await user.click(await screen.findByRole('button', { name: 'Add an item' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Add an item' })).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('announces toasts through a live region that stays mounted', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    // Empty live regions already on the page before any toast.
    const regions = screen.getAllByRole('status').filter((el) => el.getAttribute('aria-live') === 'polite' && el.textContent === '');
    expect(regions.length).toBeGreaterThan(0);
    act(() => {
      useUiStore.getState().showToast('Yesterday confirmed');
    });
    await screen.findByText('Yesterday confirmed');
    // The message appears inside one of them (announced), not in a region mounted with it.
    expect(regions.some((el) => el.isConnected && el.textContent?.includes('Yesterday confirmed'))).toBe(true);
  });

  it('moves the toast off the bottom edge while a sheet is open', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    act(() => {
      useUiStore.getState().showToast('Saving for Saturday');
    });
    const toast = await screen.findByText('Saving for Saturday');
    const host = () => toast.closest('[aria-live="polite"]') as HTMLElement;
    const placementBefore = host().className;
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    await screen.findByRole('dialog', { name: 'Log food' });
    expect(host().className).not.toBe(placementBefore);
    expect(host().className).toMatch(/toastTop/);
  });

  it('shows the offline banner on an offline event and hides it when back online', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    expect(screen.queryByText(/You're offline/)).toBeNull();

    setOnline(false);
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    expect(screen.getByText(/Logging still works; estimates run when you're back\./)).toBeInTheDocument();

    setOnline(true);
    await waitFor(() => expect(screen.queryByText(/You're offline/)).toBeNull());
  });

  it('applies the profile theme to <html data-theme>', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    expect(document.documentElement.dataset.theme).toBeUndefined();

    await act(async () => {
      await updateProfile(db, { theme: 'dark' });
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    await act(async () => {
      await updateProfile(db, { theme: 'system' });
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it('badges Today while a check-in is waiting', async () => {
    // Thursday 15 Oct loses its confirmation, so the morning check-in is due.
    await deleteDayRecord(db, '2026-10-15');
    renderAt('/');
    await screen.findByRole('heading', { name: 'Today screen' });
    expect(await screen.findByRole('button', { name: 'Today, Check-in waiting' })).toBeInTheDocument();
  });
});
