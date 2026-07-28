import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      strategies: 'generateSW',
      // A service worker that activates under an open workout would swap the running
      // code mid-session. `prompt` keeps the old worker in control until the user is
      // out of a workout; clientsClaim makes the activated worker actually take over
      // the open page, without which controllerchange never fires and updates no-op.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: true,
        navigationPreload: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'ferrum-navigation', networkTimeoutSeconds: 5 },
          },
        ],
      },
      manifest: false,
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(here, './src'),
      '@ferrum/domain': path.resolve(repoRoot, 'packages/domain/src/index.ts'),
      '@ferrum/exercise-library': path.resolve(repoRoot, 'packages/exercise-library/src/index.ts'),
      '@ferrum/sync-protocol': path.resolve(repoRoot, 'packages/sync-protocol/src/index.ts'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: 'hidden' },
});
