import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // Instrument the full unit workload while bounding concurrent Docker suites.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'packages/compiler/src/**/*.ts'],
      reporter: ['text-summary', 'json', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
