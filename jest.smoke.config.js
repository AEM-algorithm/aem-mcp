/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/smoke'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 180000,
};
