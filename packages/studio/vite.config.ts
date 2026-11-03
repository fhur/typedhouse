import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// No React plugin: Vite transforms TSX with the automatic runtime from tsconfig `jsx`; no fast refresh needed.
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('./dist/web', import.meta.url)), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  logLevel: 'warn',
});
