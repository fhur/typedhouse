import { expect, it } from 'vitest';
import { cast, col, count, crossJoin, from, fullJoin, join, leftJoin, outerColumnType, parseCHType, print, relNode, rightJoin, scalar, table, unionAll, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';

// Tester probes for slice 4a (outer joins), Docker-free. Native counterparts: packages/client/test/slice4a-adversarial.integration.ts.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, k: col.Nullable(col.UInt32), s: col.String, n: col.Int64, tags: col.Array(col.String), lc: col.LowCardinality(col.String), t: col.Tuple({ x: col.UInt8, y: col.String }) };
const A = from(table('oa', cols, meta)), B = from(table('ob', cols, meta)), C = from(table('oc', { id: col.UInt32, v: col.UInt32 }, meta));
const NOTE = ' SETTINGS join_use_nulls = 1 /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */';
const lj = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
const both = (root: Rel) => [compile(root).sql, emitNaive(root).sql];

it('runtime arity/alias errors carry the exact messages for all three kinds', () => {
  for (const [name, f] of [['leftJoin', leftJoin], ['rightJoin', rightJoin], ['fullJoin', fullJoin]] as const) {
    const g = f as any;
    expect(() => g({ a: A })).toThrow(new Error(`outer_join_arity: ${name} takes exactly two inputs, (left, right)`));
    expect(() => g({ a: A }, { b: B }, { c: C })).toThrow(new Error(`outer_join_arity: ${name} takes exactly two inputs, (left, right)`));
    expect(() => g({ a: A, c: C }, { b: B })).toThrow(new Error(`outer_join_arity: each ${name} argument is a record with exactly one aliased input`));
    expect(() => g({ a: A }, { [Symbol('x')]: B, b: B })).toThrow(new Error(`outer_join_arity: each ${name} argument is a record with exactly one aliased input`));
    expect(() => g({ a: A }, 'b')).toThrow(new Error(`outer_join_arity: each ${name} argument is a record with exactly one aliased input`));
    expect(() => g({ a: A }, { a: B })).toThrow(new Error(`outer_join_alias: ${name} inputs need distinct aliases`));
    expect(() => g({ a: A }, { b: 1 })).toThrow('invalid_join_input');
    expect(() => g({ a: A }, { b: B }).on((r: any) => r.a.id.lt(r.b.id))).toThrow(new Error('join_condition_not_equi: an outer join condition must be an equality between columns'));
  }
});

it('ON validation: non-column equalities pass the builder and fail compile with join_condition_arity on both emitters (spec: "eq between columns of two different inputs")', () => {
  const cases: [string, () => Rel][] = [
    ['computed', () => leftJoin({ a: A }, { b: B }).on(r => (r.a.id.plus(1) as any).eq(r.b.id)).ir],
    ['same side', () => leftJoin({ a: A }, { b: B }).on(r => (r.b.id as any).eq(r.b.k)).ir],
    ['param', () => rightJoin({ a: A }, { b: B }).on(r => (r.b.id as any).eq(3)).ir],
    ['empty', () => fullJoin({ a: A }, { b: B }).on(() => [] as any).ir],
    ['nested same side', () => leftJoin({ a: A }, { bc: join({ b: B, c: C }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.bc.b.id.eq(r.bc.c.id)).ir],
  ];
  for (const [label, build] of cases) {
    const root = build();
    for (const emit of [compile, emitNaive]) expect(() => emit(root), label).toThrowError(expect.objectContaining({ code: 'join_condition_arity' }));
  }
  // A Param equality is an eq, so the builder's not-equi check does not see it; an `and` of eq + lt is split and rejected.
  expect(() => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id).and(r.a.id.lt(r.b.id)))).toThrow('join_condition_not_equi');
});

it('join_use_nulls appears exactly once, last, whenever an outer join is emitted anywhere, and never otherwise', () => {
  const outer: Rel[] = [
    lj().ir,
    join({ x: lj().map(r => ({ id: r.a.id })), y: C }).on(r => r.x.id.eq(r.y.id)).ir,
    A.map(r => ({ id: r.id, c: scalar(lj().aggregate(() => ({ c: count() }))) })).ir,
    A.where(r => r.id.in(lj().map(r => ({ id: r.a.id })))).ir,
    unionAll(A.map(r => ({ id: r.id })), lj().map(r => ({ id: r.a.id }))).ir,
    unionAll(lj().map(r => ({ id: r.a.id })), A.map(r => ({ id: r.id }))).ir,
    lj().map(r => ({ id: r.a.id })).cte().ir,
    crossJoin({ x: lj().map(r => ({ id: r.a.id })).cte(), y: C }).ir,
    lj().leftArrayJoin(r => r.b.tags, 'tag').ir,
    leftJoin({ a: A.leftArrayJoin(r => r.tags, 'tag') }, { b: B }).on(r => r.a.id.eq(r.b.id)).ir,
  ];
  for (const root of outer) for (const sql of both(root)) {
    expect(sql.endsWith(NOTE), sql).toBe(true);
    expect(sql.match(/join_use_nulls = 1/g), sql).toHaveLength(2);
    expect(sql.match(/ SETTINGS /g), sql).toHaveLength(1);
  }
  const inner: Rel[] = [join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).ir, crossJoin({ a: A, b: B }).ir, A.leftArrayJoin(r => r.tags, 'tag').ir, unionAll(A.map(r => ({ id: r.id })), B.map(r => ({ id: r.id }))).ir];
  for (const root of inner) for (const sql of both(root)) expect(sql, sql).not.toMatch(/join_use_nulls|SETTINGS|\/\*/);
});

