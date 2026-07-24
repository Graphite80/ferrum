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
      '**/tests/**',
      'packages/exercise-library/src/generated/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}'],
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
        { type: 'progression-engine', pattern: 'packages/progression-engine/src/**/*' },
        { type: 'importers', pattern: 'packages/importers/src/**/*' },
        { type: 'app', pattern: 'apps/pwa/src/**/*' },
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
            { from: 'progression-engine', allow: ['domain', 'progression-engine'] },
            { from: 'importers', allow: ['domain', 'exercise-library', 'importers'] },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts', 'packages/progression-engine/src/**/*.ts'],
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
