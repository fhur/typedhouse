import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'chql-query-consumer-'));
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`${command}: ${result.stdout}\n${result.stderr}`);
}
try {
  mkdirSync(join(directory, 'node_modules/@chql'), { recursive: true });
  for (const name of ['core', 'compiler', 'client']) symlinkSync(resolve(`packages/${name}`), join(directory, `node_modules/@chql/${name}`), 'dir');
  for (const name of ['expect-type', '@types']) symlinkSync(resolve(`node_modules/${name}`), join(directory, `node_modules/${name}`), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(join(directory, 'consumer.ts'), readFileSync('test/types/query.ts', 'utf8'));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: ['node'] }, include: ['consumer.ts'] }));
  writeFileSync(join(directory, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { col, table, from, registerCompiler } from '@chql/core';
import { emitNaive } from '@chql/compiler';
import { createClient, decoder } from '@chql/client';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).where(r => r.id.eq(2n)).map(r => ({ id: r.id })).limit(10);
assert.throws(() => q.toSQL(), /compiler_not_registered/);
registerCompiler(emitNaive);
assert.deepEqual({...q.toSQL().params}, {p0: '2'});
assert.equal(decoder(col.UInt64.type)('2'), 2n);
const structural = from(table('s', { specs: col.Array(col.Tuple({ name: col.Nullable(col.String) })), ids: col.Array(col.UInt64) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }))
  .where(r => r.ids.hasAny([2n])).map(r => ({ names: r.specs.element('name'), first: r.specs.arrayElement(-1).element('name'), size: r.ids.length(), empty: r.ids.empty() }));
assert.deepEqual({...structural.toSQL().params}, { p0: 'name', p1: '-1', p2: 'name', p3: '[2]' });
assert.deepEqual(decoder(structural.toSQL().columns.names)(['a', null]), ['a', null]);
assert.equal(decoder(structural.toSQL().columns.empty)(0), false);
await createClient().close();
`);
  run(process.execPath, ['smoke.mjs'], directory);
  const version = process.env.CHQL_TYPESCRIPT_VERSION;
  run('pnpm', [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc']), '--project', join(directory, 'tsconfig.json')]);
  console.log('Built Query/compiler/client ESM and exact/not-any consumer types passed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
