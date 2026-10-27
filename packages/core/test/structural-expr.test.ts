import { describe, expect, it } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { arrayOf, byteString, col, columnExpr, defineFunction, methodCatalog, parseCHType, stringOrArray, tupleLike, val, type Column, type NodeId } from '../src/index.js';
import { resolveReturn } from '../src/catalog/define.js';
const column = <C extends Column>(c: C) => columnExpr(c, 1 as NodeId, ['a.b'], 'a.b', 'grouped');
describe('structural expressions', () => {
  it('keeps exact children, hostile selectors, names, modes and distinct immutable Params', () => {
    const tuple = col.NamedTuple([['42', col.UInt64], ['a.b', col.Nullable(col.String)], ['__proto__', col.DateTime64(9)]]);
    const source = column(col.Array(tuple));
    expect(source.element('a.b').ir.type).toEqual(col.Array(col.Nullable(col.String)).type);
    expect(source.arrayElement(1).element('__proto__')).toMatchObject({ name: 'a.b', mode: 'grouped', ir: { type: col.DateTime64(9).type } });
    const first = source.arrayElement(1), second = source.arrayElement(1);
    if (first.ir.kind !== 'Call' || second.ir.kind !== 'Call') throw new Error('Call expected');
    expect(first.ir.args[0]).toBe(source.ir);
    expect(first.ir.args[1]).toMatchObject({ kind: 'Param', value: 1, type: null });
    expect(first.ir.args[1]).not.toBe(second.ir.args[1]);
    expect(first.ir.fn.argumentPolicies).toEqual(['sibling', 'numericIndex']);
    expect(Object.isFrozen(first.ir.fn.argumentPolicies)).toBe(true);
    const selected = source.element('a.b');
    if (selected.ir.kind !== 'Call') throw new Error('Call expected');
    expect(selected.ir.args[1]).toMatchObject({ kind: 'Param', value: 'a.b', type: null });
    expect(selected.ir.fn.sqlName).toBe('tupleElement');
    expect(Object.isFrozen(selected.ir.type)).toBe(true);
  });
  it('resolves argument-specific evidence without retyping or merging Params', () => {
    const captured: unknown[] = [];
    const policies = ['sibling', 'arrayElement', 'array', 'numericIndex', 'constantSelector'] as const;
    const fn = defineFunction({ name: 'probe', args: [], argumentPolicies: policies, deterministic: true, tsReturns: 'probe', returns: (types, values) => { captured.push(types, values); return col.Bool.type; } });
    const input = column(col.Array(col.Nullable(col.UInt64)));
    resolveReturn(fn.definition, [input, null, [], -1, 'a.b']);
    expect(captured[0]).toEqual([input.ir.type, col.Nullable(col.UInt64).type, input.ir.type, col.Int64.type, col.String.type]);
    expect(captured[1]).toEqual([undefined, null, [], -1, 'a.b']);
    expect(Object.isFrozen(fn.definition.argumentPolicies)).toBe(true);
    expect(column(col.Array(col.Nullable(col.UInt64))).has(null).ir.type).toEqual(col.Bool.type);
    expect(column(col.Array(col.UInt64)).hasAny([]).ir.type).toEqual(col.Bool.type);
    expect(column(col.Nullable(col.String)).startsWith(val('a')).ir.type).toEqual(col.Nullable(col.Bool).type);
  });
  it('owns argument policies independently of caller mutation and preserves selector Param identities', () => {
    const policies: ('sibling' | 'constantSelector')[] = ['sibling', 'constantSelector'];
    const fn = defineFunction({ name: 'policyOwnership', args: [], argumentPolicies: policies, deterministic: true, returns: col.Bool });
    policies[1] = 'sibling';
    expect(fn.definition.argumentPolicies).toEqual(['sibling', 'constantSelector']);
    const tuple = column(col.Tuple({ ['__proto__']: col.Nullable(col.String) }));
    const a = tuple.element('__proto__'), b = tuple.element('__proto__');
    if (a.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('Call expected');
    expect(a.ir.args[0]).toBe(b.ir.args[0]);
    expect(a.ir.args[1]).not.toBe(b.ir.args[1]);
    expect(a.ir.args[1]).toMatchObject({ kind: 'Param', value: '__proto__', type: null });
    expect(a.ir.fn.argumentPolicies).toEqual(['sibling', 'constantSelector']);
  });
  it('matches structural descriptors rather than decoded string/object shapes', () => {
    expect(arrayOf(col.UInt64).match(col.Array(col.UInt64).type)).toBe(true);
    expect(arrayOf(col.UInt64).match(col.Array(col.Int64).type)).toBe(false);
    expect(arrayOf(col.UInt64).match({ kind: 'Array', inner: { name: 'UInt64', kind: 'scalar' } })).toBe(true);
    expect(arrayOf(col.Nullable(col.UInt64)).match(col.Array(col.Nullable(col.UInt64)).type)).toBe(true);
    expect(arrayOf(col.UInt64).match(col.Array(col.Nullable(col.UInt64)).type)).toBe(false);
    for (const c of [col.Decimal64(2), col.DateTime64(9), col.UUID, col.IPv4, col.IPv6, col.Enum8({ a: 1 })]) expect(stringOrArray.match(c.type)).toBe(false);
    expect(byteString.match(col.LowCardinality(col.Nullable(col.String)).type)).toBe(true);
    expect(stringOrArray.match(col.FixedString(3).type)).toBe(true);
    expect(methodCatalog.filter(d => d.name === 'length')).toHaveLength(1);
    // The generated surface and resolver support recursive arrays; catalog validation must agree.
    expect(tupleLike.match(col.Array(col.Array(col.Tuple({ n: col.UInt64 }))).type)).toBe(true);
    expect(tupleLike.match(col.Array(col.Array(col.String)).type)).toBe(false);
    const deep = col.Array(col.Array(col.Array(col.Tuple({ n: col.Nullable(col.UInt64) }))));
    expect(tupleLike.match(deep.type)).toBe(true);
    expect(column(deep).element('n').ir.type).toEqual(col.Array(col.Array(col.Array(col.Nullable(col.UInt64)))).type);
    // Matcher wrappers are transparent at every level, not just at the root.
    // These synthetic descriptors test unwrap behavior, not server-valid schema shapes.
    expect(tupleLike.match(col.LowCardinality(col.Nullable(col.Array(col.Nullable(col.Array(col.LowCardinality(col.Tuple({ n: col.UInt64 }))))))).type)).toBe(true);
    expect(tupleLike.match(col.Nullable(col.Array(col.LowCardinality(col.Array(col.Nullable(col.String))))).type)).toBe(false);
    expect(tupleLike.match(col.Array(col.Array(col.Array(col.Map(col.String, col.UInt64)))).type)).toBe(false);
  });
  it('composes recursive extraction when the selected child is itself an array of named tuples', () => {
    const child = col.Array(col.Tuple({ ['a.b']: col.Nullable(col.UInt64) }));
    const source = column(col.Array(col.Array(col.Tuple({ child }))));
    const extracted = source.element('child').element('a.b');
    expect(extracted.ir.type).toEqual(col.Array(col.Array(col.Array(col.Nullable(col.UInt64)))).type);
    expect(extracted.name).toBe('a.b');
    expect(extracted.mode).toBe('grouped');
    expect(tupleLike.match(source.element('child').ir.type)).toBe(true);
    expect(tupleLike.match(extracted.ir.type)).toBe(false);
    expect(extracted.arrayElement(-1).arrayElement(1).arrayElement(99).ir.type).toEqual(col.Nullable(col.UInt64).type);
  });
  it('compares real ClickHouse 24.8 structural values and types, including bounds and selectors', async () => {
    const container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
    try {
      const url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
      const cases = [
        [column(col.Array(col.Array(col.Tuple({ child: col.Array(col.Tuple({ ['a.b']: col.Nullable(col.UInt64) })) })))).element('child').element('a.b'), "tupleElement(tupleElement(CAST([[tuple([tuple(7), tuple(NULL)])], [tuple([])]] AS Array(Array(Tuple(child Array(Tuple(`a.b` Nullable(UInt64))))))), 'child'), 'a.b')", [[['7', null]], [[]]]],
        [column(col.String).length(), "length('é😀')", '6'],
        [column(col.FixedString(4)).length(), "length(toFixedString('a', 4))", '4'],
        [column(col.String).startsWith(column(col.FixedString(2))), "startsWith('abcd', toFixedString('ab', 2))", 1],
        [column(col.Array(col.Tuple({ p: col.Nullable(col.String), n: col.UInt64 }))).arrayElement(99).element('p'), "tupleElement(arrayElement(CAST([] AS Array(Tuple(p Nullable(String), n UInt64))), 99), 'p')", null],
        [column(col.Array(col.Tuple({ p: col.Nullable(col.String), n: col.UInt64 }))).arrayElement(99).element('n'), "tupleElement(arrayElement(CAST([] AS Array(Tuple(p Nullable(String), n UInt64))), 99), 'n')", '0'],
        [column(col.Array(col.Array(col.Array(col.Tuple({ n: col.Nullable(col.UInt64) }))))).element('n'), "tupleElement(CAST([[[tuple(7), tuple(NULL)]]] AS Array(Array(Array(Tuple(n Nullable(UInt64)))))), 'n')", [[['7', null]]]],
        [column(col.String).startsWith(null), "startsWith('abc', CAST(NULL AS Nullable(String)))", null],
        [column(col.Array(col.Array(col.Tuple({ n: col.UInt64 })))).element('n').arrayElement(-1).arrayElement(1), "arrayElement(arrayElement(tupleElement(CAST([[tuple(7)], [tuple(8)]] AS Array(Array(Tuple(n UInt64)))), 'n'), -1), 1)", '8'],
        [column(col.Array(col.LowCardinality(col.Nullable(col.String)))).arrayElement(-1).startsWith('x'), "startsWith(arrayElement(CAST(['xyz', NULL] AS Array(LowCardinality(Nullable(String)))), -1), 'x')", null],
        [column(col.Nullable(col.String)).length(), "length(CAST(NULL AS Nullable(String)))", null],
        [column(col.Array(col.UInt64)).length(), 'length(CAST([] AS Array(UInt64)))', '0'],
        [column(col.FixedString(3)).empty(), "empty(toFixedString('abc',3))", 0],
        [column(col.Array(col.String)).notEmpty(), "notEmpty(['a'])", 1],
        [column(col.Nullable(col.String)).startsWith('a'), "startsWith(CAST(NULL AS Nullable(String)), 'a')", null],
        [column(col.Array(col.Nullable(col.UInt64))).has(null), 'has([toNullable(toUInt64(1)), NULL], NULL)', 1],
        [column(col.Array(col.UInt64)).hasAny([]), 'hasAny([toUInt64(1)], CAST([] AS Array(UInt64)))', 0],
        [column(col.Array(col.Tuple({ mpn: col.Nullable(col.String) }))).element('mpn'), "tupleElement(CAST([tuple('x'), tuple(NULL)] AS Array(Tuple(mpn Nullable(String)))), 'mpn')", ['x', null]],
        [column(col.Tuple({ 'a.b': col.String, ['__proto__']: col.UInt64 })).element('a.b'), "tupleElement(CAST(tuple('safe', 7) AS Tuple(`a.b` String, `__proto__` UInt64)), {field:String})", 'safe'],
        [column(col.NamedTuple([['42', col.UInt64], ['__proto__', col.String]])).element('__proto__'), "tupleElement(CAST(tuple(7,'safe') AS Tuple(`42` UInt64, `__proto__` String)), '__proto__')", 'safe'],
        [column(col.NamedTuple([['42', col.UInt64], ['0', col.String]])).element('42'), "tupleElement(CAST(tuple(7,'safe') AS Tuple(`42` UInt64, `0` String)), '42')", '7'],
        [column(col.Array(col.Tuple({ description: col.Nullable(col.String) }))).arrayElement(1).element('description'), "tupleElement(arrayElement(CAST([tuple(NULL)] AS Array(Tuple(description Nullable(String)))), 1), 'description')", null],
        [column(col.Array(col.Decimal64(2))).arrayElement(-1), 'arrayElement([toDecimal64(1.25,2)], -1)', 1.25],
        [column(col.Array(col.Map(col.String, col.UInt64))).arrayElement(9), "arrayElement([map('a',toUInt64(1))],9)", {}],
        ...[1, -1, 9, -9, 0].map(index => [column(col.Array(col.UInt64)).arrayElement(index), `arrayElement([toUInt64(7), toUInt64(8)], ${index})`, index === 1 ? '7' : index === -1 ? '8' : '0'] as const),
        [column(col.Array(col.Nullable(col.String))).arrayElement(9), "arrayElement(CAST(['x'] AS Array(Nullable(String))), 9)", null],
      ] as const;
      for (const [expression, sql, expected] of cases) {
        const response = await fetch(`${url}?param_field=a.b`, { method: 'POST', body: `SELECT toTypeName(${sql}) AS type, ${sql} AS value FORMAT JSONEachRow` });
        const text = await response.text();
        expect(response.ok, text).toBe(true);
        const row = JSON.parse(text) as { type: string; value: unknown };
        // ClickHouse predicates report UInt8; the catalog's Bool is its boolean decoding declaration.
        const actual = parseCHType(row.type);
        const expectedType = expression.ir.type;
        const bool = expectedType?.kind === 'scalar' && expectedType.name === 'Bool';
        const nullableBool = expectedType?.kind === 'Nullable' && expectedType.inner.kind === 'scalar' && expectedType.inner.name === 'Bool';
        expect(actual).toEqual(bool ? col.UInt8.type : nullableBool ? col.Nullable(col.UInt8).type : expectedType);
        expect(row.value).toEqual(expected);
      }
      // The prefix descriptor is just as important as the receiver: decoded string is not SQL String.
      for (const prefix of ["CAST('a' AS Enum8('a'=1))", 'toDecimal64(1,2)', 'toDateTime64(0,9)']) {
        const response = await fetch(url, { method: 'POST', body: `SELECT startsWith('abc', ${prefix})` });
        expect(response.ok, prefix).toBe(false);
        expect(await response.text()).toContain('(ILLEGAL_TYPE_OF_ARGUMENT)');
      }
      // LowCardinality is wire-transparent; predicate catalog types intentionally declare Bool.
      // Assert the native wrapper explicitly rather than relaxing the existing exact-type loop.
      const wrappedPrefix = await fetch(url, { method: 'POST', body: "SELECT toTypeName(startsWith(toFixedString('abc', 3), CAST(NULL AS LowCardinality(Nullable(String))))) AS type, startsWith(toFixedString('abc', 3), CAST(NULL AS LowCardinality(Nullable(String)))) AS value FORMAT JSONEachRow" });
      const wrappedText = await wrappedPrefix.text();
      expect(wrappedPrefix.ok, wrappedText).toBe(true);
      expect(JSON.parse(wrappedText)).toEqual({ type: 'LowCardinality(Nullable(UInt8))', value: null });
      expect(column(col.FixedString(3)).startsWith(column(col.LowCardinality(col.Nullable(col.String)))).ir.type).toEqual(col.Nullable(col.Bool).type);
      const parameterIndex = await fetch(`${url}?param_index=-1`, { method: 'POST', body: 'SELECT arrayElement([number, number + 1], {index:Int64}) AS value FROM numbers(2) FORMAT JSONEachRow' });
      const parameterText = await parameterIndex.text();
      expect(parameterIndex.ok, parameterText).toBe(true);
      expect(parameterText.trim().split('\n').map(line => JSON.parse(line))).toEqual([{ value: '1' }, { value: '2' }]);
      const hostileName = "x' OR 1=1 --";
      const hostileExpr = column(col.Tuple({ ["x' OR 1=1 --"]: col.String })).element(hostileName);
      const hostileResponse = await fetch(`${url}?param_field=${encodeURIComponent(hostileName)}`, { method: 'POST', body: "SELECT tupleElement(CAST(tuple('safe') AS Tuple(`x' OR 1=1 --` String)), {field:String}) AS value FORMAT JSONEachRow" });
      const hostileText = await hostileResponse.text();
      expect(hostileResponse.ok, hostileText).toBe(true);
      expect(JSON.parse(hostileText)).toEqual({ value: 'safe' });
      expect(hostileExpr.ir.type).toEqual(col.String.type);
      const zero = await fetch(url, { method: 'POST', body: 'SELECT arrayElement([number], 0) FROM numbers(1)' });
      expect(zero.ok).toBe(false); expect(await zero.text()).toContain('Array indices are 1-based');
      for (const receiver of ["CAST('a' AS Enum8('a'=1))", "toUUID('00000000-0000-0000-0000-000000000000')", "toIPv4('127.0.0.1')", "toIPv6('::1')", 'toDecimal64(1,2)', 'toDateTime64(0,9)']) {
        const response = await fetch(url, { method: 'POST', body: `SELECT length(${receiver})` });
        expect(response.ok, receiver).toBe(false); expect(await response.text()).toContain('(ILLEGAL_TYPE_OF_ARGUMENT)');
      }
    } finally { await container.stop(); }
  });
});
