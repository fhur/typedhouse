import { expect, it } from 'vitest';
import { col, count, crossJoin, from, fullJoin, join, joinOutput, leftJoin, max, outerColumnType, print, parseCHType, relNode, rightJoin, table, val, type CHType, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { rowDecoder } from '../../client/src/decode.js';
const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };
const a = from(table('ta', { id: col.UInt32, k: col.Nullable(col.UInt32), s: col.String }, meta));
const b = from(table('tb', { id: col.UInt32, s: col.String, lc: col.LowCardinality(col.String), tags: col.Array(col.String) }, meta));
const c = from(table('tc', { id: col.UInt32, n: col.Float64 }, meta));
const kinds = (rel: Rel) => {
  if (rel.output.shape !== 'nested') throw new Error('nested');
  return Object.fromEntries(rel.output.inputs.map(([alias, o]) => [alias, o.shape === 'flat' ? Object.fromEntries(o.order.map(k => [k, print(o.columns[k]!)])) : 'nested']));
};
const NOTE = ' SETTINGS join_use_nulls = 1 /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */';
const NAIVE_Q = "SELECT `__typedhouse_input`.`__typedhouse_leaf_0` AS `id`, `__typedhouse_input`.`__typedhouse_leaf_4` AS `s`, `__typedhouse_input`.`__typedhouse_leaf_6` AS `tags` FROM (SELECT `a`.`id` AS `__typedhouse_leaf_0`, `a`.`k` AS `__typedhouse_leaf_1`, `a`.`s` AS `__typedhouse_leaf_2`, `b`.`id` AS `__typedhouse_leaf_3`, `b`.`s` AS `__typedhouse_leaf_4`, `b`.`lc` AS `__typedhouse_leaf_5`, `b`.`tags` AS `__typedhouse_leaf_6` FROM (SELECT `id`, `k`, `s` FROM `ta`) AS `a` LEFT ALL JOIN (SELECT `id`, `s`, `lc`, `tags` FROM `tb`) AS `b` ON (`a`.`id` = `b`.`id`) AND (`a`.`s` = `b`.`s`)) AS `__typedhouse_input`" + NOTE;
const PLANNED_R3 = "SELECT `c`.`n` AS `n`, `ab`.`__typedhouse_leaf_2` AS `s`\nFROM (SELECT `a`.`s` AS `__typedhouse_leaf_2`, `b`.`id` AS `__typedhouse_leaf_3` FROM (SELECT `id`, `s` FROM `ta`) AS `a` LEFT ALL JOIN (SELECT `id` FROM `tb`) AS `b` ON `a`.`id` = `b`.`id`) AS `ab`\nRIGHT ALL JOIN `tc` AS `c` ON `ab`.`__typedhouse_leaf_3` = `c`.`id`" + NOTE;

