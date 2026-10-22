import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { useNotificationOpens } from './notificationOpens';

const push = vi.hoisted(() => ({ refreshPush: vi.fn(async () => {}) }));

vi.mock('@/push', () => ({ refreshPush: () => push.refreshPush() }));

function Layout() {
  useNotificationOpens();
  return <Outlet />;
}

function renderApp(entries: string[] = ['/diary']) {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <h1>Today</h1> },
          { path: '/diary', element: <h1>Diary</h1> },
          { path: '/insights/weekly', element: <h1>Weekly review</h1> },
        ],
      },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** A service worker container to post messages from (jsdom has none). */
function installWorker(): EventTarget {
  const container = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return container;
}

function post(container: EventTarget, data: unknown) {
  act(() => {
    container.dispatchEvent(new MessageEvent('message', { data }));
  });
}

/** Lets a navigation the message started finish. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  push.refreshPush.mockClear();
});

describe('useNotificationOpens', () => {
  it('opens the screen a tapped reminder points to', async () => {
    const worker = installWorker();
    const router = renderApp();
    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
    post(worker, { type: 'km-open', url: '/insights/weekly' });
    expect(await screen.findByRole('heading', { name: 'Weekly review' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/weekly');
  });

  it('stays put on the screen it points to, so one Back still leaves it', async () => {
    const worker = installWorker();
    const router = renderApp(['/diary', '/insights/weekly']);
    await screen.findByRole('heading', { name: 'Weekly review' });
    const before = router.state.location.key;
    post(worker, { type: 'km-open', url: '/insights/weekly' });
    await settle();
    expect(router.state.location.key).toBe(before);
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
  });

  it('compares the query too: an open check-in sheet stays one entry, and Today still opens it', async () => {
    const worker = installWorker();
    const router = renderApp(['/diary', '/?sheet=checkin']);
    await screen.findByRole('heading', { name: 'Today' });
    const before = router.state.location.key;
    post(worker, { type: 'km-open', url: '/?sheet=checkin' });
    await settle();
    expect(router.state.location.key).toBe(before);
    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();

    post(worker, { type: 'km-open', url: '/' });
    await screen.findByRole('heading', { name: 'Today' });
    post(worker, { type: 'km-open', url: '/?sheet=checkin' });
    await waitFor(() => expect(router.state.location.search).toBe('?sheet=checkin'));
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('opens Today for a path it does not accept', async () => {
    const worker = installWorker();
    const router = renderApp();
    await screen.findByRole('heading', { name: 'Diary' });
    post(worker, { type: 'km-open', url: 'https://evil.example/' });
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('checks the subscription again when the browser rotated it, and ignores other messages', async () => {
    const worker = installWorker();
    renderApp();
    await screen.findByRole('heading', { name: 'Diary' });
    post(worker, { type: 'km-push-changed' });
    expect(push.refreshPush).toHaveBeenCalledTimes(1);
    post(worker, { type: 'something-else' });
    post(worker, 'km-open');
    expect(push.refreshPush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Diary' })).toBeInTheDocument();
  });

  it('does nothing without a service worker', async () => {
    expect('serviceWorker' in navigator).toBe(false);
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
  });
});
