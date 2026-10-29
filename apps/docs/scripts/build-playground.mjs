import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
await build({
  entryPoints: [new URL('../src/playground/worker.ts', import.meta.url).pathname],
  outfile: new URL('../public/sandbox/worker.js', import.meta.url).pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  alias: {
    '@chql/core': `${root}packages/core/src/index.ts`,
    '@chql/compiler': `${root}packages/compiler/src/index.ts`,
  },
});
