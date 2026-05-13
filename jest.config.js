/**
 * Jest test runner config.
 *
 * `tests/setup.ts` is loaded by direct `import` from the test files that need it
 * (sheets.test.ts and main.test.ts). Loading it that way — not via a
 * `setupFiles*` config key — runs it AFTER Jest's framework is up, so
 * `jest.fn()`, `beforeEach`, etc. work inside it. `setup.ts`'s top-level
 * `beforeEach(resetMocks)` covers state cleanup; no per-file duplication needed.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
