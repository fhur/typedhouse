import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// A clean consumer has no workspace paths or Vitest aliases and resolves exports.
const directory = mkdtempSync(join(tmpdir(), 'chql-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
try {
  mkdirSync(join(directory, 'node_modules/@chql'), { recursive: true });
  symlinkSync(resolve('packages/core'), join(directory, 'node_modules/@chql/core'), 'dir');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { col, table, parseCHType, print, toTypeScript } from '@chql/core';
const t = table('test', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
assert.equal(print(t.columns.id), 'UInt64');
assert.equal(toTypeScript(parseCHType('Array(UInt64)')), 'Array<bigint>');
assert.equal(Object.isFrozen(t), true);
`);
  writeFileSync(join(directory, 'consumer.ts'), `
import { col, table, type Infer, type Decimal } from '@chql/core';
const t = table('test', { id: col.UInt64, d: col.Decimal(18, 4), tuple: col.Tuple([col.String, col.UInt8]) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const exact: Equal<Infer<typeof t>, { id: bigint; d: Decimal<18, 4>; tuple: readonly [string, number] }> = true;
void exact;
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [] }, include: ['consumer.ts'] }));
  run(process.execPath, ['smoke.mjs'], directory);
  const version = process.env.CHQL_TYPESCRIPT_VERSION;
  run('pnpm', [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc']), '--project', join(directory, 'tsconfig.json')], process.cwd());
  console.log('Built @chql/core ESM exports and standalone consumer declarations verified.');
} finally { rmSync(directory, { recursive: true, force: true }); }
