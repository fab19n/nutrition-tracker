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
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
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
      // Tests run without Supabase whatever .env.local says, as in CI: no sign-in, no sync capture.
      // A test that needs it stubs both with vi.stubEnv.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '' },
    },
  };
});
