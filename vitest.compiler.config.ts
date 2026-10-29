import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';
// Each integration file starts a ClickHouse server. Bound concurrent servers on local Docker.
// The unchanged full suite passed with this cap; it does not establish prior timeout causation.
export default defineConfig({ ...base, test: { ...base.test, maxWorkers: 2, minWorkers: 1, include: ['packages/compiler/test/*.integration.ts', 'packages/client/test/*.integration.ts'], testTimeout: 120000 } });
