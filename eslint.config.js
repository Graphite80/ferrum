import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';

// boundaries classifies a dependency by where it resolves, and a workspace
// package resolves through node_modules — so `@ferrum/*` reads as external to it
// and every cross-package rule it carries is inert. The layering between
// packages is therefore stated here, where the specifier itself is the subject.
// Verified by deliberately importing across a boundary and watching lint fail;
// a rule that cannot be made to fail is not a rule.
const DEEP_RELATIVE = {
  group: ['../../../*'],
  message: 'Use the @ferrum/* or @/ aliases instead of deep relative imports.',
};

const layerImports = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns: [DEEP_RELATIVE, ...patterns] }],
});

const onlyFerrum = (...allowed) => ({
  group: ['@ferrum/*', ...allowed.map(name => `!@ferrum/${name}`)],
  message: `This package may depend on ${allowed.length === 0 ? 'no other ferrum package' : allowed.map(name => `@ferrum/${name}`).join(', ')}.`,
});

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
        // Every element carries mode: 'full'. Without it the pattern is read as a
        // folder pattern, the files under it classify as nothing, and every rule
        // naming that type silently passes — which is how domain was free to
        // import the exercise library for as long as this file has existed.
        { type: 'domain', mode: 'full', pattern: 'packages/domain/src/**/*' },
        { type: 'exercise-library', mode: 'full', pattern: 'packages/exercise-library/src/**/*' },
        { type: 'exercise-media', mode: 'full', pattern: 'packages/exercise-media/src/**/*' },
        {
          type: 'progression-engine',
          mode: 'full',
          pattern: 'packages/progression-engine/src/**/*',
        },
        { type: 'importers', mode: 'full', pattern: 'packages/importers/src/**/*' },
        { type: 'sync-protocol', mode: 'full', pattern: 'packages/sync-protocol/src/**/*' },
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
      'no-restricted-imports': ['error', { patterns: [DEEP_RELATIVE] }],
      // The domain layer must stay runnable in Node, a worker and a browser alike:
      // no DOM, no storage, no clock, no network. Determinism is the whole product promise.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: [{ type: 'domain' }], allow: [{ to: [{ type: 'domain' }] }] },
            {
              from: [{ type: 'exercise-library' }],
              allow: [{ to: [{ type: 'domain' }, { type: 'exercise-library' }] }],
            },
            {
              from: [{ type: 'exercise-media' }],
              allow: [{ to: [{ type: 'domain' }, { type: 'exercise-media' }] }],
            },
            {
              from: [{ type: 'progression-engine' }],
              allow: [{ to: [{ type: 'domain' }, { type: 'progression-engine' }] }],
            },
            {
              from: [{ type: 'importers' }],
              allow: [
                { to: [{ type: 'domain' }, { type: 'exercise-library' }, { type: 'importers' }] },
              ],
            },
            {
              from: [{ type: 'sync-protocol' }],
              allow: [{ to: [{ type: 'domain' }, { type: 'sync-protocol' }] }],
            },
            {
              from: [{ type: 'api' }],
              allow: [
                {
                  to: [
                    { type: 'domain' },
                    { type: 'sync-protocol' },
                    { type: 'exercise-library' },
                    { type: 'importers' },
                    { type: 'progression-engine' },
                    { type: 'api' },
                  ],
                },
              ],
            },
            {
              from: [{ type: 'app-ui' }],
              allow: [
                {
                  to: [
                    { type: 'domain' },
                    { type: 'exercise-library' },
                    { type: 'exercise-media' },
                    { type: 'app-ui' },
                    { type: 'app-data' },
                    { type: 'app-platform' },
                  ],
                },
              ],
            },
            {
              from: [{ type: 'app-data' }],
              allow: [
                {
                  to: [
                    { type: 'domain' },
                    { type: 'sync-protocol' },
                    { type: 'app-data' },
                    { type: 'app-platform' },
                  ],
                },
              ],
            },
            { from: [{ type: 'app-platform' }], allow: [{ to: [{ type: 'app-platform' }] }] },
            {
              from: [{ type: 'app-ui' }],
              disallow: [{ to: [{ type: 'api' }, { type: 'importers' }] }],
            },
            {
              from: [{ type: 'app-data' }],
              disallow: [{ to: [{ type: 'api' }, { type: 'importers' }, { type: 'app-ui' }] }],
            },
            {
              from: [{ type: 'app-platform' }],
              disallow: [
                {
                  to: [
                    { type: 'api' },
                    { type: 'importers' },
                    { type: 'app-ui' },
                    { type: 'app-data' },
                  ],
                },
              ],
            },
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
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: layerImports(onlyFerrum()),
  },
  {
    files: [
      'packages/exercise-library/src/**/*.ts',
      'packages/exercise-media/src/**/*.ts',
      'packages/progression-engine/src/**/*.ts',
      'packages/sync-protocol/src/**/*.ts',
    ],
    rules: layerImports(onlyFerrum('domain')),
  },
  {
    files: ['packages/importers/src/**/*.ts'],
    rules: layerImports(onlyFerrum('domain', 'exercise-library')),
  },
  {
    // The PWA ships to a browser: the API and the importers are server code, and
    // pulling either in would put Node built-ins and the whole import pipeline
    // into the bundle.
    files: ['apps/pwa/src/**/*.{ts,tsx}'],
    rules: layerImports({
      group: ['@ferrum/api', '@ferrum/importers'],
      message: 'The PWA must not import server code.',
    }),
  },
];
