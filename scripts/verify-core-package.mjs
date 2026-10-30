import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// A clean consumer has no workspace paths or Vitest aliases and resolves exports.
const directory = mkdtempSync(join(tmpdir(), 'typedhouse-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
try {
  mkdirSync(join(directory, 'node_modules/@typedhouse'), { recursive: true });
  symlinkSync(resolve('packages/core'), join(directory, 'node_modules/@typedhouse/core'), 'dir');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { col, table, parseCHType, print, toTypeScript, canonicalKey, exprNode, relNode, flatOutput } from '@typedhouse/core';
const t = table('test', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
assert.equal(print(t.columns.id), 'UInt64');
assert.equal(toTypeScript(parseCHType('Array(UInt64)')), 'Array<bigint>');
assert.equal(Object.isFrozen(t), true);
const output = flatOutput([['id', col.UInt64.type]]);
const scan = relNode({ kind: 'Scan', table: t, columns: t.columns, output });
const union = relNode({ kind: 'Union', inputs: [scan, scan], all: true, output });
assert.equal(union.inputs[0], scan);
assert.equal(union.inputs[1], scan);
assert.equal(exprNode({ kind: 'Param', type: null, value: 1n }).kind, 'Param');
const dateParam = exprNode({ kind: 'Param', type: col.DateTime64(3).type, value: new Date(0) });
dateParam.value.setTime(1000);
assert.equal(dateParam.value.getTime(), 0);
const mapColumns = [['m', col.Map(col.Decimal(18, 4), col.UInt64).type]];
assert.equal(canonicalKey({ m: [['01.2000', 2n], ['2', 3n]] }, mapColumns), canonicalKey({ m: [['2.0000', 3n], ['1.2', 2n]] }, mapColumns));
assert.notEqual(canonicalKey({ m: [['1.2', 2n]] }, mapColumns), canonicalKey({ m: [['1.2', 2n], ['1.2', 2n]] }, mapColumns));
assert.notEqual(canonicalKey({ id: 1n }, [['id', col.UInt64.type]]), canonicalKey({ id: 2n }, [['id', col.UInt64.type]]));
`);
  writeFileSync(join(directory, 'consumer.ts'), `
import { col, table, exprNode, type NodeId, type Infer, type Decimal } from '@typedhouse/core';
const param = exprNode({ kind: 'Param', type: null, value: 1n });
const nodeId: NodeId = param.id;
const paramKind: 'Param' = param.kind;
void nodeId; void paramKind;
const t = table('test', { id: col.UInt64, d: col.Decimal(18, 4), tuple: col.Tuple([col.String, col.UInt8]) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const kindExact: Equal<typeof param.kind, 'Param'> = true;
const idExact: Equal<typeof param.id, NodeId> = true;
const typeExact: Equal<typeof param.type, import('@typedhouse/core').CHType | null> = true;
void kindExact; void idExact; void typeExact;
const exact: Equal<Infer<typeof t>, { id: bigint; d: Decimal<18, 4>; tuple: readonly [string, number] }> = true;
void exact;
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [] }, include: ['consumer.ts'] }));
  run(process.execPath, ['smoke.mjs'], directory);
  const version = process.env.TYPEDHOUSE_TYPESCRIPT_VERSION;
  run('pnpm', [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc']), '--project', join(directory, 'tsconfig.json')], process.cwd());
  console.log('Built @typedhouse/core ESM exports and standalone consumer declarations verified.');
} finally { rmSync(directory, { recursive: true, force: true }); }
