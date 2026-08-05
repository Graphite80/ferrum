import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    // tsconfig.json#paths at the repo root is the single source of the @ferrum/* and @/ aliases.
    tsconfigPaths({ projects: [path.resolve(here, '../../tsconfig.json')] }),
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
  // Sync targets the origin the page came from, so the dev server has to answer
  // for the API too or nothing behind sign-in can be exercised without building.
  // The target is dev-server.ts's default port; it simply 502s when not running,
  // which is the same shape as an offline server and is handled.
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/health', '/ready', '/auth', '/dev', '/sync', '/link', '/telegram'].map(prefix => [
        prefix,
        { target: 'http://127.0.0.1:3100', changeOrigin: false },
      ])
    ),
  },
  build: { target: 'es2022', sourcemap: 'hidden' },
});
