import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // tsconfig.json#paths is the single source of the @ferrum/* aliases.
  plugins: [tsconfigPaths()],
  test: {
    include: [
      'packages/*/tests/**/*.test.ts',
      'services/*/tests/**/*.test.ts',
      'apps/pwa/tests/unit/**/*.test.ts',
    ],
    pool: 'forks',
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'services/api/src/**/*.ts', 'apps/pwa/src/**/*.ts'],
      exclude: [
        'packages/exercise-library/src/generated/**',
        // Test support shipped via the @ferrum/domain/testing subpath, not product code.
        'packages/domain/src/testing.ts',
        'packages/domain/src/testing/**',
      ],
      // Per-glob gates instead of one global: vitest counts glob-matched files in
      // the global gate too, which would let the untestable areas drag it down.
      thresholds: {
        'packages/*/src/**/*.ts': { branches: 80, functions: 85, lines: 85, statements: 85 },
        // The PWA's .ts modules are exercised by Playwright, not vitest; only the
        // sync client's gating logic has unit coverage, so the app gate is lower.
        'apps/pwa/src/**/*.ts': { branches: 0, functions: 0, lines: 0, statements: 0 },
        // The API's entrypoints (main, dev-server, pg-database) only run in real
        // deployments; its integration suite covers the rest, gated at measured level.
        'services/api/src/**/*.ts': { branches: 45, functions: 65, lines: 65, statements: 65 },
      },
    },
  },
});
