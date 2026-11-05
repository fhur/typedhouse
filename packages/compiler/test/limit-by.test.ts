import { describe, expect, it } from 'vitest';
import { cast, col, columnExpr, count, flatOutput, from, join, leftJoin, max, relNode, table, unionAll, val, exprNode, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { planCtes } from '../src/plan-ctes.js';
import { pruneColumns } from '../src/prune-columns.js';
import { fallibleComputation, rewriteRel } from '../src/rewrite-rel.js';

const t = table('t', { id: col.UInt32, cat: col.String, v: col.UInt32, s: col.String, tags: col.Array(col.String) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const u = table('u', { id: col.UInt32, w: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const q = from(t);
const list = '`id`, `cat`, `v`, `s`, `tags`';
const sql = (query: { ir: Rel }) => compile(query.ir).sql.replaceAll('__typedhouse_input', 'i');
const inner = (rel: Rel) => { if (!('input' in rel)) throw new Error(`no input: ${rel.kind}`); return rel.input; };

function hand(input: Rel, keys: readonly ExprNode[], n = 1, offset?: number): Rel {
  return relNode({ kind: 'LimitBy', input, n, ...(offset === undefined ? {} : { offset }), keys, output: input.output });
}

describe('planner folds LimitBy in clause order', () => {
  it('scan: Filter + Sort + LimitBy + Limit with offset', () => {
    const query = q.where(r => r.v.gt(1)).orderBy(r => r.v.desc()).thenBy(r => r.id).limitBy(r => [r.cat, r.v]).take(2).offset(1).limit(5, 1);
    expect(sql(query)).toBe(`SELECT ${list} FROM \`t\` WHERE \`v\` > {p0:UInt32} ORDER BY \`v\` DESC, \`id\` ASC LIMIT 2 OFFSET 1 BY \`cat\`, \`v\` LIMIT 5 OFFSET 1`);
  });

  it('aggregate: HAVING, ORDER BY, LIMIT BY and LIMIT stay in one SELECT', () => {
    const query = q.where(r => r.v.gt(1)).groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).where(r => r.c.gt(1n)).orderBy(r => r.c).limitBy(r => r.cat).take(1).offset(2).limit(2);
    expect(sql(query)).toBe('SELECT `i`.`cat` AS `cat`, count() AS `c` FROM `t` AS `i` WHERE `i`.`v` > {p0:UInt32} GROUP BY `i`.`cat` HAVING `c` > {p1:UInt64} ORDER BY `c` ASC LIMIT 1 OFFSET 2 BY `cat` LIMIT 2');
  });

  it('join: every clause folds into the join block', () => {
    const query = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.v).limitBy(r => [r.a.cat, r.b.w]).take(1).offset(1).limit(3);
    const emitted = sql(query);
    expect(emitted).toContain('ORDER BY `a`.`v` ASC\nLIMIT 1 OFFSET 1 BY `a`.`cat`, `b`.`w`\nLIMIT 3');
    expect(emitted.match(/SELECT/g)).toHaveLength(1);
  });

  it('expansion: the alias is a key of the same block', () => {
    expect(sql(q.arrayJoin(r => r.tags, 'tag').limitBy(r => r.tag).take(1))).toBe(`SELECT ${list}, \`tag\` FROM \`t\` ARRAY JOIN \`tags\` AS \`tag\` LIMIT 1 BY \`tag\``);
  });

  it('identity selection folds, since it binds the same column', () => {
    expect(sql(q.map(r => ({ cat: r.cat, id: r.id })).limitBy(r => r.cat).take(1))).toBe('SELECT `cat`, `id` FROM `t` LIMIT 1 BY `cat`');
  });

  it('CTE source reads the reference directly', () => {
    expect(sql(q.cte().limitBy(r => r.cat).take(1))).toBe(`WITH \`t0\` AS (SELECT ${list} FROM \`t\`) SELECT \`t0\`.\`id\`, \`t0\`.\`cat\`, \`t0\`.\`v\`, \`t0\`.\`s\`, \`t0\`.\`tags\` FROM \`t0\` LIMIT 1 BY \`t0\`.\`cat\``);
  });

  it.each([
    ['limit then limitBy', () => q.limit(3).limitBy(r => r.cat).take(1), 'LIMIT 3) AS `i` LIMIT 1 BY `i`.`cat`'],
    ['limitBy then orderBy', () => q.limitBy(r => r.cat).take(1).orderBy(r => r.v), 'LIMIT 1 BY `cat`) AS `i` ORDER BY `i`.`v` ASC'],
    ['limitBy twice', () => q.limitBy(r => r.cat).take(1).limitBy(r => r.v).take(1), 'LIMIT 1 BY `cat`) AS `i` LIMIT 1 BY `i`.`v`'],
    ['limitBy then where', () => q.limitBy(r => r.cat).take(1).where(r => r.v.gt(1)), 'LIMIT 1 BY `cat`) AS `i` WHERE `i`.`v` > {p0:UInt32}'],
    ['limitBy then distinct', () => q.limitBy(r => r.cat).take(1).distinct(), 'LIMIT 1 BY `cat`) AS `i`'],
    ['limitBy over computed map', () => q.map(r => ({ k: r.v.plus(1), id: r.id })).limitBy(r => r.k).take(1), 'AS `k`, `id` AS `id` FROM `t`) AS `i` LIMIT 1 BY `i`.`k`'],
    ['limitBy over renaming map', () => q.map(r => ({ cat: r.s, id: r.id })).limitBy(r => r.cat).take(1), 'FROM `t`) AS `i` LIMIT 1 BY `i`.`cat`'],
    ['aggregate with computed key', () => q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).limitBy(r => r.c.plus(1n)).take(1), 'GROUP BY `i`.`cat`) AS `i` LIMIT 1 BY `i`.`c` + {p0:UInt64}'],
  ])('%s nests', (_name, build, tail) => {
    const emitted = sql(build());
    expect(emitted).toContain(tail);
    expect(emitted.match(/SELECT/g)!.length).toBeGreaterThan(1);
  });

  it('distinct then limitBy folds and keeps the full DISTINCT list', () => {
    const distinct = q.map(r => ({ cat: r.cat, v: r.v })).distinct();
    expect(sql(distinct.limitBy(r => r.cat).take(1))).toBe('SELECT DISTINCT `cat`, `v` FROM `t` LIMIT 1 BY `cat`');
    expect(sql(distinct.limitBy(r => r.cat).take(1).map(r => ({ v: r.v })))).toBe('SELECT `i`.`v` AS `v` FROM (SELECT DISTINCT `cat`, `v` FROM `t` LIMIT 1 BY `cat`) AS `i`');
  });

  it('an aggregate output that shadows a source column keeps its own scope', () => {
    const shadow = q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ v: count() })).limitBy(r => r.v).take(1);
    expect(sql(shadow)).toContain('GROUP BY `i`.`cat`) AS `i` LIMIT 1 BY `i`.`v`');
  });

  it('a CTE aggregate output named as its source column does not fold once a key reads it', () => {
    const source = q.map(r => ({ cat: r.cat, n: r.v })).cte();
    const aggregate = source.groupBy(r => ({ cat: r.cat })).aggregate(r => ({ n: max(r.n) }));
    const folded = sql(aggregate);
    expect(folded.match(/SELECT/g)).toHaveLength(2);
    expect(sql(aggregate.limitBy(r => r.n).take(1))).toContain('LIMIT 1 BY `i`.`n`');
  });

  it('allocates parameters in textual order, keys after WHERE', () => {
    const compiled = compile(q.where(r => r.v.gt(5)).limitBy(r => r.v.plus(val(7, col.UInt32))).take(1).ir);
    expect(compiled.sql).toBe(`SELECT ${list} FROM \`t\` WHERE \`v\` > {p0:UInt32} LIMIT 1 BY \`v\` + {p1:UInt32}`);
    expect(compiled.params).toEqual({ p0: '5', p1: '7' });
    expect(emitNaive(q.where(r => r.v.gt(5)).limitBy(r => r.v.plus(val(7, col.UInt32))).take(1).ir).params).toEqual({ p0: '5', p1: '7' });
  });
});

