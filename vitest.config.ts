import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['core', 'compiler', 'client', 'codegen'].map(name => [
      `@chql/${name}`,
      fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  test: {
    include: ['packages/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
