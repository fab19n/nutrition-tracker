/* The service worker (vite-plugin-pwa injectManifest, decision §10.19 D3): today's precache, navigation
   fallback and auto-update, plus reminders (./sw/push). Built as one classic script at /sw.js. */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { installPushHandlers, type WorkerScope } from './sw/push';

declare const self: WorkerScope & { __WB_MANIFEST: (string | PrecacheEntry)[]; skipWaiting(): Promise<void> };

/** A trimmed, non-empty build-time value, or undefined. */
function envString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

void self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));
installPushHandlers(self, {
  supabaseUrl: envString(import.meta.env.VITE_SUPABASE_URL)?.replace(/\/+$/, ''),
  supabaseKey: envString(import.meta.env.VITE_SUPABASE_KEY),
  vapidKey: envString(import.meta.env.VITE_VAPID_PUBLIC_KEY),
});
