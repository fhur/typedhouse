import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// `pnpm --filter @typedhouse/studio test:browser`. Needs Docker and Chromium (`playwright install chromium`).
// Not in root `pnpm test` (vitest collects only *.test.ts), and not in check:all: run at the S14 gate, like test:integration.
export default defineConfig({
  testDir: './test/browser',
  outputDir: join(tmpdir(), 'studio-playwright-results'),
  globalSetup: './test/browser/global-setup.ts',
  // Each test owns one server process and one ClickHouse container is shared: one at a time keeps the timing honest.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  projects: [
    // The bin serves the built UI, and the dev server is what a developer runs: the CSP and the chart guards must hold on both.
    { name: 'built', metadata: { ui: 'built' } },
    { name: 'dev', metadata: { ui: 'dev' }, testMatch: /chart-offline\.spec\.ts/ },
  ],
  use: { viewport: { width: 1440, height: 900 } },
});
