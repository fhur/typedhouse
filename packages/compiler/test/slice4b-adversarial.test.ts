import { expect, it } from 'vitest';
import { argMax, avg, cast, col, count, from, fullJoin, join, leftJoin, max, quantile, relNode, rightJoin, scalar, sum, table, uniq, uniqExact, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { nullRejecting } from '../src/rewrite-expressions.js';
import { fallibleWithin, rewriteRel } from '../src/rewrite-rel.js';

// Tester probes for slice 4b (LeftToInner, outer PushFilterJoin, toNullable rewrap, relaxed Join output check), Docker-free.
// Native counterparts: packages/client/test/slice4b-adversarial.integration.ts.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, s: col.String, n: col.Int64, k: col.Nullable(col.UInt32), lc: col.LowCardinality(col.String), lcn: col.LowCardinality(col.Nullable(col.String)), tags: col.Array(col.String), t: col.Tuple({ x: col.UInt8, y: col.String }) };
const A = from(table('qa', cols, meta)), B = from(table('qb', cols, meta)), C = from(table('qc', cols, meta));
const lj = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
const kinds = (root: Rel): string[] => { const out: string[] = []; const seen = new Set<Rel>(); const visit = (r: Rel): void => { if (seen.has(r)) return; seen.add(r); if (r.kind === 'Join') out.push(r.joinKind); for (const v of Object.values(r)) { if (v && typeof v === 'object' && 'kind' in v && 'id' in v) visit(v as Rel); if (Array.isArray(v)) for (const x of v) { if (Array.isArray(x) && x[1] && typeof x[1] === 'object' && 'kind' in x[1]) visit(x[1]); else if (x && typeof x === 'object' && 'kind' in x && 'id' in x) visit(x as Rel); } } }; visit(root); return out; };
const hits = (root: Rel) => rewriteRel(root).hits;
const after = (root: Rel) => kinds(rewriteRel(root).root);

const kindsAfter = (q: { ir: Rel }) => after(q.ir);
const bad = (s: any): any => cast(s, col.UInt8);

it('nullRejecting branches: NULL Param, same-side columns, LC(Nullable), and(or, cmp), nested and; not/isNull/element/Array never', () => {
  const yes = [
    lj().where(r => r.b.k.eq(val(null, col.Nullable(col.UInt32)))), // NULL operand: NULL on every row, sound
    lj().where(r => r.b.s.eq(r.b.lc)), // both operands on the extended side
    lj().where(r => r.b.lcn.eq('x')), lj().where(r => r.b.lcn.isNotNull()), lj().where(r => r.b.k.ne(3)),
    lj().where(r => r.a.s.eq('x').or(r.b.s.eq('y')).and(r.b.n.gt(0n))),
    lj().where(r => r.a.s.eq('x').and(r.a.n.gt(1n).and(r.b.n.lt(9n)))),
  ];
  for (const q of yes) expect(kindsAfter(q), compile(q.ir).sql).toEqual(['inner']);
  const no = [
    lj().where(r => r.b.s.isNotNull().not()), lj().where(r => r.b.s.eq('x').not()), lj().where(r => r.b.s.isNull()),
    lj().where(r => r.b.t.element('x').gt(0)), lj().where(r => r.b.tags.length().gt(0n)), lj().where(r => r.b.s.ifNull('').eq('')),
    lj().where(r => r.a.s.eq('x').or(r.b.s.eq('y'))), lj().where(r => (r.b.tags as any).eq(r.a.tags)),
  ];
  for (const q of no) expect(kindsAfter(q), compile(q.ir).sql).toEqual(['left']);
  // Direct: rejecting on b never means rejecting on a.
  const f = lj().where(r => r.b.s.eq(r.b.lc)).ir;
  if (f.kind !== 'Filter') throw new Error('filter');
  expect([nullRejecting(f.pred, f.input.id, 'b'), nullRejecting(f.pred, f.input.id, 'a')]).toEqual([true, false]);
});

it('full -> left / right / inner by the rejected sides; symmetric difference stays full', () => {
  const fj = () => fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  expect(kindsAfter(fj().where(r => r.a.n.gt(0n)))).toEqual(['left']);
  expect(kindsAfter(fj().where(r => r.b.n.gt(0n)))).toEqual(['right']);
  expect(kindsAfter(fj().where(r => r.b.n.gt(0n).and(r.a.s.eq('q'))))).toEqual(['inner']);
  expect(kindsAfter(fj().where(r => r.a.s.eq(r.b.s)))).toEqual(['inner']);
  expect(kindsAfter(fj().where(r => r.a.id.isNull().or(r.b.id.isNull())))).toEqual(['full']);
  // full keeps every input extended: nothing is pushed, even a conjunct over one side only.
  expect(hits(fj().where(r => r.a.lc.isNull().or(r.a.n.gt(0n))).ir)).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  // Two passes: full -> left in one Filter, then a second Filter converts the rest.
  expect(kindsAfter(fj().where(r => r.a.n.gt(0n)).where(r => r.b.n.gt(0n)))).toEqual(['inner']);
});

it('nested outer joins: only the join whose extended input the conjunct rejects converts (and the nested one is not reached: minor missed rewrite)', () => {
  const overLeft = leftJoin({ a: A }, { bc: leftJoin({ b: B }, { c: C }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.b.id));
  // bc.c.n > 0 rejects both bc's extension (outer) and c's extension (nested); only the outer converts: the conjunct
  // cannot enter bc, whose descriptors in the converted join are wider than its own.
  expect(kindsAfter(overLeft.where(r => r.bc.c.n.gt(0n)))).toEqual(['inner', 'left']);
  expect(kindsAfter(overLeft.where(r => r.bc.b.n.gt(0n)))).toEqual(['inner', 'left']);
  const leftOfLeft = leftJoin({ ab: lj() }, { c: C }).on(r => r.ab.a.id.eq(r.c.id));
  // ab is the preserved input: the conjunct is pushed into it, then converts the nested join only.
  const r = rewriteRel(leftOfLeft.where(r => r.ab.b.n.gt(0n)).ir);
  expect(r.hits).toMatchObject({ LeftToInner: 1, PushFilterJoin: 1 });
  expect(kinds(r.root)).toEqual(['left', 'inner']);
  expect(compile(leftOfLeft.where(r => r.ab.b.n.gt(0n)).ir).sql).toMatch(/join_use_nulls = 1/);
});

it('PushFilterJoin outer conditions: left -> first only, right -> last only, full -> none, never into a converted input; residuals and splits', () => {
  const lr = rewriteRel(lj().where(r => r.a.n.gt(0n).and(r.a.lc.eq('q')).and(r.a.s.eq(r.b.s))).ir);
  expect(lr.hits).toMatchObject({ LeftToInner: 1, PushFilterJoin: 1 });
  const lroot = lr.root;
  if (lroot.kind !== 'Filter' || lroot.input.kind !== 'Join') throw new Error('shape');
  expect(lroot.input.inputs[0]![1].kind).toBe('Filter');
  expect(lroot.input.inputs[1]![1]).toBe(B.ir); // converted input never receives a conjunct
  const right = rewriteRel(rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n).and(r.a.lc.isNull()).and(r.a.n.ifNull(0n).gt(1n))).ir);
  expect(right.hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 1 });
  if (right.root.kind !== 'Filter' || right.root.input.kind !== 'Join') throw new Error('shape');
  expect(right.root.input.inputs[0]![1]).toBe(A.ir);
  expect(right.root.input.inputs[1]![1].kind).toBe('Filter');
  // Left join: an extended-side-only conjunct that is not null-rejecting stays above (never pushed into b).
  const stays = rewriteRel(lj().where(r => r.b.s.isNull().or(r.b.n.gt(0n))).ir);
  expect(stays.hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  // Composite: a converted join's former extended side never gets a pushed conjunct in later passes either.
  const later = rewriteRel(lj().where(r => r.b.n.gt(0n)).where(r => r.b.lc.eq('x')).ir);
  expect(joinOf(later.root).inputs[1]![1]).toBe(B.ir);
});
const joinOf = (rel: Rel): Extract<Rel, { kind: 'Join' }> => { while (rel.kind !== 'Join') { if (!('input' in rel)) throw new Error('no join'); rel = rel.input; } return rel; };