it('wraps descriptors faithfully and idempotently: scalars, LowCardinality, SimpleAggregateFunction; never Nullable/Array/Map/Tuple/Variant/JSON/AggregateFunction', () => {
  const t = (s: string): CHType => JSON.parse(s) as CHType;
  const cases: [CHType, string][] = [
    [{ kind: 'scalar', name: 'UInt8' }, 'Nullable(UInt8)'], [{ kind: 'scalar', name: 'String' }, 'Nullable(String)'], [{ kind: 'FixedString', n: 4 }, 'Nullable(FixedString(4))'],
    [{ kind: 'DateTime64', precision: 9, tz: 'UTC' }, "Nullable(DateTime64(9, 'UTC'))"], [{ kind: 'Decimal', precision: 9, scale: 2 }, 'Nullable(Decimal(9, 2))'],
    [{ kind: 'Enum', bits: 8, values: [{ name: 'x', value: 1 }] }, "Nullable(Enum8('x' = 1))"], [{ kind: 'scalar', name: 'UUID' }, 'Nullable(UUID)'], [{ kind: 'scalar', name: 'IPv4' }, 'Nullable(IPv4)'],
    [{ kind: 'LowCardinality', inner: { kind: 'scalar', name: 'String' } }, 'LowCardinality(Nullable(String))'],
    [{ kind: 'LowCardinality', inner: { kind: 'Nullable', inner: { kind: 'scalar', name: 'String' } } }, 'LowCardinality(Nullable(String))'],
    [{ kind: 'SimpleAggregateFunction', fn: 'sum', inner: { kind: 'scalar', name: 'UInt64' } }, 'Nullable(SimpleAggregateFunction(sum, UInt64))'],
    [{ kind: 'SimpleAggregateFunction', fn: 'any', inner: { kind: 'Nullable', inner: { kind: 'scalar', name: 'String' } } }, 'SimpleAggregateFunction(any, Nullable(String))'],
    [{ kind: 'Nullable', inner: { kind: 'scalar', name: 'Float64' } }, 'Nullable(Float64)'], [{ kind: 'Array', inner: { kind: 'scalar', name: 'String' } }, 'Array(String)'],
    [{ kind: 'Map', key: { kind: 'scalar', name: 'String' }, value: { kind: 'scalar', name: 'UInt64' } }, 'Map(String, UInt64)'], [{ kind: 'Tuple', items: [{ name: 'a', type: { kind: 'scalar', name: 'UInt8' } }] }, 'Tuple(a UInt8)'],
    [{ kind: 'Variant', items: [{ kind: 'scalar', name: 'String' }] }, 'Variant(String)'], [{ kind: 'Dynamic' }, 'Dynamic'], [{ kind: 'scalar', name: 'JSON' }, 'JSON'],
    [{ kind: 'AggregateFunction', fn: 'sum', args: [{ kind: 'scalar', name: 'UInt64' }] }, 'AggregateFunction(sum, UInt64)'], [{ kind: 'Unknown', raw: "Object('json')" }, "Object('json')"],
  ];
  // Fix round 1: SimpleAggregateFunction over LowCardinality(T) loses its wrapper on 24.8; plus the Tester's extra kinds.
  for (const [text, expected] of [
    ['SimpleAggregateFunction(max, LowCardinality(String))', 'LowCardinality(Nullable(String))'], ['SimpleAggregateFunction(max, LowCardinality(UInt32))', 'LowCardinality(Nullable(UInt32))'],
    ['SimpleAggregateFunction(max, LowCardinality(FixedString(2)))', 'LowCardinality(Nullable(FixedString(2)))'], ['SimpleAggregateFunction(max, LowCardinality(Nullable(String)))', 'SimpleAggregateFunction(max, LowCardinality(Nullable(String)))'],
    ['SimpleAggregateFunction(anyLast, Nullable(UInt64))', 'SimpleAggregateFunction(anyLast, Nullable(UInt64))'], ["SimpleAggregateFunction(anyLast, DateTime64(3, 'UTC'))", "Nullable(SimpleAggregateFunction(anyLast, DateTime64(3, 'UTC')))"],
    ["SimpleAggregateFunction(max, Enum8('a' = 1))", "Nullable(SimpleAggregateFunction(max, Enum8('a' = 1)))"], ['SimpleAggregateFunction(anyLast, UUID)', 'Nullable(SimpleAggregateFunction(anyLast, UUID))'],
    ['SimpleAggregateFunction(anyLast, Map(String, UInt64))', 'SimpleAggregateFunction(anyLast, Map(String, UInt64))'], ['SimpleAggregateFunction(groupArrayArray, Array(UInt8))', 'SimpleAggregateFunction(groupArrayArray, Array(UInt8))'],
    ...["DateTime('UTC')", 'UUID', 'IPv4', 'Bool', 'Float32', 'Date32', 'Int128', 'FixedString(3)'].map(t => [`LowCardinality(${t})`, `LowCardinality(Nullable(${t}))`]),
    ['Decimal(76, 20)', 'Nullable(Decimal(76, 20))'], ['IPv6', 'Nullable(IPv6)'], ['Map(String, Nullable(UInt64))', 'Map(String, Nullable(UInt64))'], ['Tuple(a Nullable(String))', 'Tuple(a Nullable(String))'],
    ['Array(Nullable(String))', 'Array(Nullable(String))'], ['Point', 'Point'], ['Ring', 'Ring'], ['Polygon', 'Polygon'], ['Array(Tuple(a Nullable(UInt8)))', 'Array(Tuple(a Nullable(UInt8)))'],
  ] as const) cases.push([parseCHType(text), expected]);
  for (const [type, expected] of cases) {
    expect(print(outerColumnType(type)), print(type)).toBe(expected);
    expect(print(outerColumnType(outerColumnType(type)))).toBe(expected);
    if (print(type) === expected) expect(outerColumnType(type)).toBe(type);
  }
  expect(t('{"kind":"scalar","name":"Bool"}')).toEqual({ kind: 'scalar', name: 'Bool' });
});

