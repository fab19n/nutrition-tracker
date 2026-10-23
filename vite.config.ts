/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { devEstimatePlugin } from './server/devEstimatePlugin.ts';

export default defineConfig(({ mode }) => {
  // '' prefix loads non-VITE_ variables too, for the dev server only; they never reach the bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      devEstimatePlugin(env.ANTHROPIC_API_KEY || undefined),
      VitePWA({
        // Our own worker (src/sw.ts): the precache, navigation fallback and auto-update the generated
        // one had, plus reminders (decision §10.19). Still one classic script at /sw.js.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg'],
        manifest: {
          name: 'Kira Makan',
          short_name: 'Kira Makan',
          description: 'A calorie budget that speaks Malaysian food.',
          theme_color: '#FAF4EA',
          background_color: '#FAF4EA',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          rollupFormat: 'iife',
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
      // Tests run without Supabase, Google Drive or reminders whatever .env.local says, as in CI: no
      // sign-in, no sync capture, no Drive card, no push. A test that needs one stubs it with vi.stubEnv.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '', VITE_GOOGLE_CLIENT_ID: '', VITE_VAPID_PUBLIC_KEY: '' },
      // Budgets that add up under a full parallel run (one worker per core, each with its own jsdom
      // and IndexedDB): a screen test may wait up to 4 s at a time (its SLOW findBy), so a whole test
      // gets 15 s, not the default 5 s. Waits without their own timeout get 3 s (src/test/setup.ts).
      testTimeout: 15_000,
      expect: { poll: { timeout: 3_000 } },
    },
  };
});