it('fixed DEFECT (4b fix round 1, unit side): a fallible expression inside either join input fences LeftToInner and PushFilterJoin', () => {
  const projB = B.map(r => ({ id: r.id, n: r.n, c: bad(r.s) }));
  const projA = A.map(r => ({ id: r.id, c: bad(r.s) }));
  // 4b fix round 1: flipped from the DEFECT pin (was LeftToInner 1). `fallibleWithin` fences a join whose input (extended or
  // preserved) evaluates a non-total expression; neither rule fires, so the texts fail like naive (native twin).
  expect(hits(leftJoin({ a: A }, { b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).ir)).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  expect(hits(leftJoin({ a: projA }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.lt(3)).ir)).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
});

it('fence breadth: a fallible Filter in another union branch or outer scope does not expose; a shared occurrence under one exposed consumer is fenced for all (over-wide, minor)', () => {
  const conv = lj().where(r => r.b.n.gt(0n));
  expect(hits(unionAll(conv.map(r => ({ id: r.a.id })), lj().where(r => bad(r.b.s.ifNull('0')).gt(0)).map(r => ({ id: r.a.id }))).ir).LeftToInner).toBe(1);
  const shared = conv.map(r => ({ id: r.a.id, s: r.b.s })).cte();
  const twice = unionAll(shared.map(r => ({ id: r.id })), shared.where(r => bad(r.s.ifNull('0')).gt(0)).map(r => ({ id: r.id })));
  expect(hits(twice.ir).LeftToInner).toBe(0);
  // A fallible scalar subquery in the select list above does not expose the join (Project exprs are not inspected).
  expect(hits(conv.map(r => ({ id: r.a.id, c: scalar(B.where(x => bad(x.s).gt(0)).aggregate(() => ({ c: count() }))) })).ir).LeftToInner).toBe(1);
  // Over-wide: a fallible HAVING exposes the join below the Aggregate, though the server cannot move it there.
  expect(hits(conv.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ m: max(g.b.s) })).where(r => bad(r.m.ifNull('0')).gt(0)).ir).LeftToInner).toBe(0);
});