it('null-extends exactly the outer inputs per kind, keeps the input schemas shared and inner/cross outputs unchanged', () => {
  const left = leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id));
  const right = rightJoin({ a }, { c }).on(r => r.a.id.eq(r.c.id));
  const full = fullJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id));
  const A = { id: 'UInt32', k: 'Nullable(UInt32)', s: 'String' }, NA = { id: 'Nullable(UInt32)', k: 'Nullable(UInt32)', s: 'Nullable(String)' };
  const NB = { id: 'Nullable(UInt32)', s: 'Nullable(String)', lc: 'LowCardinality(Nullable(String))', tags: 'Array(String)' };
  expect(kinds(left.ir)).toEqual({ a: A, b: NB });
  expect(kinds(right.ir)).toEqual({ a: NA, c: { id: 'UInt32', n: 'Float64' } });
  expect(kinds(full.ir)).toEqual({ a: NA, b: NB });
  // Composition: a left join whose right input is a left join (idempotent wrap), and one whose left input is an inner join.
  const composed = leftJoin({ a }, { bc: leftJoin({ b }, { c }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.b.id));
  if (composed.ir.kind !== 'Join' || composed.ir.output.shape !== 'nested') throw new Error('join');
  const bc = composed.ir.output.inputs[1]![1];
  expect(bc.shape === 'nested' && bc.inputs.map(([alias, o]) => [alias, o.shape === 'flat' && Object.values(o.columns).map(print)])).toEqual([['b', ['Nullable(UInt32)', 'Nullable(String)', 'LowCardinality(Nullable(String))', 'Array(String)']], ['c', ['Nullable(UInt32)', 'Nullable(Float64)']]]);
  const innerLeft = leftJoin({ ab: join({ a, b }).on(r => r.a.id.eq(r.b.id)) }, { c }).on(r => r.ab.b.id.eq(r.c.id));
  expect(kinds(innerLeft.ir)).toEqual({ ab: 'nested', c: { id: 'Nullable(UInt32)', n: 'Nullable(Float64)' } });
  if (left.ir.kind !== 'Join' || left.ir.output.shape !== 'nested') throw new Error('join');
  expect(left.ir.joinKind).toBe('left');
  expect(left.ir.inputs.map(([alias, rel]) => [alias, rel])).toEqual([['a', a.ir], ['b', b.ir]]);
  expect(left.ir.inputs[0]![1]).toBe(a.ir);
  expect(left.ir.output).toEqual(joinOutput('left', left.ir.inputs));
  // The preserved schema is the input's own object; inner and cross joins never copy one.
  expect(left.ir.output.inputs[0]![1]).toEqual(a.ir.output);
  const inner = join({ a, b }).on(r => r.a.id.eq(r.b.id));
  if (inner.ir.kind !== 'Join') throw new Error('join');
  expect(inner.ir.output).toEqual({ shape: 'nested', inputs: [['a', a.ir.output], ['b', b.ir.output]] });
  expect(joinOutput('cross', [['a', a.ir], ['b', b.ir]]).inputs[1]![1]).toBe(b.ir.output);
  // ON column references and the row proxy carry the wrapped descriptors.
  const on = left.ir.on[0]!;
  expect(on.kind === 'Call' && on.args.map(x => print(x.type!))).toEqual(['UInt32', 'Nullable(UInt32)']);
  expect(print(left.row.b.lc.ir.type!)).toBe('LowCardinality(Nullable(String))');
  // Nested joins wrap every leaf of a null-extended nested side, fields included.
  const nested = leftJoin({ x: a }, { y: crossJoin({ p: b, q: c }).arrayJoin(r => r.p.tags, 'tag') }).on(r => r.x.s.eq(r.y.tag));
  if (nested.ir.kind !== 'Join' || nested.ir.output.shape !== 'nested') throw new Error('join');
  const y = nested.ir.output.inputs[1]![1];
  expect(y.shape === 'nested' && y.fields && print(y.fields.columns.tag!)).toBe('Nullable(String)');
  expect(y.shape === 'nested' && y.inputs[1]![1].shape === 'flat' && print(y.inputs[1]![1].columns.n!)).toBe('Nullable(Float64)');
});

it('rejects non-equality outer conditions, bad preserved records and duplicate aliases at build time', () => {
  expect(() => leftJoin({ a }, { b }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.id)])).toThrow('join_condition_not_equi');
  expect(() => rightJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id).or(r.a.s.eq(r.b.s)))).toThrow('join_condition_not_equi');
  expect(() => fullJoin({ a }, { b }).on(r => r.a.s.startsWith('x'))).toThrow('join_condition_not_equi');
  // The same predicates are an inner join plus a residual Filter.
  expect(join({ a, b }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.id)]).ir.kind).toBe('Filter');
  for (const outer of [leftJoin, rightJoin, fullJoin] as any[]) {
    expect(() => outer({ a, c }, { b })).toThrow('outer_join_arity');
    expect(() => outer({ a }, {})).toThrow('outer_join_arity');
    expect(() => outer({ a }, { b, c })).toThrow('outer_join_arity');
    expect(() => outer({ a })).toThrow('outer_join_arity');
    expect(() => outer({ a }, { b }, { c })).toThrow('outer_join_arity');
    expect(() => outer({ a }, { a: b })).toThrow('outer_join_alias');
    expect(() => outer({ a }, null)).toThrow('outer_join_arity');
  }
  // Conjunctions of equalities are split; the and itself is not a residual.
  const split = leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id).and(r.a.s.eq(r.b.s)));
  expect(split.ir.kind === 'Join' && split.ir.on.length).toBe(2);
});

