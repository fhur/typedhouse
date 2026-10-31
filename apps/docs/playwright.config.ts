import { defineConfig } from '@playwright/test';

const port = process.env.TYPEDHOUSE_DOCS_TEST_PORT || '4322';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/playground/`,
    // A preview server or another worktree cannot serve this worktree's source-module probes.
    reuseExistingServer: false,
  },
});