describe('naive emitter', () => {
  it('nests the input and qualifies keys', () => {
    expect(emitNaive(q.limitBy(r => [r.cat, r.v.plus(1)]).take(2).offset(3).ir).sql.replaceAll('__typedhouse_input', 'i'))
      .toBe(`SELECT \`i\`.\`id\`, \`i\`.\`cat\`, \`i\`.\`v\`, \`i\`.\`s\`, \`i\`.\`tags\` FROM (SELECT ${list} FROM \`t\`) AS \`i\` LIMIT 2 OFFSET 3 BY \`i\`.\`cat\`, plus(\`i\`.\`v\`, {p0:UInt32})`);
  });

  it('uses join leaves for join keys', () => {
    const emitted = emitNaive(join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).limitBy(r => r.b.w).take(1).ir).sql;
    expect(emitted).toMatch(/LIMIT 1 BY `__typedhouse_input`\.`__typedhouse_leaf_\d+`$/);
  });
});

describe('rewrite passes', () => {
  it('a Filter above stays above', () => {
    const query = q.limitBy(r => r.cat).take(1).where(r => r.cat.eq('x'));
    const { root, hits } = rewriteRel(query.ir);
    expect(root).toBe(query.ir);
    expect(Object.values(hits).every(n => n === 0)).toBe(true);
  });

  it('does not merge filters across it', () => {
    const query = q.where(r => r.v.gt(1)).limitBy(r => r.cat).take(1).where(r => r.v.gt(2));
    const { root, hits } = rewriteRel(query.ir);
    expect(hits.MergeFilter).toBe(0);
    expect(root.kind).toBe('Filter');
    expect(inner(root).kind).toBe('LimitBy');
    expect(inner(inner(root)).kind).toBe('Filter');
  });

  it('a filter pushed below it is kept in the rebuilt node, with offset and rebound keys', () => {
    const query = q.map(r => ({ id: r.id, cat: r.cat })).where(r => r.id.gt(1)).limitBy(r => r.cat).take(2).offset(1);
    const { root, hits } = rewriteRel(query.ir);
    expect(hits.PushFilterProject).toBe(1);
    if (root.kind !== 'LimitBy') throw new Error(root.kind);
    expect(root).not.toBe(query.ir);
    expect([root.n, root.offset]).toEqual([2, 1]);
    expect(inner(root).kind).toBe('Project');
    expect(inner(inner(root)).kind).toBe('Filter');
    const key = root.keys[0]!;
    if (key.kind !== 'ColumnRef') throw new Error(key.kind);
    expect(key.rel).toBe(root.input.id);
    expect(compile(query.ir).sql).toContain('`id` > {p0:UInt32}');
    expect(compile(query.ir).params).toEqual({ p0: '1' });
  });

  it('a filter on a join side stays above a LimitBy input', () => {
    const query = join({ a: q.limitBy(r => r.cat).take(1), b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.v.gt(1));
    const { root, hits } = rewriteRel(query.ir);
    expect(hits.PushFilterJoin).toBe(1);
    const side = (root as Extract<Rel, { kind: 'Join' }>).inputs[0]![1];
    expect(side.kind).toBe('Filter');
    expect(inner(side).kind).toBe('LimitBy');
  });

  it('a non-total key fences as Sort does', () => {
    const fallible = q.limitBy(r => cast(r.s, col.UInt32)).take(1);
    expect(fallibleComputation(fallible.ir)).toBe(true);
    expect(fallibleComputation(q.limitBy(r => r.cat).take(1).ir)).toBe(false);
    const joined = join({ a: fallible, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x'));
    expect(rewriteRel(joined.ir).hits.PushFilterJoin).toBe(0);
    const outer = leftJoin({ a: fallible }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x'));
    expect(rewriteRel(outer.ir).hits.LeftToInner).toBe(0);
    const total = leftJoin({ a: q.limitBy(r => r.cat).take(1) }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x'));
    expect(rewriteRel(total.ir).hits.LeftToInner).toBe(1);
  });

  it('a subquery in a key is rewritten and counted, and a shared one becomes a CTE', () => {
    const sub = from(u).map(r => ({ id: r.id, w: r.w })).where(r => r.id.gt(1)).map(r => r.id);
    const query = q.limitBy(r => r.id.in(sub)).take(1);
    const rewritten = rewriteRel(query.ir);
    expect(rewritten.hits.PushFilterProject).toBeGreaterThan(0);
    expect(compile(query.ir).sql).toContain('`id` > {p0:UInt32}');
    const shared = from(u).where(r => r.id.gt(1)).map(r => r.id);
    const twice = q.limitBy(r => [r.id.in(shared), r.v.in(shared)]).take(1);
    const ctes = planCtes(twice.ir);
    expect(ctes.names.has(shared.ir)).toBe(true);
    expect(ctes.uses.get(shared.ir)).toBe(2);
    expect(compile(twice.ir).sql).toMatch(/^WITH `t0` AS \(SELECT .* LIMIT 1 BY in\(`id`, \(SELECT `t0`.`id` FROM `t0`\)\), in\(`v`, \(SELECT `t0`.`id` FROM `t0`\)\)$/);
  });
});

describe('column pruning', () => {
  it('demands an unselected key from the input', () => {
    const query = q.limitBy(r => r.cat).take(1).map(r => ({ id: r.id }));
    const taken = inner(query.ir);
    const demand = pruneColumns(query.ir);
    expect(demand.get(taken)!.map(l => l.name)).toEqual(['id']);
    expect(demand.get(inner(taken))!.map(l => l.name)).toEqual(['id', 'cat']);
    expect(sql(query)).toBe('SELECT `i`.`id` AS `id` FROM (SELECT `id` FROM `t` LIMIT 1 BY `cat`) AS `i`');
  });

  it('demands a key from a derived input and a join side', () => {
    const computed = q.map(r => ({ k: r.v.plus(1), id: r.id, other: r.cat })).limitBy(r => r.k).take(1).map(r => ({ id: r.id }));
    expect(sql(computed)).toContain('(SELECT `i`.`id` FROM (SELECT `v` + {p0:UInt32} AS `k`, `id` AS `id`, `cat` AS `other` FROM `t`) AS `i` LIMIT 1 BY `i`.`k`)');
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).limitBy(r => r.b.w).take(1).map(r => ({ id: r.a.id }));
    expect(sql(joined)).toContain('LIMIT 1 BY `b`.`w`');
  });
});

describe('compiler validation of hand-built IR', () => {
  const scan = q.ir;
  const row = q.row;
  const paths = [compile, emitNaive] as const;
  const code = (build: () => unknown) => { try { build(); } catch (error) { return (error as { code?: string; message: string }).code ?? (error as Error).message; } return 'accepted'; };

  it.each(paths.map(path => [path.name, path] as const))('%s rejects every column-free key', (_name, path) => {
    const literal = exprNode({ kind: 'Literal', type: col.UInt32.type, value: 2 });
    const param = val(2, col.UInt32).ir;
    const raw = exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['2'], args: [] });
    const scalar = exprNode({ kind: 'Subquery', usage: 'scalar', type: col.UInt32.type, rel: q.map(r => r.id).limit(1).ir });
    const call = val(2, col.UInt32).plus(3).ir;
    for (const key of [literal, param, raw, scalar, call]) expect(code(() => path(hand(scan, [key])))).toBe('invalid_limit_by_key');
    expect(code(() => path(hand(scan, [row.cat.ir, param])))).toBe('invalid_limit_by_key');
    expect(code(() => path(hand(scan, [])))).toBe('invalid_limit_by_key');
  });

  it.each(paths.map(path => [path.name, path] as const))('%s applies the limit rules to n and offset', (_name, path) => {
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(code(() => path(hand(scan, [row.cat.ir], bad)))).toBe('invalid_limit');
      expect(code(() => path(hand(scan, [row.cat.ir], 1, bad)))).toBe('invalid_limit');
    }
    expect(code(() => path(hand(scan, [row.cat.ir], 0, 0)))).toBe('accepted');
  });

  it.each(paths.map(path => [path.name, path] as const))('%s rejects foreign, aggregate and malformed keys', (_name, path) => {
    expect(code(() => path(hand(scan, [from(t).row.cat.ir])))).toBe('unbound_column');
    expect(code(() => path(hand(scan, [max(columnExpr(col.UInt32, scan.id, ['v'], 'v', 'grouped')).ir])))).toBe('invalid_aggregate_placement');
    const grouped = exprNode({ kind: 'ColumnRef', mode: 'grouped', rel: scan.id, path: ['cat'], type: col.String.type });
    expect(code(() => path(hand(scan, [grouped])))).toBe('invalid_expression_mode');
    const notArray = { ...hand(scan, [row.cat.ir]), keys: 'cat' } as unknown as Rel;
    expect(code(() => path(notArray))).toBe('invalid_structure');
    const output = flatOutput([['other', col.String.type]]);
    expect(code(() => path(relNode({ kind: 'LimitBy', input: scan, n: 1, keys: [row.cat.ir], output })))).toBe('invalid_output');
  });

  it('accepts a column-reading Raw', () => {
    const raw = exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['', ''], args: [row.v.ir] });
    expect(compile(hand(scan, [raw])).sql).toContain('LIMIT 1 BY ((`v`))');
    expect(emitNaive(hand(scan, [raw])).sql).toContain('LIMIT 1 BY ((`__typedhouse_input`.`v`))');
  });

  it('shares a LimitBy node as a CTE with its key inside', () => {
    const shared = q.limitBy(r => r.cat).take(1);
    expect(sql(unionAll(shared, shared))).toContain(`WITH \`t0\` AS (SELECT ${list} FROM \`t\` LIMIT 1 BY \`cat\`)`);
  });

});
