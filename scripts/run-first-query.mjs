import { build } from 'tsup';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// Run against actual built ESM exports, including bounded history avg/avgIf
// (FINAL + tenant + DateTime64 window) and latest metrics via argMax/If
// and explicit CAST union alignment through run/stream. Requires the generated
// fixture's component and metric_group_ots_component_indices tables; no core runtime deps.
const directory = mkdtempSync(join(tmpdir(), 'chql-first-query-'));
try {
  mkdirSync(join(directory, 'node_modules/@chql'), { recursive: true });
  for (const name of ['core', 'compiler', 'client']) symlinkSync(resolve(`packages/${name}`), join(directory, `node_modules/@chql/${name}`), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  await build({ entry: ['examples/first-query.ts'], format: ['esm'], outDir: directory, external: ['@chql/core', '@chql/compiler', '@chql/client'], silent: true });
  const result = spawnSync(process.execPath, [join(directory, 'first-query.js')], { stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