it('relaxed Join output check: forged inner/left/right carrying a wider kind\'s output is legal and typed by its descriptors; narrower or cross relabels stay invalid_output', () => {
  const pairs: [() => { ir: Rel }, ('inner' | 'left' | 'right' | 'full' | 'cross')[], ('inner' | 'left' | 'right' | 'full' | 'cross')[]][] = [
    [() => lj(), ['inner'], ['right', 'full', 'cross']],
    [() => rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)), ['inner'], ['left', 'full', 'cross']],
    [() => fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)), ['inner', 'left', 'right'], ['cross']],
    [() => join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)), [], ['left', 'right', 'full']],
  ];
  for (const [make, legal, illegal] of pairs) {
    const ok = make().ir;
    if (ok.kind !== 'Join') throw new Error('join');
    const { id: _id, ...fields } = ok;
    for (const emit of [compile, emitNaive]) {
      for (const joinKind of legal) {
        const forged = relNode({ ...fields, joinKind });
        expect(emit(forged).columns, joinKind).toEqual(emit(ok).columns);
      }
      for (const joinKind of illegal) {
        const forged = joinKind === 'cross' ? relNode({ ...fields, joinKind, on: [] }) : relNode({ ...fields, joinKind });
        expect(() => emit(forged), joinKind).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
      }
    }
  }
  // Swapped inputs under a valid-looking output, and a nested side whose output is not any kind's: invalid.
  const ok = lj().ir;
  if (ok.kind !== 'Join') throw new Error('join');
  const { id: _id, ...fields } = ok;
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(relNode({ ...fields, inputs: [ok.inputs[1]!, ok.inputs[0]!] }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
    // b's output with only `id` unwrapped (UInt32) and the rest null-extended: no kind produces it.
    const bOut = ok.output.inputs[1]![1] as Extract<typeof ok.output.inputs[1][1], { shape: 'flat' }>;
    const partial = { shape: 'nested', inputs: [ok.output.inputs[0], [ok.output.inputs[1]![0], { ...bOut, columns: { ...bOut.columns, id: { kind: 'scalar', name: 'UInt32' } } }]] };
    expect(() => emit(relNode({ ...fields, joinKind: 'inner', output: partial as any }))).toThrowError(expect.objectContaining({ code: 'invalid_output' }));
  }
});

