import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';
export default defineConfig({ ...base, test: { ...base.test, include: ['packages/compiler/test/*.integration.ts', 'packages/client/test/*.integration.ts'], testTimeout: 120000 } });
