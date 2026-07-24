import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@ferrum/domain': path.resolve(root, 'packages/domain/src/index.ts'),
      '@ferrum/exercise-library': path.resolve(root, 'packages/exercise-library/src/index.ts'),
      '@ferrum/importers': path.resolve(root, 'packages/importers/src/index.ts'),
      '@ferrum/progression-engine': path.resolve(root, 'packages/progression-engine/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/exercise-library/src/generated/**'],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
  },
});
