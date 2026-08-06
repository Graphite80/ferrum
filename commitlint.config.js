export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'domain',
        'exercise-library',
        'progression',
        'importers',
        'pwa',
        'android',
        'infra',
        'ci',
        'deps',
        'config',
        'docs',
      ],
    ],
    'body-max-line-length': [2, 'always', 200],
    'subject-case': [2, 'always', 'sentence-case'],
  },
};
