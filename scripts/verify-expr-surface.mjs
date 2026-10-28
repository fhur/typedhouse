import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../packages/core/dist/index.js';
const { Expr, col, exprNode, count, countIf, sum, max, sumIf, sumState, countState, maxState, countMerge, sumMerge, maxMerge, val, cast, toTypeScript } = core;
function column(descriptor, name, mode) { return new Expr(exprNode({ kind: 'ColumnRef', rel: 1, path: [name], type: descriptor.type }), name, mode); }
const id = column(col.UInt64, 'id', 'row');
const nullable = column(col.Nullable(col.UInt64), 'nullable', 'row');
const predicate = column(col.Nullable(col.Bool), 'predicate', 'grouped');
const grouped = column(col.UInt64, 'stock', 'grouped');
const state = column(col.AggregateFunction('count'), 'state', 'grouped');
const distanceAdversarial = core.defineFunction({ name: 'editDistance', args: [core.stringLike, core.stringLike], returns: col.UInt64, deterministic: true });
const identityAdversarial = core.defineFunction({ name: 'identity', args: [core.stringLike], returns: 'arg0', deterministic: true });
const nullableAggregateAdversarial = core.defineAggregate({ name: 'customSum', args: [core.numeric], returns: col.UInt64, deterministic: true, linear: true });
const groupedString = column(col.String, 'text', 'grouped');
const groupedNullable = column(col.Nullable(col.UInt64), 'maybe', 'grouped');
const noArgAggregate = core.defineAggregate({ name: 'customCount', args: [], returns: col.UInt64, nullable: 'never', deterministic: true, linear: true });
const parametricCount = core.defineAggregate({ name: 'customParamCount', params: [col.Float64], args: [], returns: col.UInt64, deterministic: true, linear: true });
const parametricSum = core.defineAggregate({ name: 'customParamSum', params: [col.Float64], args: [core.numeric], returns: col.UInt64, deterministic: true, linear: true });
const cases = {
  membershipEmpty: 'id.in([])',
  membershipNullable: 'nullable.notIn([1n, 2n])',
  membershipGrouped: "groupedString.in(['EOL'])",
  membershipAggregate: 'sum(grouped).notIn([1n])',
  structuralRecursiveChild: "column(col.Array(col.Array(col.Tuple({ child: col.Array(col.Tuple({ 'a.b': col.Nullable(col.UInt64) })) }))), 'root', 'grouped').element('child').element('a.b')",
  structuralRecursiveChildDefault: "column(col.Array(col.Array(col.Tuple({ child: col.Array(col.Tuple({ 'a.b': col.Nullable(col.UInt64) })) }))), 'root', 'agg').element('child').element('a.b').arrayElement(-1).arrayElement(1).arrayElement(99)",
  structuralFixedPrefix: "column(col.String, 's', 'grouped').startsWith(column(col.FixedString(2), 'p', 'grouped'))",
  structuralWrappedPrefix: "column(col.FixedString(3), 's', 'agg').startsWith(column(col.LowCardinality(col.Nullable(col.String)), 'p', 'agg'))",
  structuralConstantPrefix: "column(col.String, 's', 'grouped').startsWith(val('ab', col.FixedString(2)))",
  structuralExtractedPrefix: "column(col.String, 's', 'row').startsWith(column(col.Array(col.Tuple({ p: col.Nullable(col.String) })), 'a', 'row').arrayElement(-1).element('p')).isNull()",
  structuralEmptyTupleDefault: "column(col.Array(col.Tuple({ p: col.Nullable(col.String), n: col.UInt64 })), 'a', 'agg').arrayElement(99).element('n').plus(1n)",
  structuralNullablePrefix: "column(col.String, 's', 'row').startsWith(column(col.Nullable(col.String), 'prefix', 'row'))",
  structuralNullPrefix: "column(col.String, 's', 'agg').startsWith(null)",
  structuralNestedArrays: "column(col.Array(col.Array(col.Tuple({ n: col.UInt64 }))), 'a', 'grouped').element('n').arrayElement(-1).arrayElement(1)",
  structuralWrappedChild: "column(col.Array(col.LowCardinality(col.Nullable(col.String))), 'a', 'row').arrayElement(-1).startsWith('x')",
  structuralTupleAggregate: "sum(column(col.Array(col.Tuple({ n: col.UInt32 })), 'a', 'grouped').arrayElement(-1).element('n'))",
  ...Object.fromEntries(['row', 'grouped', 'agg'].flatMap(mode => Object.entries({
    length: `column(col.Array(col.UInt64), 'a.b', '${mode}').length()`,
    empty: `column(col.Nullable(col.String), '__proto__', '${mode}').empty()`,
    notEmpty: `column(col.Array(col.String), 'a.b', '${mode}').notEmpty()`,
    startsWith: `column(col.LowCardinality(col.Nullable(col.String)), 's', '${mode}').startsWith('a')`,
    has: `column(col.Array(col.UInt64), 'a.b', '${mode}').has(val(1n))`,
    hasAny: `column(col.Array(col.UInt64), 'a.b', '${mode}').hasAny([1n])`,
    arrayElement: `column(col.Array(col.DateTime64(9)), 'a.b', '${mode}').arrayElement(-1)`,
    element: `column(col.NamedTuple([['42', col.Array(col.Nullable(col.String))], ['0', col.UInt64]]), 't', '${mode}').element('42')`,
  }).map(([name, expression]) => [`structural_${mode}_${name}`, expression]))),
  arrayLengthSum: "sum(column(col.Array(col.UInt64), 'a', 'grouped').length()).plus(1n)",
  stringLength: "column(col.Nullable(col.String), 's', 'row').length()",
  stringEmpty: "column(col.FixedString(3), 's', 'row').empty()",
  arrayNotEmpty: "column(col.Array(col.String), 'a', 'grouped').notEmpty()",
  startsWith: "column(col.Nullable(col.String), 's', 'agg').startsWith(val('x'))",
  arrayHas: "column(col.Array(col.Nullable(col.UInt64)), 'a', 'grouped').has(null)",
  arrayHasAny: "column(col.Array(col.UInt64), 'a', 'row').hasAny([1n])",
  arrayElement: "column(col.Array(col.Decimal64(2)), 'a', 'agg').arrayElement(-1)",
  tupleElement: "column(col.Tuple({ 'a.b': col.Nullable(col.String) }), 't', 'row').element('a.b')",
  arrayTupleElement: "column(col.Array(col.Tuple({ mpn: col.Nullable(col.String) })), 'a', 'grouped').element('mpn')",
  composedTupleElement: "column(col.Array(col.Tuple({ description: col.Nullable(col.String) })), 'a', 'agg').arrayElement(1).element('description')",
  nestedMapElement: "column(col.Array(col.Tuple({ m: col.Map(col.UInt64, col.DateTime64(9)) })), 'a', 'row').arrayElement(1).element('m')",
  decimalSubtractAsymmetric: "column(col.Decimal(10, 1), 'd', 'grouped').minus(column(col.Decimal(19, 3), 'e', 'grouped'))",
  decimalMultiplyBoundary: "column(col.Decimal(38, 2), 'd', 'grouped').multiply(column(col.Decimal(39, 3), 'e', 'grouped'))",
  decimalDivideAsymmetric: "column(col.Decimal64(3), 'd', 'grouped').divide(column(col.Decimal32(2), 'e', 'grouped'))",
  decimalNullableMultiply: "column(col.LowCardinality(col.Nullable(col.Decimal64(2))), 'd', 'grouped').multiply(column(col.Decimal32(1), 'e', 'grouped'))",
  decimalNullOperand: "column(col.Decimal64(2), 'd', 'grouped').multiply(null)",
  decimalMergeComposition: "sumMerge(column(col.AggregateFunction('sum', col.Decimal64(2)), 's', 'grouped')).multiply(sum(column(col.Decimal(39, 3), 'e', 'grouped')))",
  decimalArithmeticExact: "column(col.Decimal64(2), 'd', 'grouped').plus(column(col.Decimal64(2), 'e', 'grouped'))",
  decimalMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Map(col.Decimal64(2), col.Nullable(col.String))), 's', 'grouped'))",
  timestampMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Map(col.DateTime64(9), col.UInt64)), 's', 'grouped'))",
  enumMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Map(col.Enum8({ a: 1, b: 2 }), col.Array(col.Nullable(col.DateTime64(3))))), 's', 'grouped'))",
  fixedMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Map(col.FixedString(3), col.Map(col.UInt64, col.String))), 's', 'grouped'))",
  tupleStringMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Tuple({ labels: col.Map(col.String, col.UInt64) })), 's', 'grouped'))",
  tupleNumericMapMerge: "maxMerge(column(col.AggregateFunction('max', col.Tuple([col.Map(col.UInt64, col.Nullable(col.String))])), 's', 'grouped'))",
  orderedNestedTupleMerge: "maxMerge(column(col.AggregateFunction('max', col.NamedTuple([['42', col.Array(col.Enum16({ a: -1, b: 32767 }))], ['0', col.FixedString(3)]])), 's', 'grouped'))",
  fixedStringArrayMerge: "maxMerge(column(col.AggregateFunction('max', col.Array(col.FixedString(3))), 's', 'grouped'))",
  enumArrayMerge: "maxMerge(column(col.AggregateFunction('max', col.Array(col.Enum8({ a: 1, b: 2 }))), 's', 'grouped'))",
  tupleArrayMerge: "maxMerge(column(col.AggregateFunction('max', col.Array(col.Tuple({ id: col.UInt64, at: col.DateTime64(3) }))), 's', 'grouped'))",
  decimalBoundary38: "sum(column(col.Decimal(38, 2), 'd', 'grouped'))",
  decimalBoundary39: "sum(column(col.Decimal(39, 2), 'd', 'grouped'))",
  decimalBoundary75If: "sumIf(column(col.Decimal(75, 2), 'd', 'grouped'), val(true))",
  decimalBoundary39Merge: "sumMerge(column(col.AggregateFunction('sum', col.Decimal(39, 2)), 's', 'grouped'))",
  dateTimeMaxMerge: "maxMerge(column(col.AggregateFunction('max', col.DateTime64(3)), 's', 'grouped'))",
  arrayMaxMerge: "maxMerge(column(col.AggregateFunction('max', col.Array(col.UInt64)), 's', 'grouped'))",
  sumIfArithmeticExact: "sumIf(column(col.Float64, 'stock', 'grouped'), val(true)).plus(1)",
  mergeArithmeticExact: "sumMerge(column(col.AggregateFunction('sum', col.Float64), 'state', 'grouped')).plus(1)",
  nullableCommonArithmeticExact: "column(col.Nullable(col.UInt8), 'stock', 'grouped').ifNull(column(col.Nullable(col.UInt32), 'wide', 'grouped')).plus(1)",
  aggregateFloatArithmeticExact: "sum(column(col.Float64, 'stock', 'grouped')).plus(1)",
  aggregateIntegerArithmeticExact: "max(column(col.UInt32, 'stock', 'grouped')).plus(1)",
  fallbackThenSumExact: "sum(column(col.Float64, 'stock', 'grouped').ifNull(null))",
  dateMaxMergeExact: "maxMerge(column(col.AggregateFunction('max', col.Date), 'state', 'grouped'))",
  floatArithmeticExact: "column(col.Float64, 'stock', 'grouped').plus(1)",
  smallIntegerArithmeticExact: "column(col.UInt8, 'stock', 'grouped').plus(1)",
  wideIntegerArithmeticExact: "column(col.UInt32, 'stock', 'grouped').plus(1)",
  composedFloatSumExact: "sum(column(col.Float64, 'stock', 'grouped').multiply(2))",
  nonNullableFallbackExact: "column(col.Float64, 'stock', 'grouped').ifNull(null)",
  decimalSumExact: "sum(column(col.Decimal64(2), 'stock', 'grouped'))",
  floatMergeExact: "sumMerge(column(col.AggregateFunction('sum', col.Float64), 'state', 'grouped'))",
  defaultFloatSum: 'sum(val(1))',
  typedIntegerSum: 'sum(val(1, col.UInt32))',
  typedNullableFloatSum: 'sum(val(null, col.Nullable(col.Float64)))',
  castIntegerSum: "sum(cast(column(col.Float64, 'stock', 'grouped'), col.UInt32))",
  declaredFloatSum: "sum(column(col.UInt32, 'stock', 'grouped').as(col.Float64))",
  wrappedFloatSum: "sum(column(col.LowCardinality(col.Nullable(col.Float64)), 'stock', 'grouped'))",
  floatSumIf: "sumIf(column(col.Float64, 'stock', 'grouped'), val(true))",
  builtinConstantSum: 'sum(val(1n, col.UInt64))',
  builtinConstantMax: 'max(val(1n, col.UInt64))',
  builtinConstantCountIf: 'countIf(val(true))',
  declaredConstantAggregate: 'nullableAggregateAdversarial(val(1n).as(col.UInt64))',
  floatSumExact: "sum(column(col.Float64, 'stock', 'grouped'))",
  integerSumExact: "sum(column(col.UInt32, 'stock', 'grouped'))",
  nullableFloatSumExact: "sum(column(col.Nullable(col.Float64), 'stock', 'grouped'))",
  declaredConstantSumIf: 'sumIf(val(1n).as(col.UInt64), predicate)',
  declaredConstantSumState: 'sumState(val(1n).as(col.UInt64))',
  declaredConstantMaxState: 'maxState(val(1n).as(col.UInt64))',
  parametricNoRoot: 'parametricCount(0.5)()',
  parametricConstantOnly: 'parametricSum(0.5)(1n)',
  parametricValOnly: 'parametricSum(0.5)(val(1n))',
  parametricRooted: 'parametricSum(0.5)(grouped)',
  constantValAggregate: 'nullableAggregateAdversarial(val(1n))',
  rootedUserAggregate: 'nullableAggregateAdversarial(grouped)',
  noRootAggregate: 'noArgAggregate()',
  constantOnlyAggregate: 'nullableAggregateAdversarial(1n)',
  primitiveFirst: "distanceAdversarial('abc', groupedString)",
  arg0Return: 'identityAdversarial(groupedString)',
  nullableUserAggregate: 'nullableAggregateAdversarial(groupedNullable)',
  ...Object.fromEntries(['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'plus', 'minus', 'multiply', 'divide'].map(n => [n, `id.${n}(3n)`])),
  and: 'predicate.and(true)', or: 'predicate.or(false)', not: 'predicate.not()',
  isNull: 'nullable.isNull()', isNotNull: 'nullable.isNotNull()', ifNull: 'nullable.ifNull(0n)',
  nullableCompare: 'nullable.eq(1n)', nullableFallback: 'nullable.ifNull(null)', constant: 'grouped.plus(val(1n))',
  cast: 'cast(grouped, col.Float64)', declared: 'grouped.as(col.String)',
  count: 'count()', countIf: 'countIf(predicate)', sum: 'sum(grouped)', max: 'max(grouped)', sumIf: 'sumIf(grouped, predicate)',
  countState: 'countState()', sumState: 'sumState(grouped)', maxState: 'maxState(grouped)', countMerge: 'countMerge(state)',
};
assert.deepEqual(Object.getOwnPropertyNames(Expr.prototype).filter(n => !['constructor', 'as'].includes(n)).sort(), [...core.methodCatalog, ...core.orderingCatalog].map(d => d.name).sort());
const directory = mkdtempSync(join(tmpdir(), 'chql-expr-surface-'));
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 90000 });
  if (r.status !== 0) throw new Error(`${command} failed\n${r.stdout}\n${r.stderr}`);
}
try {
  mkdirSync(join(directory, 'node_modules/@chql'), { recursive: true });
  symlinkSync(resolve('packages/core'), join(directory, 'node_modules/@chql/core'), 'dir');
  symlinkSync(resolve('node_modules/expect-type'), join(directory, 'node_modules/expect-type'), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const declaration = readFileSync('packages/core/src/expr-methods.generated.d.ts', 'utf8');
  assert.equal(declaration, readFileSync('test/types/snapshots/expr-methods.generated.d.ts', 'utf8'));
  writeFileSync(join(directory, 'surface.d.ts'), declaration);
  // Only published type re-exports, not core source or a fake expression implementation.
  writeFileSync(join(directory, 'ordering.d.ts'), "export { Ordering } from '@chql/core';\n");
  writeFileSync(join(directory, 'expr.d.ts'), "export type { Expr, Constant } from '@chql/core';\n");
  writeFileSync(join(directory, 'subquery.d.ts'), "export type { SetQuery } from '@chql/core';\n");
  writeFileSync(join(directory, 'types.d.ts'), "export type { Mode, Decimal } from '@chql/core';\n");
  mkdirSync(join(directory, 'catalog'));
  writeFileSync(join(directory, 'catalog/descriptor-types.d.ts'), "export type { IfNullResult, FallbackDescriptor, StructuralReceiver, StructuralResult, ArrayElementResult, ElementKeys, ElementResult } from '@chql/core';\n");
  let source = `import { expectTypeOf } from 'expect-type';
import { Expr, columnExpr, col, exprNode, count, countIf, sum, max, sumIf, sumState, countState, maxState, countMerge, val, cast, defineFunction, defineAggregate, numeric, extendExpr, stringLike, type Mode, type Column, type NodeId, type AggregateState, type Decimal, type DescribedExpr, sumMerge, maxMerge } from '@chql/core';
import type { GeneratedExprMethods } from './surface.js';
// Compare all three phantoms exactly, independently of retained descriptor intersections.
type ExpressionPhantoms<E> = E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
function column<C extends Column, N extends string, M extends Mode>(descriptor: C, name: N, mode: M) { return columnExpr(descriptor, 1 as NodeId, [name], name, mode); }
const id = column(col.UInt64, 'id', 'row');
expectTypeOf(id.asc()).toEqualTypeOf<import('@chql/core').Ordering<'row'>>();
expectTypeOf(id.desc().nullsFirst().nullsLast()).not.toBeAny();
const nullable = column(col.Nullable(col.UInt64), 'nullable', 'row');
const predicate = column(col.Nullable(col.Bool), 'predicate', 'grouped');
const grouped = column(col.UInt64, 'stock', 'grouped');
expectTypeOf(grouped.desc()).toEqualTypeOf<import('@chql/core').Ordering<'grouped'>>();
const state = column(col.AggregateFunction('count'), 'state', 'grouped');
const distanceAdversarial = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
const identityAdversarial = defineFunction({ name: 'identity', args: [stringLike], returns: 'arg0', deterministic: true });
const nullableAggregateAdversarial = defineAggregate({ name: 'customSum', args: [numeric], returns: col.UInt64, deterministic: true, linear: true });
const groupedString = column(col.String, 'text', 'grouped');
const groupedNullable = column(col.Nullable(col.UInt64), 'maybe', 'grouped');
const noArgAggregate = defineAggregate({ name: 'customCount', args: [], returns: col.UInt64, nullable: 'never', deterministic: true, linear: true });
const parametricCount = defineAggregate({ name: 'customParamCount', params: [col.Float64], args: [], returns: col.UInt64, deterministic: true, linear: true });
const parametricSum = defineAggregate({ name: 'customParamSum', params: [col.Float64], args: [numeric], returns: col.UInt64, deterministic: true, linear: true });
expectTypeOf<keyof GeneratedExprMethods<bigint>>().toEqualTypeOf<Exclude<Extract<keyof Expr<bigint>, string>, 'ir' | 'name' | 'mode' | 'as' | 'distanceTo'>>();
`;
  for (const [name, expression] of Object.entries(cases)) {
    // Fixed repository-owned expressions, never user SQL or external input.
    const value = eval(expression);
    assert.ok(value instanceof Expr);
    assert.ok(value.ir.type);
    const expected = name === 'cast' || name === 'declared'
      ? `DescribedExpr<${toTypeScript(value.ir.type)}, ${JSON.stringify(value.name)}, ${JSON.stringify(value.mode)}, typeof col.${name === 'cast' ? 'Float64' : 'String'}.type>`
      : `Expr<${toTypeScript(value.ir.type)}, ${JSON.stringify(value.name)}, ${JSON.stringify(value.mode)}>`;
    const described = !['cast', 'declared'].includes(name);
    source += `const case_${name} = ${expression};\n${described ? `expectTypeOf<ExpressionPhantoms<typeof case_${name}>>()` : `expectTypeOf(case_${name})`}.toEqualTypeOf<${expected}>();\nexpectTypeOf(case_${name}).not.toBeAny();\n`;
  }
  source += `
declare module '@chql/core' {
  interface ExprMethods<T, N extends string = never, M extends Mode = 'row'> {
    distanceTo(this: Expr<string>, other: Expr<string> | string): Expr<bigint>;
  }
}
const editDistance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
extendExpr({ distanceTo(this: Expr<string>, other: Expr<string> | string) { return editDistance(this, other); } });
expectTypeOf(val('abc').distanceTo('abd')).toEqualTypeOf<Expr<bigint>>();
`;
  writeFileSync(join(directory, 'consumer.ts'), source);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [], skipLibCheck: false }, include: ['consumer.ts', 'surface.d.ts'] }));
  const version = process.env.CHQL_TYPESCRIPT_VERSION;
  run('pnpm', [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc']), '--project', join(directory, 'tsconfig.json')]);
  const editDistance = core.defineFunction({ name: 'editDistance', args: [core.stringLike, core.stringLike], returns: col.UInt64, deterministic: true });
  core.extendExpr({ distanceTo(other) { return editDistance(this, other); } });
  assert.equal(val('abc').distanceTo('abd').ir.fn.name, 'editDistance');
  console.log(`Built ESM installation, user declaration merging, standalone generated declarations and ${Object.keys(cases).length} exact/not-any runtime-type cases passed.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