it('emits LEFT/RIGHT/FULL ALL JOIN left-deep with the kind repeated, ON at the first clause in scope, and join_use_nulls on both emitters', () => {
  const q = leftJoin({ a }, { b }).on(r => [r.a.id.eq(r.b.id), r.a.s.eq(r.b.s)]).map(r => ({ id: r.a.id, s: r.b.s, tags: r.b.tags }));
  expect(compile(q.ir).sql).toBe('SELECT `a`.`id` AS `id`, `b`.`s` AS `s`, `b`.`tags` AS `tags`\nFROM (SELECT `id`, `s` FROM `ta`) AS `a`\nLEFT ALL JOIN (SELECT `id`, `s`, `tags` FROM `tb`) AS `b` ON `a`.`id` = `b`.`id` AND `a`.`s` = `b`.`s`' + NOTE);
  expect(emitNaive(q.ir).sql).toBe(NAIVE_Q);
  const r3 = rightJoin({ ab: leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)) }, { c }).on(r => r.ab.b.id.eq(r.c.id)).map(r => ({ n: r.c.n, s: r.ab.a.s }));
  expect(compile(r3.ir).sql).toBe(PLANNED_R3);
  expect(emitNaive(r3.ir).sql.match(/SETTINGS join_use_nulls = 1/g)).toHaveLength(1);
  const f = fullJoin({ a }, { b }).on(r => r.a.s.eq(r.b.s)).where(r => r.b.id.isNull()).groupBy(r => ({ s: r.a.s })).aggregate(g => ({ n: count(), top: max(g.b.id) }));
  const fc = compile(f.ir);
  expect(fc.sql).toBe('SELECT `a`.`s` AS `s`, count() AS `n`, max(`b`.`id`) AS `top`\nFROM (SELECT `s` FROM `ta`) AS `a`\nFULL ALL JOIN (SELECT `id`, `s` FROM `tb`) AS `b` ON `a`.`s` = `b`.`s`\nWHERE isNull(`b`.`id`)\nGROUP BY `a`.`s`' + NOTE);
  expect(Object.fromEntries(Object.entries(fc.columns).map(([k, t]) => [k, print(t)]))).toEqual({ s: 'Nullable(String)', n: 'UInt64', top: 'Nullable(UInt32)' });
  expect(emitNaive(f.ir).sql.endsWith(NOTE)).toBe(true);
  expect(emitNaive(f.ir).sql.match(/join_use_nulls/g)).toHaveLength(2);
  // Other settings come first; the note is always last.
  const week = leftJoin({ a }, { c: from(table('td', { id: col.UInt32, day: col.Date }, meta)) }).on(r => r.a.id.eq(r.c.id)).map(r => ({ w: r.c.day.toStartOfWeek() }));
  expect(compile(week.ir).sql).toMatch(/ SETTINGS enable_extended_results_for_datetime_functions = 1, join_use_nulls = 1 \/\*[^*]+\*\/$/);
});

it('never adds join_use_nulls to inner/cross-only queries; adds it once for an outer join nested in a derived table, a CTE or a subquery', () => {
  const inner = join({ a, b }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id }));
  for (const sql of [compile(inner.ir).sql, emitNaive(inner.ir).sql, compile(crossJoin({ a, b }).ir).sql]) expect(sql).not.toMatch(/join_use_nulls|SETTINGS/);
  const outer = leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, s: r.b.s }));
  const shared = outer.cte();
  for (const q of [join({ x: outer, y: c }).on(r => r.x.id.eq(r.y.id)), crossJoin({ x: shared, y: shared }), c.where(r => r.id.in(outer.map(o => o.id)))]) {
    for (const sql of [compile(q.ir).sql, emitNaive(q.ir).sql]) {
      expect(sql.match(/SETTINGS join_use_nulls = 1/g)).toHaveLength(1);
      expect(sql.endsWith(NOTE)).toBe(true);
    }
  }
});

