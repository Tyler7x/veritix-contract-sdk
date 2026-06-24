import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
    },
  },
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', 'src/utils/network.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/utils/network.test.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};

export default config;
