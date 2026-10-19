import { createBrowserRouter, RouterProvider } from 'react-router';
import { registerServiceWorker } from './pwa';
import { routes } from './routes';
import { applyStoredTheme } from './theme';

// Start-up, before the first render: the last theme (no light flash for a dark-mode user), the
// service worker, and the install-prompt listener (importing ./pwa starts it).
applyStoredTheme();
registerServiceWorker();

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
