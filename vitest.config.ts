import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // tsconfig.json#paths is the single source of the @ferrum/* aliases.
  plugins: [tsconfigPaths()],
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'services/*/tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/exercise-library/src/generated/**',
        // Test support shipped via the @ferrum/domain/testing subpath, not product code.
        'packages/domain/src/testing.ts',
        'packages/domain/src/testing/**',
      ],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
  },
});