// Slice 4b flipped this 4a pin deliberately: `b.s = 'x'` is null-rejecting on b, so LeftToInner makes the
// join INNER; b's reads keep their Nullable descriptor through toNullable; nothing is pushed into b.
it('planner widening: WHERE stays in the join block (never ON); 4b LeftToInner; 3b isolation still opens a block above it', () => {
  const total = lj().where(r => r.b.s.eq('x')).map(r => ({ id: r.a.id }));
  const sql = compile(total.ir).sql;
  expect(sql).toMatch(/INNER ALL JOIN \(SELECT `id`, `s` FROM `ob`\) AS `b` ON `a`\.`id` = `b`\.`id`\nWHERE \(`b`\.`s` = \{p0:String\}\)/); // fix round 1 (m3): a total WHERE reads the converted column bare
  expect(sql).not.toMatch(/join_use_nulls/);
  expect(rewriteRel(total.ir).hits).toMatchObject({ LeftToInner: 1, PushFilterJoin: 0 });
  // A fallible conjunct is not `safePredicate`, so it neither converts the join nor moves; it also fences the join below it.
  const fallible = lj().where(r => r.a.id.ne(2)).where(r => cast(r.b.s.ifNull('0'), col.UInt64).gt(0n));
  const f = compile(fallible.ir).sql;
  // Under the cast Filter the join is exposed (`fallibleExposure`): nothing converts or moves, as in 4a.
  expect(rewriteRel(fallible.ir).hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  expect(f.match(/SELECT /g)).toHaveLength(2);
  expect(f).toMatch(/LEFT ALL JOIN `ob` AS `b` ON `a`\.`id` = `b`\.`id` WHERE \(`a`\.`id` != \{p0:UInt32\}\)\) AS `__typedhouse_input` WHERE CAST\(ifNull/);
  // 4b: a filter on the preserved side of a left/right join is pushed into that side only.
  for (const q of [leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x')), rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.s.eq('x'))]) {
    expect(rewriteRel(q.ir).hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 1 });
  }
});

// Fix round 1: was a DEFECT pin (the declared SAF was kept); now asserts the server's LowCardinality(Nullable(T)).
it('outerColumnType maps SimpleAggregateFunction(f, LowCardinality(T)) to LowCardinality(Nullable(T)), as 24.8 returns under join_use_nulls', () => {
  const observed = (text: string) => print(outerColumnType(parseCHType(text)));
  // Server (24.8.14.39, LEFT ALL JOIN never matching, join_use_nulls = 1) → LowCardinality(Nullable(String)) / (UInt32) / (FixedString(2)).
  expect(observed('SimpleAggregateFunction(max, LowCardinality(String))')).toBe('LowCardinality(Nullable(String))');
  expect(observed('SimpleAggregateFunction(max, LowCardinality(UInt32))')).toBe('LowCardinality(Nullable(UInt32))');
  expect(observed('SimpleAggregateFunction(max, LowCardinality(FixedString(2)))')).toBe('LowCardinality(Nullable(FixedString(2)))');
  // Agreeing cases from the same probe.
  expect(observed('SimpleAggregateFunction(max, LowCardinality(Nullable(String)))')).toBe('SimpleAggregateFunction(max, LowCardinality(Nullable(String)))');
  expect(observed("SimpleAggregateFunction(anyLast, DateTime64(3, 'UTC'))")).toBe("Nullable(SimpleAggregateFunction(anyLast, DateTime64(3, 'UTC')))");
  expect(observed("SimpleAggregateFunction(max, Enum8('a' = 1))")).toBe("Nullable(SimpleAggregateFunction(max, Enum8('a' = 1)))");
  expect(observed('SimpleAggregateFunction(anyLast, Map(String, UInt64))')).toBe('SimpleAggregateFunction(anyLast, Map(String, UInt64))');
  for (const [text, server] of [["LowCardinality(DateTime('UTC'))", "LowCardinality(Nullable(DateTime('UTC')))"], ['LowCardinality(UUID)', 'LowCardinality(Nullable(UUID))'], ['LowCardinality(Bool)', 'LowCardinality(Nullable(Bool))'], ['Decimal(76, 10)', 'Nullable(Decimal(76, 10))'], ['Map(String, Nullable(UInt64))', 'Map(String, Nullable(UInt64))'], ['Tuple(a Nullable(String))', 'Tuple(a Nullable(String))'], ['Point', 'Point'], ['Ring', 'Ring'], ['IPv6', 'Nullable(IPv6)']] as const) {
    expect(observed(text), text).toBe(server);
  }
});

it('forged IR: relabelling an outer kind (left→full, left→right) without rewrapping the output is invalid_output on both emitters', () => {
  const ok = lj().ir;
  if (ok.kind !== 'Join') throw new Error('join');
  const { id: _id, ...fields } = ok;
  for (const joinKind of ['full', 'right'] as const) for (const emit of [compile, emitNaive]) {
    expect(() => emit(relNode({ ...fields, joinKind }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
  }
});
