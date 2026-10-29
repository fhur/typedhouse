import { describe, expect, it } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { quantile, quantileIf, avg, avgIf, argMax, argMaxIf, Expr, aggregateDefinitions, col, count, countIf, countState, defineAggregate, defineFunction, exprNode, extendExpr, max, maxMerge, methodCatalog, orderingCatalog, stringLike, sum, sumIf, sumMerge, sumState, val, parseCHType, type Column, type NodeId } from '../src/index.js';
function grouped<T>(column: Column<T>) { return new Expr<T, 'value', 'grouped'>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: ['value'], type: column.type }), 'value', 'grouped'); }
describe('catalog slice', () => {
  it('installs exactly its generated method surface', () => {
    expect(Object.getOwnPropertyNames(Expr.prototype).filter(n => !['constructor', 'as'].includes(n)).sort()).toEqual([...methodCatalog, ...orderingCatalog].map(d => d.name).sort());
    expect(orderingCatalog.map(d => d.name)).toEqual(['asc', 'desc']);
    expect(methodCatalog).toHaveLength(28);
    for (const definition of [...methodCatalog, ...aggregateDefinitions]) {
      expect(definition.deterministic).toBe(definition.name !== 'quantile');
      expect(definition.origin).toBe('typed'); expect(definition).not.toHaveProperty('js');
      if (typeof definition.returns === 'function') expect(definition.tsReturns).toBeTruthy();
    }
  });
  it('retains quantile roots, descriptors and fresh-per-application immutable level Params', () => {
    const curry = quantile(0.5), value = grouped(col.Nullable(col.Float64));
    const a = curry(value), b = curry(value);
    expect(a).toMatchObject({ name: 'value', mode: 'agg', ir: { type: col.Nullable(col.Float64).type, fn: { linear: false, deterministic: false } } });
    expect(quantileIf(1)(val(2), grouped(col.Bool)).name).toBe('quantile');
    if (a.ir.kind !== 'Agg' || b.ir.kind !== 'Agg') throw new Error('Agg');
    expect(a.ir.params[0]).not.toBe(b.ir.params[0]);
    expect(a.ir.params[0]).toMatchObject({ kind: 'Param', type: col.Float64.type, value: 0.5 });
    expect(a.ir.args[0]).toBe(value.ir);
    expect(Object.isFrozen(a.ir.params[0])).toBe(true);
  });
  it('retains weekly descriptors, modes and immutable edges', () => {
    const input = val(new Date('2024-03-04T12:00:00Z'), col.Nullable(col.DateTime64(3)));
    const result = input.toStartOfWeek();
    expect(result.ir.type).toEqual(col.Nullable(col.Date).type);
    expect(result.mode).toBe('row');
    if (result.ir.kind !== 'Call') throw new Error('expected Call');
    expect(result.ir.args[0]).toBe(input.ir);
    expect(Object.isFrozen(result.ir.args)).toBe(true);
    expect(Object.isFrozen(result.ir.type)).toBe(true);
  });
  it('retains root names and aggregate modes through methods and combinators', () => {
    const x = grouped(col.Float64);
    expect(count()).toMatchObject({ name: 'count', mode: 'agg', ir: { kind: 'Agg', type: col.UInt64.type } });
    expect(sum(x)).toMatchObject({ name: 'value', mode: 'agg', ir: { type: col.Float64.type, fn: { linear: true } } });
    expect(max(x).ir).toMatchObject({ fn: { linear: false } });
    expect(sum(x).divide(sum(x)).mode).toBe('agg');
    expect(sumIf(x, x.gt(0)).ir).toMatchObject({ kind: 'Agg', combinators: ['If'], fn: { name: 'sum' } });
    expect(countIf(x.gt(0)).ir).toMatchObject({ combinators: ['If'], type: col.UInt64.type });
    expect(sumState(x).ir.type).toEqual(col.AggregateFunction('sum', col.Float64).type);
    expect(countState().name).toBe('count');
    expect(sumMerge(grouped(col.AggregateFunction('sum', col.Float64))).ir).toMatchObject({ combinators: ['Merge'], type: col.Float64.type });
  });
  it('retains mean roots, nullable Float64 descriptors and immutable operand edges', () => {
    const value = grouped(col.Nullable(col.UInt256)), predicate = grouped(col.Nullable(col.Bool));
    const result = avgIf(value, predicate);
    expect(result).toMatchObject({ name: 'value', mode: 'agg', ir: { type: col.Nullable(col.Float64).type, fn: { name: 'avg', deterministic: true, linear: true }, combinators: ['If'] } });
    if (result.ir.kind !== 'Agg') throw new Error('expected Agg');
    expect(result.ir.args[0]).toBe(value.ir); expect(result.ir.args[1]).toBe(predicate.ir);
    expect(Object.isFrozen(result.ir.args)).toBe(true);
    expect(Object.isFrozen(result.ir.type)).toBe(true);
    expect(avg(val(1)).name).toBe('avg');
    expect(avgIf(val(1), predicate).name).toBe('value');
    expect(avgIf(grouped(col.UInt32), predicate).ir.type).toEqual(col.Float64.type);
  });
  it('retains argMax value roots, descriptors and immutable operand edges', () => {
    const value = grouped(col.Nullable(col.Float32)), version = grouped(col.UInt32);
    const result = argMax(value, version);
    expect(result).toMatchObject({ name: 'value', mode: 'agg', ir: { type: value.ir.type, fn: { deterministic: true, linear: false } } });
    if (result.ir.kind !== 'Agg') throw new Error('expected Agg');
    expect(result.ir.args[0]).toBe(value.ir); expect(result.ir.args[1]).toBe(version.ir);
    expect(Object.isFrozen(result.ir.args)).toBe(true);
    expect(argMax(val('constant'), version).name).toBe('argMax');
    expect(argMaxIf(val('constant'), version, version.gt(0)).name).toBe('argMax');
    expect(argMaxIf(value, version, val(false)).ir).toMatchObject({ combinators: ['If'], type: value.ir.type });
  });
  it('supports application functions without putting executable resolvers into IR', () => {
    const distance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
    const call = distance(grouped(col.String), 'abc');
    expect(call).toMatchObject({ name: 'value', mode: 'grouped', ir: { kind: 'Call', type: col.UInt64.type, fn: { origin: 'user' } } });
    expect(call.ir).not.toHaveProperty('definition');
    const topK = defineAggregate({ name: 'topK', params: [col.UInt64], args: [stringLike], returns: col.Array(col.String), deterministic: true, linear: false });
    expect(topK(3)(grouped(col.String)).ir).toMatchObject({ kind: 'Agg', params: [{ kind: 'Param', value: 3 }], type: col.Array(col.String).type });
    const sameName = defineFunction({ name: 'eq', args: [stringLike], returns: col.Bool, deterministic: true });
    expect(sameName(grouped(col.String)).ir).toMatchObject({ fn: { name: 'eq', origin: 'user' } });
  });
  it('resolves application names, modes and nullable policies without changing parameters', () => {
    const identity = defineFunction({ name: 'identity', args: [stringLike], returns: 'arg0', deterministic: true });
    const distance = defineFunction({ name: 'distance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
    const input = grouped(col.Nullable(col.String));
    expect(identity(input).ir.type).toEqual(input.ir.type);
    const constant = val('abc');
    const call = distance(constant, input);
    expect(call).toMatchObject({ name: 'value', mode: 'grouped', ir: { type: col.Nullable(col.UInt64).type } });
    if (call.ir.kind !== 'Call') throw new Error('Call expected');
    expect(call.ir.args[0]).toBe(constant.ir);
    const aggregate = defineAggregate({ name: 'nullableResult', args: [stringLike], returns: col.UInt64, deterministic: true, linear: false });
    expect(aggregate(input).ir.type).toEqual(col.Nullable(col.UInt64).type);
    expect(maxMerge(grouped(col.AggregateFunction('max', col.LowCardinality(col.Nullable(col.String))))).ir.type).toEqual(col.Nullable(col.String).type);
  });
  it('preserves sum storage boundaries and recursive Merge argument descriptors', () => {
    for (let precision = 1; precision <= 76; precision++) {
      const input = col.Decimal(precision, 0);
      const expected = col.Decimal(precision > 38 ? 76 : 38, 0).type;
      expect(sum(grouped(input)).ir.type).toEqual(expected);
      expect(sumIf(grouped(input), val(true)).ir.type).toEqual(expected);
      expect(sumMerge(grouped(col.AggregateFunction('sum', input))).ir.type).toEqual(expected);
    }
    const input = col.Array(col.Array(col.Nullable(col.DateTime64(3, 'UTC'))));
    const state = grouped(col.AggregateFunction('max', input));
    const merged = maxMerge(state);
    expect(merged.ir.type).toEqual(input.type);
    expect(Object.isFrozen(merged.ir.type)).toBe(true);
    if (merged.ir.kind !== 'Agg') throw new Error('Agg expected');
    expect(merged.ir.args[0]).toBe(state.ir);
  });
  it('rejects method collisions atomically', () => {
    expect(() => extendExpr({ uniqueNotInstalled() {}, eq() {} })).toThrow('duplicate_function: eq');
    expect(Expr.prototype).not.toHaveProperty('uniqueNotInstalled');
    expect(() => extendExpr({ constructor() {} })).toThrow('duplicate_function');
  });
  it('agrees with actual ClickHouse 24.8 numeric/nullable/decimal result types', async () => {
    const container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
    try {
      const cases = [
        [avg(grouped(col.UInt256)), 'avg(toUInt256(7))'],
        [avg(grouped(col.Nullable(col.Float32))), 'avg(toNullable(toFloat32(7)))'],
        [avgIf(grouped(col.Float64), grouped(col.Nullable(col.Bool))), 'avgIf(toFloat64(7),CAST(NULL AS Nullable(Bool)))'],
        [argMax(grouped(col.Nullable(col.Float64)), grouped(col.UInt32)), 'argMax(toNullable(toFloat64(1)),toUInt32(2))'],
        [argMaxIf(grouped(col.Bool), grouped(col.UInt32), val(false)), 'argMaxIf(true,toUInt32(2),false)'],
        [sum(grouped(col.Nullable(col.Float64))), 'sum(toNullable(toFloat64(1)))'],
        [sumIf(grouped(col.UInt64), grouped(col.Nullable(col.Bool))), 'sumIf(toUInt64(1), toNullable(true))'],
        [max(grouped(col.Nullable(col.UInt32))), 'max(toNullable(toUInt32(1)))'],
        [sum(grouped(col.Decimal64(2))), 'sum(toDecimal64(1,2))'],
        [sum(grouped(col.Decimal256(2))), 'sum(toDecimal256(1,2))'],
        [grouped(col.Decimal64(2)).divide(grouped(col.Decimal64(2))), 'toDecimal64(1,2)/toDecimal64(1,2)'],
        [grouped(col.UInt32).plus(1), 'toUInt32(1)+toUInt32(1)'],
        [grouped(col.Decimal64(2)).plus(grouped(col.Decimal64(2))), 'toDecimal64(1,2)+toDecimal64(2,2)'],
        [grouped(col.Decimal(19, 3)).minus(grouped(col.Decimal64(2))), 'CAST(2 AS Decimal(19,3))-toDecimal64(1,2)'],
        [grouped(col.Decimal64(2)).multiply(grouped(col.Decimal128(3))), 'toDecimal64(1,2)*toDecimal128(2,3)'],
        [grouped(col.Nullable(col.Decimal64(3))).divide(grouped(col.Decimal128(2))), 'toNullable(toDecimal64(1,3))/toDecimal128(2,2)'],
        [grouped(col.Decimal(39, 2)).plus(grouped(col.Decimal128(3))), 'CAST(1 AS Decimal(39,2))+toDecimal128(2,3)'],
      ] as const;
      // The resolver describes output; later validation must handle invalid scale combinations.
      const invalid = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: 'SELECT toDecimal64(1,2)/toDecimal128(2,3)' });
      expect(invalid.ok).toBe(false);
      expect(await invalid.text()).toContain("Decimal result's scale is less than argument's one");
      for (const [expression, sql] of cases) {
        const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: `SELECT toTypeName(${sql}) AS type FORMAT JSONEachRow` });
        const text = await response.text();
        expect(response.ok, text).toBe(true);
        expect(expression.ir.type).toEqual(parseCHType((JSON.parse(text) as { type: string }).type));
      }
    } finally { await container.stop(); }
  });
});
