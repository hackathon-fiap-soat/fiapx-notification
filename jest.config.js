'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/application/ports.js'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  coverageThreshold: { global: { lines: 80, statements: 80, branches: 80, functions: 80 } },
  testTimeout: 30000,
};
