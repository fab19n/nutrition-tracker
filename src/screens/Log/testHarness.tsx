/**
 * Test-only harness for the logging screens: a memory router with the logging routes, a
 * minimal sheet host for ?sheet=log and a toast host, so flows run screen to screen.
 * Not imported by the app.
 */
import { render } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter, useLocation, type InitialEntry } from 'react-router';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { Toast } from '@/components/Toast/Toast';
import LogSheet from '@/screens/sheets/LogSheet';
import { useUiStore } from '@/state/ui';
import EstimatingScreen from './EstimatingScreen';
import PlateScreen from './PlateScreen';
import ReviewScreen from './ReviewScreen';

function Shell() {
  const { sheet, close } = useSheet();
  const toast = useUiStore((s) => s.toast);
  const hideToast = useUiStore((s) => s.hideToast);
  return (
    <>
      <Outlet />
      <BottomSheet open={sheet === 'log'} onClose={close} title="Log a meal">
        <LogSheet close={close} />
      </BottomSheet>
      {toast ? (
        <Toast key={toast.id} message={toast.message} onUndo={toast.undo} onDismiss={() => hideToast(toast.id)} durationMs={null} />
      ) : null}
    </>
  );
}

/** Stands in for screens other agents own; shows where we landed. */
function Stub({ name }: { name: string }) {
  const location = useLocation();
  return (
    <h1>
      {name} screen {location.pathname}
      {location.search}
    </h1>
  );
}

export function renderLogRoutes(initial: InitialEntry) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: PATHS.today, element: <Stub name="Today" /> },
          { path: PATHS.diary, element: <Stub name="Diary" /> },
          { path: '/diary/entry/:id', element: <Stub name="Entry" /> },
          { path: PATHS.estimating, element: <EstimatingScreen /> },
          { path: PATHS.review, element: <ReviewScreen /> },
          { path: PATHS.plate, element: <PlateScreen /> },
          { path: PATHS.usuals, element: <Stub name="Usuals" /> },
          { path: PATHS.pots, element: <Stub name="Pots" /> },
          { path: PATHS.potNew, element: <Stub name="New pot" /> },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}
