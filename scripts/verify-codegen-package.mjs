import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderSchema } from '../packages/codegen/dist/index.js';
import { parseCHType } from '../packages/core/dist/index.js';
const directory = mkdtempSync(join(tmpdir(), 'typedhouse-generated-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 90000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
try {
  mkdirSync(join(directory, 'node_modules/@typedhouse'), { recursive: true });
  for (const name of ['core', 'codegen']) symlinkSync(resolve(`packages/${name}`), join(directory, `node_modules/@typedhouse/${name}`), 'dir');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const name of ['schema.ts', 'functions.ts']) copyFileSync(resolve('packages/codegen/test/snapshots', name), join(directory, name));
  const types = ['Nothing', 'Bool', 'UUID', 'IPv4', 'IPv6', 'JSON', 'Date', 'Date32', "DateTime('UTC')", 'DateTime64(9)', 'Decimal256(10)', "Enum16('__proto__' = 1, '42' = 2)", 'LowCardinality(String)', 'Map(UInt64, String)', 'Tuple(`__proto__` String, `a-b` UInt64)', 'Variant(String, UInt64)', 'Dynamic', 'Future(7)', 'AggregateFunction(sum, UInt64)', 'SimpleAggregateFunction(sum, UInt64)', 'Tuple()', 'FixedString(2)', 'Tuple(`42` String, `0` UInt64, z UInt8)', 'Array(Tuple(`42` String, `0` UInt64, z UInt8))'];
  writeFileSync(join(directory, 'hostile.ts'), renderSchema({ tables: [{ name: '__proto__', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns: types.map((type, i) => ({ name: i === 0 ? '__proto__' : `c${i}`, type: parseCHType(type), position: i + 1, defaultKind: '', comment: '*/\n" Unicode é' })) }], functions: [] }));
  writeFileSync(join(directory, 'consumer.ts'), `
import { db, type ComponentRow, type PartRow, type ComponentIndicesRow } from './schema.js';
import { db as hostile } from './hostile.js';
import { functions, fn, agg } from './functions.js';
import { col, from, type Infer, type Decimal, type AggregateState, type ExprValue } from '@typedhouse/core';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const component: Equal<ComponentRow, { tenantId: string; entityId: string; category: string | null; state: string; part_specifications: { id: string; mpn: string | null; manufacturer: string | null; description: string | null; package: string | null; part_type: string | null }[]; matched_part_ids: string[]; countOfParts: bigint; updatedAt: Date }> = true;
const part: Equal<PartRow, { tenantId: string; entityId: string; manufacturerId: string; manufacturerName: string; mpn: string; partCategoryId: bigint | null; partCategoryName: string | null; partCategoryPath: bigint[]; lifecycleStatus: string | null; lifecycleYteol: number | null; countryOfOrigin: string[]; ipns: string[]; supplier_ids: string[]; updatedAt: Date }> = true;
const indices: Equal<ComponentIndicesRow, { tenantId: string; entityId: string; version: number; effectiveAt: Date; insertedAt: Date; price_change_log_sum: number; price_change_count: number; stock_index: number; stock_index_warnings: string[]; lead_time_index_part_days: number; lead_time_index_part_count: number; lead_time_max_days: number | null }> = true;
type Coverage = Infer<typeof db.coverage>;
const precision: Equal<Coverage['precise'], string> = true;
const decimal: Equal<Coverage['amount'], Decimal<18, 4>> = true;
const dotted: Equal<Coverage['nested.amount'], bigint[]> = true;
type Hostile = Infer<typeof hostile['__proto__']>;
const enumNames: Equal<Hostile['c11'], '__proto__' | '42'> = true;
const aggregate: Equal<Hostile['c18'], AggregateState<'sum'>> = true;
const orderedTuple: Equal<Hostile['c22'], { '42': string; '0': bigint; z: number }> = true;
const nestedOrderedTuple: Equal<Hostile['c23'], { '42': string; '0': bigint; z: number }[]> = true;
const known = from(db.entity_ots_component).map(c => ({ h: fn.cityHash64(c.entityId).as(col.UInt64) }));
const knownAggregate = from(db.entity_ots_component).aggregate(g => ({ n: agg.uniqExact(g.entityId).as(col.UInt64) }));
const knownRow: Equal<Infer<typeof known>, { h: bigint }> = true;
const knownAggregateRow: Equal<Infer<typeof knownAggregate>, { n: bigint }> = true;
const unknown = fn.version();
const unknownValue: Equal<ExprValue<typeof unknown>, unknown> = true;
const zeroName: Equal<typeof unknown.name, 'version'> = true;
void [knownRow, knownAggregateRow, unknownValue, zeroName];
const sum: true = functions.sum.isAggregate;
void [component, part, indices, precision, decimal, dotted, enumNames, aggregate, orderedTuple, nestedOrderedTuple, sum];
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, outDir: 'output', types: [] }, include: ['*.ts'] }));
  const version = process.env.TYPEDHOUSE_TYPESCRIPT_VERSION;
  run('pnpm', [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc']), '--project', join(directory, 'tsconfig.json')], process.cwd());
  writeFileSync(join(directory, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { db } from './output/schema.js';
import { db as hostile } from './output/hostile.js';
import { functions, fn, agg } from './output/functions.js';
import { col, val } from '@typedhouse/core';
import { renderSchema } from '@typedhouse/codegen';
assert.equal(typeof renderSchema, 'function');
assert.equal(db.coverage.columns.__proto__.name, 'String');
assert.equal(hostile.__proto__.columns.__proto__.name, 'Nothing');
assert.equal(Object.hasOwn(hostile, '__proto__'), true);
assert.equal(Object.hasOwn(db.entity_ots_component, 'source'), false);
assert.equal(Object.isFrozen(db.entity_ots_component.columns), true);
assert.equal(functions.sum.isAggregate, true);
assert.equal(typeof fn.cityHash64, 'function');
assert.equal(typeof agg.uniqExact, 'function');
assert.equal(Object.hasOwn(fn, 'uniqExact'), false);
assert.equal(Object.hasOwn(agg, 'cityHash64'), false);
const known = fn.cityHash64(val('x')).as(col.UInt64);
assert.equal(known.ir.fn.origin, 'known');
assert.deepEqual(known.ir.fn.known.declaration, { origin: 'as', type: col.UInt64.type });
assert.ok(Object.isFrozen(known.ir.fn.known.catalog));
assert.deepEqual(hostile.__proto__.columns.c22, { kind: 'Tuple', items: [
  { name: '42', type: { kind: 'scalar', name: 'String' } },
  { name: '0', type: { kind: 'scalar', name: 'UInt64' } },
  { name: 'z', type: { kind: 'scalar', name: 'UInt8' } },
] });
`);
  run(process.execPath, ['smoke.mjs'], directory);
  const metadata = JSON.parse(readFileSync('packages/codegen/package.json', 'utf8'));
  if (metadata.bin.typedhouse !== './dist/cli.js' || !readFileSync('packages/codegen/dist/cli.js', 'utf8').startsWith('#!/usr/bin/env node')) throw new Error('Missing built CLI bin/shebang');
  console.log('Built codegen exports, CLI metadata, generated snapshots and hostile-type consumer verified.');
} finally { rmSync(directory, { recursive: true, force: true }); }