// Slice 4b replaced the 4a fence pin: outer joins push only into inputs they neither extend nor rewrap.
it('pushes into preserved inputs only; null-rejecting conjuncts convert the kind (LeftToInner)', () => {
  const inner = (rel: Rel) => { while (rel.kind === 'Filter') rel = rel.input; if (rel.kind !== 'Join') throw new Error('join'); return rel; };
  const cases: [Rel, Record<string, number>, string, string[]][] = [
    // b.s = 'y' rejects b's extension: inner; a.s is pushed into a; b keeps its wider descriptors, so b.s stays above.
    [leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x')).where(r => r.b.s.eq('y')).ir, { LeftToInner: 1, PushFilterJoin: 1 }, 'inner', ['Filter', 'Scan']],
    // b is the preserved input of a right join.
    [rightJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.s.eq('y')).ir, { LeftToInner: 0, PushFilterJoin: 1 }, 'right', ['Scan', 'Filter']],
    // a.s rejects a's extension of a full join: left (b still extended); a is rewrapped, so nothing is pushed.
    [fullJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x')).ir, { LeftToInner: 1, PushFilterJoin: 0 }, 'left', ['Scan', 'Scan']],
    [fullJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.s.eq('x')).ir, { LeftToInner: 1, PushFilterJoin: 0 }, 'right', ['Scan', 'Scan']],
    [fullJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x').and(r.b.lc.ne('z'))).ir, { LeftToInner: 1, PushFilterJoin: 0 }, 'inner', ['Scan', 'Scan']],
  ];
  for (const [root, hits, kind, inputs] of cases) {
    const result = rewriteRel(root);
    expect(result.hits).toMatchObject(hits);
    const j = inner(result.root);
    expect(j.joinKind).toBe(kind);
    expect(j.output).toEqual(inner(root).output);
    expect(j.inputs.map(([, input]) => input.kind)).toEqual(inputs);
    expect(compile(root).columns).toEqual(emitNaive(root).columns);
  }
  // The same filters over an inner join are pushed into the sides.
  expect(rewriteRel(join({ a, b }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x')).ir).hits.PushFilterJoin).toBe(1);
});

it('validates hand-built outer joins: residual ON, computed equality, unwrapped output', () => {
  // Capture well-formed expressions bound to the reserved occurrence scope, then forge Join nodes from them.
  let lt: ExprNode | undefined, computed: ExprNode | undefined;
  const ok = leftJoin({ a }, { b }).on(r => { lt = r.a.id.lt(r.b.id).ir; computed = (r.a.id.plus(1) as any).eq(r.b.id).ir; return r.a.id.eq(r.b.id); }).ir;
  if (ok.kind !== 'Join') throw new Error('join');
  const { id: _id, ...fields } = ok;
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(ok)).not.toThrow();
    expect(() => emit(relNode({ ...fields, on: [...ok.on, lt!] }))).toThrowError(expect.objectContaining({ code: 'join_condition_not_equi', path: 'root.on[1]' }));
    expect(() => emit(relNode({ ...fields, on: [computed!] }))).toThrowError(expect.objectContaining({ code: 'join_condition_arity', path: 'root.on[0]' }));
    expect(() => emit(relNode({ ...fields, output: { shape: 'nested', inputs: ok.inputs.map(([alias, rel]) => [alias, rel.output] as const) } }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
    // Relabelling the kind is caught by the output check unless the output null-extends a superset of
    // the new kind's inputs. 4b: left -> inner keeps the left output (what LeftToInner builds) and reads
    // b through toNullable; left -> right or full does not match and stays invalid.
    expect(() => emit(relNode({ ...fields, joinKind: 'right' }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
    expect(() => emit(relNode({ ...fields, joinKind: 'full' }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
    expect(emit(relNode({ ...fields, joinKind: 'inner' })).sql).toMatch(/toNullable\(`b`\.`id`\)[^]*INNER ALL JOIN/);
  }
});

it('decodes null-extended rows: NULL scalars and LowCardinality(Nullable), server-default arrays, nested paths', () => {
  const q = leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id));
  const compiled = compile(q.ir);
  const decode = rowDecoder(compiled.columns, compiled.columnPaths);
  const names = Object.keys(compiled.columns);
  const row = Object.fromEntries(names.map((n, i) => [n, [1, null, 'x', null, null, null, [], ][i]]));
  expect(decode(row)).toEqual({ a: { id: 1, k: null, s: 'x' }, b: { id: null, s: null, lc: null, tags: [] } });
  expect(() => decode({ ...row, [names[6]!]: null })).toThrow('decode_invalid');
  expect(val(1, col.UInt8).ir.type).toEqual({ kind: 'scalar', name: 'UInt8' });
});
