import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.config.{js,ts}',
      'packages/exercise-library/src/generated/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}', 'services/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      boundaries,
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain/src/**/*' },
        { type: 'exercise-library', pattern: 'packages/exercise-library/src/**/*' },
        { type: 'exercise-media', pattern: 'packages/exercise-media/src/**/*' },
        { type: 'progression-engine', pattern: 'packages/progression-engine/src/**/*' },
        { type: 'importers', mode: 'full', pattern: 'packages/importers/src/**/*' },
        { type: 'sync-protocol', pattern: 'packages/sync-protocol/src/**/*' },
        { type: 'api', mode: 'full', pattern: 'services/api/src/**/*' },
        {
          type: 'app-ui',
          mode: 'full',
          pattern: [
            'apps/pwa/src/features/**/*',
            'apps/pwa/src/components/**/*',
            'apps/pwa/src/App.tsx',
            'apps/pwa/src/main.tsx',
            'apps/pwa/src/ui.ts',
          ],
        },
        {
          type: 'app-data',
          mode: 'full',
          pattern: ['apps/pwa/src/data/**/*', 'apps/pwa/src/db/**/*', 'apps/pwa/src/sync/**/*'],
        },
        { type: 'app-platform', mode: 'full', pattern: 'apps/pwa/src/platform/**/*' },
      ],
    },
    rules: {
      ...tsPlugin.configs['strict-type-checked'].rules,
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'import/no-cycle': ['error', { maxDepth: 10, ignoreExternal: true }],
      'import/no-unresolved': ['error', { caseSensitive: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../*'],
              message: 'Use the @ferrum/* or @/ aliases instead of deep relative imports.',
            },
          ],
        },
      ],
      // The domain layer must stay runnable in Node, a worker and a browser alike:
      // no DOM, no storage, no clock, no network. Determinism is the whole product promise.
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            { from: 'domain', allow: ['domain'] },
            { from: 'exercise-library', allow: ['domain', 'exercise-library'] },
            { from: 'exercise-media', allow: ['domain', 'exercise-media'] },
            { from: 'progression-engine', allow: ['domain', 'progression-engine'] },
            { from: 'importers', allow: ['domain', 'exercise-library', 'importers'] },
            { from: 'sync-protocol', allow: ['domain', 'sync-protocol'] },
            {
              from: 'api',
              allow: [
                'domain',
                'sync-protocol',
                'exercise-library',
                'importers',
                'progression-engine',
                'api',
              ],
            },
            {
              from: 'app-ui',
              allow: [
                'domain',
                'exercise-library',
                'exercise-media',
                'app-ui',
                'app-data',
                'app-platform',
              ],
            },
            {
              from: 'app-data',
              allow: ['domain', 'sync-protocol', 'app-data', 'app-platform'],
            },
            { from: 'app-platform', allow: ['app-platform'] },
            { from: 'app-ui', disallow: ['api', 'importers'] },
            { from: 'app-data', disallow: ['api', 'importers', 'app-ui'] },
            { from: 'app-platform', disallow: ['api', 'importers', 'app-ui', 'app-data'] },
          ],
        },
      ],
    },
  },
  {
    // Tests stay on the strict typed config, minus the rules that only produce
    // noise there: non-null assertions on values the test just created, and the
    // unsafe-assignment churn of asserting on parsed JSON.
    files: ['**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Wire tests build malformed inputs by deleting computed keys from valid ones.
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },
  {
    files: [
      'packages/domain/src/**/*.ts',
      'packages/exercise-media/src/**/*.ts',
      'packages/progression-engine/src/**/*.ts',
      'packages/sync-protocol/src/**/*.ts',
    ],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Domain code must not touch the DOM.' },
        { name: 'document', message: 'Domain code must not touch the DOM.' },
        { name: 'localStorage', message: 'Domain code must not touch storage.' },
        { name: 'indexedDB', message: 'Domain code must not touch storage.' },
        { name: 'fetch', message: 'Domain code must not do I/O.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Domain code must take time as an explicit input, never read the ambient clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Domain code must take time as an explicit input, never read the ambient clock.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Domain code must be deterministic; inject randomness explicitly.',
        },
      ],
    },
  },
];
