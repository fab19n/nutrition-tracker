import { createBrowserRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { startDrive } from '@/drive';
import { startSync } from '@/sync';
import { registerServiceWorker } from './pwa';
import { routes } from './routes';
import { applyStoredTheme } from './theme';

// Start-up, before the first render: the last theme (no light flash for a dark-mode user), the
// service worker, the install-prompt listener (importing ./pwa starts it), sync (inert without
// Supabase; it waits for the first screen before loading anything) and Drive photo sync (inert
// without a Google client id; Google's script loads only on a device connected to Drive).
applyStoredTheme();
registerServiceWorker();
startSync();
startDrive();

// A newer version of the app in another tab wants to upgrade the database: this tab runs the old
// code, so it closes the database and reloads into the new version rather than block the upgrade.
db.on('versionchange', () => {
  db.close();
  window.location.reload();
  return false;
});

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
