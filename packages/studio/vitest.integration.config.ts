import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Docker integration tests (ClickHouse 24.8 via testcontainers); not part of the root `pnpm test`.
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['core', 'compiler', 'client', 'codegen'].map(name => [
      `@typedhouse/${name}`,
      fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  test: { include: ['test/*.integration.ts'], testTimeout: 120_000, hookTimeout: 180_000 },
});
