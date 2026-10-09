/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      // pre-OAuth baseline; do not regress. Coverage on new OAuth code is
      // enforced separately below.
      branches: 50,
      functions: 55,
      lines: 55,
      statements: 55,
    },
    './src/oauth/**/*.ts': {
      // Phase 7 target: track the OAuth surface. We do not block on this
      // yet — add the missing tests as a follow-up and bump the threshold
      // once the surface stabilises. Until then this is a signal, not a
      // gate.
      branches: 60,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