it('join_use_nulls follows surviving outer joins through scalar/IN subqueries, CTEs and union branches', () => {
  const conv = lj().where(r => r.b.n.gt(0n));
  expect(compile(A.map(r => ({ id: r.id, c: scalar(conv.aggregate(() => ({ c: count() }))) })).ir).sql).not.toMatch(/join_use_nulls|LEFT/);
  expect(compile(A.where(r => r.id.in(conv.map(x => ({ id: x.a.id })))).ir).sql).not.toMatch(/join_use_nulls|LEFT/);
  const keep = compile(A.where(r => r.id.in(lj().map(x => ({ id: x.a.id })))).map(r => ({ id: r.id, c: scalar(conv.aggregate(() => ({ c: count() }))) })).ir).sql;
  expect(keep.match(/join_use_nulls = 1/g)).toHaveLength(2);
  const cte = conv.map(r => ({ id: r.a.id, n: r.b.n })).cte();
  expect(compile(unionAll(cte, cte).ir).sql).not.toMatch(/join_use_nulls/);
  // emitNaive keeps LEFT and the setting for all of them.
  expect(emitNaive(unionAll(cte, cte).ir).sql).toMatch(/LEFT ALL JOIN[^]*join_use_nulls = 1/);
});

// Re-verification (4b fix round 1): what `fallibleWithin` must and must not see inside a join input.
const D = from(table('qd', { id: col.UInt32, d: col.Decimal(10, 2), n: col.Int64, f: col.Float64, s: col.String, k: col.Nullable(col.UInt32), arr: col.Array(col.String), lc: col.LowCardinality(col.String) }, meta));
const overInput = (input: { ir: Rel }) => rewriteRel(leftJoin({ a: A }, { b: input as any }).on((r: any) => r.a.id.eq(r.b.id)).where((r: any) => r.b.id.gt(1)).ir).hits;
it('re-verification: fallibleWithin fences Decimal arithmetic, avg/argMax/quantile/uniqExact, subquery operands, union branches, CTEs and RawRel in an input', () => {
  const fenced: [string, { ir: Rel }][] = [
    ['Decimal plus (overflow raises 407)', D.map(r => ({ id: r.id, x: (r.d as any).plus(r.d) }))],
    ['Decimal sum (overflow)', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: sum(g.d) }))],
    ['avg over Decimal', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: avg(g.d as any) }))],
    ['avg over Int64 (conservative)', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: avg(g.n) }))],
    ['quantile with a level Param', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: quantile(1.5)(g.n) }))],
    ['argMax (conservative)', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: argMax(g.s, g.n) }))],
    ['uniqExact (conservative)', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ x: uniqExact(g.s) }))],
    ['Float arithmetic', D.map(r => ({ id: r.id, x: r.f.plus(1) }))],
    ['arrayElement, constant index', D.map(r => ({ id: r.id, x: (r.arr as any).arrayElement(5) }))],
    ['scalar subquery with a cast', D.map(r => ({ id: r.id, x: scalar(D.where(x => cast(x.s, col.UInt8).gt(0)).aggregate(() => ({ c: count() }))) }))],
    ['IN subquery in an input filter', D.where(r => r.id.in(D.map(x => ({ id: x.id }))))],
    ['union branch with a cast', unionAll(D.map(r => ({ id: r.id, s: r.s })), D.where(r => cast(r.s, col.UInt8).gt(0)).map(r => ({ id: r.id, s: r.s })))],
    ['CTE with a cast, also consumed elsewhere', D.map(r => ({ id: r.id, c: cast(r.s, col.UInt8) })).cte()],
  ];
  for (const [label, input] of fenced) {
    expect(fallibleWithin(input.ir), label).toBe(true);
    expect(overInput(input), label).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  }
  const raw = { ...D.ir, kind: 'RawRel', opaque: true, provenance: { origin: 'sql.relation' }, parts: ['SELECT 1'], args: [] } as unknown as Rel;
  expect(fallibleWithin(raw)).toBe(true);
  const total: [string, { ir: Rel }][] = [
    ['integer arithmetic (wraps)', D.map(r => ({ id: r.id, x: r.n.plus(1n).multiply(3n) }))],
    ['count/max(String)/uniq(String)/integer sum', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ c: count(), m: max(g.s), u: uniq(g.s), t: sum(g.n), lc: max(g.lc) }))],
    ['max over Decimal, Nullable (no row-dependent failure)', D.groupBy(r => ({ id: r.id })).aggregate(g => ({ m: max(g.d), k: max(g.k) }))],
    ['total filter, sort, limit, distinct, cte', D.where(r => r.n.gt(0n)).orderBy(r => r.n).limit(3).distinct().cte()],
  ];
  for (const [label, input] of total) {
    expect(fallibleWithin(input.ir), label).toBe(false);
    expect(overInput(input).LeftToInner, label).toBe(1);
  }
});
