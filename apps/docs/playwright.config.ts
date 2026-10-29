import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:4322' },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4322',
    url: 'http://127.0.0.1:4322/playground/',
    reuseExistingServer: !process.env.CI,
  },
});
