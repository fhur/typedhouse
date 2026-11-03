// Dev and test entry for the type worker: load the TypeScript sources through tsx (paths and .js → .ts).
// The built CLI runs dist/types-worker.js instead.
import { tsImport } from 'tsx/esm/api';
await tsImport('./types-worker.ts', import.meta.url);
