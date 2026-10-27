import { describe, expect, it } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { Expr, col, columnExpr, defineAggregate, defineFunction, exprNode, max, maxIf, sum, sumIf, sumState, sumMerge, maxMerge, parseCHType, stringLike, val, type Column, type Decimal, type Mode, type NodeId } from '../src/index.js';
function ref<T, M extends Mode>(descriptor: Column<T>, mode: M) {
  return new Expr<T, 'value', M>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: ['value'], type: descriptor.type }), 'value', mode);
}

describe('expression adversarial boundaries', () => {
  it('owns Decimal operands and hostile roots through scale-changing composition', () => {
    const path = ['__proto__', "d`); DROP TABLE t; --"];
    const d = columnExpr(col.Decimal64(2), 1 as NodeId, path, '__proto__', 'grouped');
    const value = '1.25' as Decimal<18, 2>;
    const a = d.multiply(value);
    const b = d.multiply(value);
    path[1] = 'changed';
    if (a.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('Call expected');
    expect(a.ir.args[0]).toBe(d.ir);
    expect(a.ir.args[1]).not.toBe(b.ir.args[1]);
    expect(a.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: '1.25' });
    expect(a).toMatchObject({ name: '__proto__', mode: 'grouped', ir: { type: col.Decimal64(4).type } });
    expect(d.ir).toMatchObject({ path: ['__proto__', "d`); DROP TABLE t; --"] });
    expect(Reflect.set(a.ir.type!, 'scale', 0)).toBe(false);
    expect(Reflect.set(a.ir.args[1]!, 'value', '0')).toBe(false);
    expect(sum(a).ir.type).toEqual(col.Decimal128(4).type);
  });
  it('owns hostile Map constants and nested dates without changing Map evidence', () => {
    const descriptor = col.Map(col.String, col.Array(col.Nullable(col.DateTime64(3))));
    const date = new Date('2026-10-27T12:34:56.123Z');
    const input = { ['__proto__']: [date, null] };
    const constant = val(input, descriptor);
    date.setTime(0);
    input.__proto__.push(null);
    if (constant.ir.kind !== 'Param') throw new Error('Param expected');
    const captured = constant.ir.value as Record<string, (Date | null)[]>;
    expect(captured.__proto__).toHaveLength(2);
    expect(captured.__proto__![0]!.toISOString()).toBe('2026-10-27T12:34:56.123Z');
    captured.__proto__![0]!.setTime(0);
    expect((constant.ir.value as typeof captured).__proto__![0]!.toISOString()).toBe('2026-10-27T12:34:56.123Z');
    expect(Reflect.set(captured, '__proto__', [])).toBe(false);
    expect(Reflect.set(descriptor.type.key, 'name', 'UInt64')).toBe(false);
    expect(constant.ir.type).toEqual(descriptor.type);
  });
  it('retains ordered numeric tuple fields and nested Map ownership across Merge', () => {
    const entries: [string, Column][] = [['42', col.Map(col.String, col.UInt64)], ['0', col.FixedString(3)]];
    const descriptor = col.NamedTuple(entries);
    const state = columnExpr(col.AggregateFunction('max', descriptor), 1 as NodeId, ['__proto__'], '__proto__', 'grouped');
    entries.reverse();
    entries[0]![0] = 'mutated';
    const result = maxMerge(state);
    expect(result.ir.type).toEqual(descriptor.type);
    if (result.ir.type?.kind !== 'Tuple' || result.ir.kind !== 'Agg') throw new Error('Tuple Agg expected');
    expect(result.ir.type.items.map(item => item.name)).toEqual(['42', '0']);
    expect(result.ir.args[0]).toBe(state.ir);
    const map = result.ir.type.items[0]!.type;
    if (map.kind !== 'Map') throw new Error('Map expected');
    expect(Reflect.set(map.value, 'name', 'Float64')).toBe(false);
    expect(Reflect.set(result.ir.type.items, 'length', 0)).toBe(false);
  });
  it('owns nested Merge descriptors with hostile tuple names', () => {
    const input = col.Array(col.Tuple({ ['__proto__']: col.UInt64, ["x`); DROP TABLE t; --"]: col.Nullable(col.DateTime64(3)) }));
    const state = columnExpr(col.AggregateFunction('max', input), 1 as NodeId, ['s'], 's', 'grouped');
    const result = maxMerge(state);
    expect(result.ir.type).toEqual(input.type);
    if (result.ir.type?.kind !== 'Array' || result.ir.type.inner.kind !== 'Tuple' || result.ir.kind !== 'Agg') throw new Error('unexpected descriptor');
    expect(result.ir.args[0]).toBe(state.ir);
    expect(result.ir.type.inner.items.map(item => item.name)).toEqual(['__proto__', "x`); DROP TABLE t; --"]);
    expect(Reflect.set(result.ir.type.inner.items[0]!, 'name', 'changed')).toBe(false);
    expect(Reflect.set(result.ir.type.inner.items, 'length', 0)).toBe(false);
  });
  it('retains Merge and ifNull edges without trusting caller-owned names or fallback values', () => {
    const path = ['__proto__', "s`); DROP TABLE secrets; --"];
    const state = columnExpr(col.AggregateFunction('sum', col.Nullable(col.Float64)), 1 as NodeId, path, 's', 'grouped');
    const merged = sumMerge(state);
    const a = merged.ifNull(0);
    const b = merged.ifNull(0);
    path[1] = 'changed';
    if (merged.ir.kind !== 'Agg' || a.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('unexpected nodes');
    expect(merged.ir.args[0]).toBe(state.ir);
    expect(merged.ir.combinators).toEqual(['Merge']);
    expect(a.ir.args[0]).toBe(merged.ir);
    expect(a.ir.args[1]).not.toBe(b.ir.args[1]);
    expect(a.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: 0 });
    expect(a).toMatchObject({ name: 's', mode: 'agg', ir: { type: col.Float64.type } });
    expect(state.ir).toMatchObject({ path: ['__proto__', "s`); DROP TABLE secrets; --"] });
    expect(Reflect.set(merged.ir.combinators, '0', 'State')).toBe(false);
    expect(Reflect.set(a.ir.args[1]!, 'value', 99)).toBe(false);
  });
  it('keeps aggregate arithmetic edges immutable and parameters distinct', () => {
    const input = columnExpr(col.Float64, 1 as NodeId, ['__proto__'], '__proto__', 'grouped');
    const aggregate = sum(input);
    const a = aggregate.plus(1);
    const b = aggregate.plus(1);
    if (a.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('Call expected');
    expect(a.ir.args[0]).toBe(aggregate.ir);
    expect(b.ir.args[0]).toBe(aggregate.ir);
    expect(a.ir.args[1]).not.toBe(b.ir.args[1]);
    expect(a.ir.args[1]).toMatchObject({ kind: 'Param', value: 1, type: null });
    expect(Reflect.set(a.ir.args, '0', input.ir)).toBe(false);
    expect(a).toMatchObject({ name: '__proto__', mode: 'agg', ir: { type: col.Float64.type } });
  });
  it('preserves descriptor-backed composition, hostile paths and unresolved operand identity', () => {
    const path = ['__proto__', "stock`); DROP TABLE t; --"];
    const input = columnExpr(col.Float64, 1 as NodeId, path, 'stock', 'grouped');
    const multiplied = input.multiply(2);
    const result = sum(multiplied);
    path[1] = 'mutated';
    expect(result).toMatchObject({ name: 'stock', mode: 'agg', ir: { type: col.Float64.type } });
    if (result.ir.kind !== 'Agg' || multiplied.ir.kind !== 'Call') throw new Error('unexpected expression shape');
    expect(result.ir.args[0]).toBe(multiplied.ir);
    expect(multiplied.ir.args[0]).toBe(input.ir);
    expect(input.ir).toMatchObject({ path: ['__proto__', "stock`); DROP TABLE t; --"] });
    expect(multiplied.ir.args[1]).toMatchObject({ kind: 'Param', value: 2, type: null });
    expect(Reflect.set(multiplied.ir.args[1]!, 'value', 0)).toBe(false);
    expect(input.multiply(2).ir).not.toBe(multiplied.ir);
    expect(val(null).ir).toMatchObject({ kind: 'Param', type: null });
  });
  it('retains declared constant identity through derived combinators with hostile roots', () => {
    const value = val(7n).as(col.UInt64);
    const name = "__proto__`); DROP TABLE t; --";
    const predicate = new Expr<boolean, typeof name, 'grouped'>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: [name], type: col.Bool.type }), name, 'grouped');
    for (const expression of [sumIf(value, predicate), maxIf(value, predicate)]) {
      expect(expression).toMatchObject({ name, mode: 'agg' });
      if (expression.ir.kind !== 'Agg') throw new Error('Agg expected');
      expect(expression.ir.args[0]).toBe(value.ir);
      expect(expression.ir.args[1]).toBe(predicate.ir);
      expect(expression.ir.combinators).toEqual(['If']);
      expect(Reflect.set(expression.ir.args, '0', predicate.ir)).toBe(false);
    }
    const state = sumState(value);
    expect(state).toMatchObject({ name: 'sum', mode: 'agg' });
    expect(state.ir.type).toEqual(col.AggregateFunction('sum', col.UInt64).type);
    expect(value.ir).toMatchObject({ kind: 'Param', value: 7n, type: col.UInt64.type });
  });
  it('owns parametric constants and keeps declared constants rootless without inlining', () => {
    const aggregate = defineAggregate({ name: 'customText', params: [col.String], args: [stringLike], returns: col.String, deterministic: true, linear: false });
    const hostile = "x'); DROP TABLE secrets; --";
    const input = val(hostile);
    const result = aggregate(hostile)(input);
    expect(result).toMatchObject({ name: 'customText', mode: 'agg' });
    if (result.ir.kind !== 'Agg') throw new Error('Agg expected');
    expect(result.ir.args[0]).toBe(input.ir);
    expect(result.ir.params[0]).toMatchObject({ kind: 'Param', value: hostile, type: col.String.type });
    expect(result.ir.params[0]).not.toBe(input.ir);
    expect(Object.isFrozen(result.ir.params)).toBe(true);
    expect(Reflect.set(result.ir.params[0]!, 'value', 'changed')).toBe(false);
    expect(result.ir.params[0]).toMatchObject({ value: hostile });
  });
  it('names rootless application aggregates and never turns hostile constants into literals', () => {
    const rootless = defineAggregate({ name: 'customCount', args: [], returns: col.UInt64, nullable: 'never', deterministic: true, linear: true });
    expect(rootless()).toMatchObject({ name: 'customCount', mode: 'agg' });
    const aggregate = defineAggregate({ name: 'customText', args: [stringLike], returns: col.String, deterministic: true, linear: false });
    const hostile = "x'); DROP TABLE secrets; --";
    const result = aggregate(hostile);
    expect(result).toMatchObject({ name: 'customText', mode: 'agg' });
    if (result.ir.kind !== 'Agg') throw new Error('Agg expected');
    expect(result.ir.args[0]).toMatchObject({ kind: 'Param', value: hostile, type: null });
    const identity = defineFunction({ name: 'identity', args: [stringLike], returns: 'arg0', deterministic: true });
    const unresolved = val(null);
    const call = identity(unresolved);
    if (call.ir.kind !== 'Call') throw new Error('Call expected');
    expect(call.ir.args[0]).toBe(unresolved.ir);
    expect(unresolved.ir.type).toBeNull();
    expect(call.ir.type).toMatchObject({ kind: 'Nullable' });
  });
  it('keeps null from an unresolved constant in comparison result metadata', () => {
    const result = ref(col.String, 'row').eq(val(null));
    expect(result.ir.type).toEqual(col.Nullable(col.Bool).type);
    if (result.ir.kind !== 'Call') throw new Error('Call expected');
    expect(result.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: null });
  });

  it('agrees with live ClickHouse for mixed-width null fallbacks and wrapped aggregates', async () => {
    const container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
      .withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' }).withExposedPorts(8123)
      .withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
    try {
      const cases = [
        [columnExpr(col.Decimal64(2), 1 as NodeId, ['d'], 'd', 'grouped').plus(columnExpr(col.Decimal64(2), 1 as NodeId, ['e'], 'e', 'grouped')), "toDecimal64('1.25', 2) + toDecimal64('2.50', 2)"],
        [sum(ref(col.Decimal(38, 2), 'grouped')), "sum(CAST('1.25' AS Decimal(38, 2)))"],
        [sum(ref(col.Decimal(39, 2), 'grouped')), "sum(CAST('1.25' AS Decimal(39, 2)))"],
        [sumIf(ref(col.Decimal(75, 2), 'grouped'), val(true)), "sumIf(CAST('1.25' AS Decimal(75, 2)), true)"],
        [sum(ref(col.Decimal(76, 2), 'grouped')), "sum(CAST('1.25' AS Decimal(76, 2)))"],
        [sum(ref(col.Float64, 'grouped')).plus(1), 'sum(toFloat64(1.5)) + toFloat64(1)'],
        [max(ref(col.UInt32, 'grouped')).plus(1), 'max(toUInt32(4294967295)) + toUInt32(1)'],
        [sum(ref(col.Float64, 'grouped').ifNull(null)), 'sum(ifNull(toFloat64(1.5), NULL))'],
        [ref(col.Float64, 'grouped').plus(1), 'toFloat64(1.5) + toFloat64(1)'],
        [ref(col.UInt8, 'grouped').plus(1), 'toUInt8(255) + toUInt8(1)'],
        [ref(col.UInt32, 'grouped').plus(1), 'toUInt32(4294967295) + toUInt32(1)'],
        [sum(ref(col.Float64, 'grouped').multiply(2)), 'sum(toFloat64(1.5) * toFloat64(2))'],
        [ref(col.Float64, 'grouped').ifNull(null), 'ifNull(toFloat64(1.5), NULL)'],
        [sum(ref(col.Decimal64(2), 'grouped')), 'sum(toDecimal64(1.5, 2))'],
        [sum(ref(col.Float64, 'grouped')), 'sum(toFloat64(1.5))'],
        [sum(ref(col.UInt32, 'grouped')), 'sum(toUInt32(4294967295))'],
        [sum(ref(col.Nullable(col.Float64), 'grouped')), 'sum(CAST(NULL AS Nullable(Float64)))'],
        [sumIf(val(7n).as(col.UInt64), val(true)), 'sumIf(toUInt64(7), true)'],
        [maxIf(val(7n).as(col.UInt64), val(false)), 'maxIf(toUInt64(7), false)'],
        [sumState(val(7n).as(col.UInt64)), 'sumState(toUInt64(7))'],
        [ref(col.Nullable(col.UInt8), 'row').ifNull(val(300, col.UInt32)), 'ifNull(CAST(NULL AS Nullable(UInt8)), toUInt32(300))'],
        [ref(col.Nullable(col.UInt32), 'row').ifNull(val(1.5, col.Float64)), 'ifNull(CAST(NULL AS Nullable(UInt32)), toFloat64(1.5))'],
        [max(ref(col.LowCardinality(col.String), 'grouped')), "max(toLowCardinality('abc'))"],
        [ref(col.LowCardinality(col.String), 'row').ifNull('fallback'), "ifNull(toLowCardinality('abc'), 'fallback')"],
        [ref(col.Nullable(col.Float32), 'row').ifNull(val(1, col.UInt16)), 'ifNull(CAST(NULL AS Nullable(Float32)), toUInt16(1))'],
        [ref(col.Nullable(col.Int32), 'row').ifNull(val(1, col.UInt32)), 'ifNull(CAST(NULL AS Nullable(Int32)), toUInt32(1))'],
      ] as const;
      for (const [expression, sql] of cases) {
        const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: `SELECT toTypeName(${sql}) AS type FORMAT JSONEachRow` });
        const text = await response.text();
        expect(response.ok, text).toBe(true);
        const actual = parseCHType((JSON.parse(text) as { type: string }).type);
        expect.soft(expression.ir.type, sql).toEqual(actual);
      }
      const decimalCases = [
        [columnExpr(col.Decimal(10, 1), 1 as NodeId, ['d'], 'd', 'row').minus(columnExpr(col.Decimal(19, 3), 1 as NodeId, ['e'], 'e', 'row')), "CAST('1.2' AS Decimal(10,1)) - CAST('2.345' AS Decimal(19,3))", '-1.145'],
        [columnExpr(col.Decimal(38, 2), 1 as NodeId, ['d'], 'd', 'row').multiply(columnExpr(col.Decimal(39, 3), 1 as NodeId, ['e'], 'e', 'row')), "CAST('1.25' AS Decimal(38,2)) * CAST('2.500' AS Decimal(39,3))", '3.125'],
        [columnExpr(col.Decimal64(3), 1 as NodeId, ['d'], 'd', 'row').divide(columnExpr(col.Decimal32(2), 1 as NodeId, ['e'], 'e', 'row')), "toDecimal64('1.000',3) / toDecimal32('3.00',2)", '0.333'],
      ] as const;
      for (const [expression, sql, value] of decimalCases) {
        const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: `SELECT toTypeName(${sql}) AS type, toString(${sql}) AS value FORMAT JSONEachRow` });
        const text = await response.text();
        expect(response.ok, text).toBe(true);
        const actual = JSON.parse(text) as { type: string; value: string };
        expect.soft(expression.ir.type, sql).toEqual(parseCHType(actual.type));
        expect.soft(actual.value, sql).toBe(value);
      }
      const overflow = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: "SELECT toDecimal32('0.00001', 5) * toDecimal32('0.00001', 5)" });
      expect(overflow.ok).toBe(false);
      expect(await overflow.text()).toMatch(/Scale.*out of bounds/i);
      const mergeCases = [
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Map(col.Decimal64(2), col.Nullable(col.String))), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(map(toDecimal64('1.25', 2), CAST(NULL AS Nullable(String))))", '{1.25:NULL}'],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Map(col.DateTime64(9), col.UInt64)), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(map(toDateTime64('2026-10-27 12:34:56.123456789', 9), toUInt64(18446744073709551615)))", "{'2026-10-27 12:34:56.123456789':18446744073709551615}"],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Tuple({ labels: col.Map(col.String, col.UInt64) })), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(CAST(tuple(map('__proto__', toUInt64(18446744073709551615))) AS Tuple(labels Map(String, UInt64))))", "({'__proto__':18446744073709551615})"],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Tuple([col.Map(col.UInt64, col.Nullable(col.String))])), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(tuple(map(toUInt64(18446744073709551615), CAST(NULL AS Nullable(String)))))", "({18446744073709551615:NULL})"],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Array(col.FixedString(3))), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState([toFixedString('abc', 3)])", "['abc']"],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Array(col.Enum8({ a: 1, b: 2 }))), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState([CAST('b' AS Enum8('a' = 1, 'b' = 2))])", "['b']"],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Array(col.Tuple({ id: col.UInt64, at: col.DateTime64(3) }))), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(CAST([(toUInt64(18446744073709551615), toDateTime64('2026-10-27 12:34:56.123', 3))] AS Array(Tuple(id UInt64, at DateTime64(3)))))", "[(18446744073709551615,'2026-10-27 12:34:56.123')]"],
        [sumMerge(columnExpr(col.AggregateFunction('sum', col.Decimal(39, 2)), 1 as NodeId, ['s'], 's', 'grouped')), "sumMerge(s)", "sumState(CAST('1.25' AS Decimal(39, 2)))", '1.25'],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.DateTime64(3, 'UTC')), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', "maxState(toDateTime64('2026-10-27 12:34:56.123', 3, 'UTC'))", '2026-10-27 12:34:56.123'],
        [maxMerge(columnExpr(col.AggregateFunction('max', col.Array(col.UInt64)), 1 as NodeId, ['s'], 's', 'grouped')), 'maxMerge(s)', 'maxState([toUInt64(18446744073709551615)])', ['18446744073709551615']],
      ] as const;
      for (const [expression, sql, stateSql, expectedValue] of mergeCases) {
        const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: `SELECT toTypeName(${sql}) AS type, toString(${sql}) AS value FROM (SELECT ${stateSql} AS s) FORMAT JSONEachRow` });
        const text = await response.text();
        expect(response.ok, text).toBe(true);
        const actual = JSON.parse(text) as { type: string; value: string };
        expect.soft(expression.ir.type, stateSql).toEqual(parseCHType(actual.type));
        expect.soft(actual.value, stateSql).toBe(Array.isArray(expectedValue) ? `[${expectedValue.join(',')}]` : expectedValue);
      }
      const merged = sumMerge(columnExpr(col.AggregateFunction('sum', col.Float64), 1 as NodeId, ['state'], 'state', 'grouped'));
      const response = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: 'SELECT toTypeName(sumMerge(s)) AS type FROM (SELECT sumState(toFloat64(1.5)) AS s) FORMAT JSONEachRow' });
      const text = await response.text();
      expect(response.ok, text).toBe(true);
      expect(merged.ir.type).toEqual(parseCHType((JSON.parse(text) as { type: string }).type));
      const dateMerged = maxMerge(columnExpr(col.AggregateFunction('max', col.Date), 1 as NodeId, ['state'], 'state', 'grouped'));
      const dateResponse = await fetch(`http://${container.getHost()}:${container.getMappedPort(8123)}`, { method: 'POST', body: "SELECT toTypeName(maxMerge(s)) AS type FROM (SELECT maxState(toDate('2026-10-27')) AS s) FORMAT JSONEachRow" });
      const dateText = await dateResponse.text();
      expect(dateResponse.ok, dateText).toBe(true);
      expect(dateMerged.ir.type).toEqual(parseCHType((JSON.parse(dateText) as { type: string }).type));
    } finally { await container.stop(); }
  });
});
