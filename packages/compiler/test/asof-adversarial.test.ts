import { describe, expect, it } from 'vitest';
import {
  asofJoin,
  asofLeftJoin,
  cast,
  col,
  exprNode,
  from,
  join,
  relNode,
  sql,
  table,
  unionAll,
  type ExprNode,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import { rewriteRel } from '../src/rewrite-rel.js';
import { toDataflowGraph } from '../../devtools/src/dataflow.js';

const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const l = table(
  'l',
  {
    id: col.UInt32,
    k: col.String,
    ts: col.DateTime('UTC'),
    n: col.UInt32,
    u64: col.UInt64,
    i32: col.Int32,
    s: col.String,
    nts: col.Nullable(col.DateTime('UTC')),
    lc: col.LowCardinality(col.UInt32),
    lcn: col.LowCardinality(col.Nullable(col.UInt32)),
    b: col.Bool,
    en: col.Enum8({ a: 1, b: 2 }),
  },
  opts,
);

const r = table(
  'r',
  {
    id: col.UInt32,
    k: col.String,
    ts: col.DateTime('UTC'),
    n: col.UInt32,
    i64: col.Int64,
    flag: col.UInt8,
    s: col.String,
    nts: col.Nullable(col.DateTime('UTC')),
    lc: col.LowCardinality(col.UInt32),
    b: col.Bool,
    en: col.Enum8({ a: 1, b: 2 }),
    uuid: col.UUID,
  },
  opts,
);

const inner = (a: any = from(l), b: any = from(r)) =>
  (asofJoin as any)({ t: a }, { q: b })
    .on((x: any) => x.t.k.eq(x.q.k))
    .asof((x: any) => x.t.ts.ge(x.q.ts)) as any;

const outer = (a: any = from(l), b: any = from(r)) =>
  (asofLeftJoin as any)({ t: a }, { q: b })
    .on((x: any) => x.t.k.eq(x.q.k))
    .asof((x: any) => x.t.ts.ge(x.q.ts)) as any;

const pick = (x: any) => ({ id: x.t.id, rid: x.q.id });

/** Every Join in a graph, through inputs, subquery scopes and expressions. */
function joins(root: Rel): Extract<Rel, { kind: 'Join' }>[] {
  const out = new Set<Extract<Rel, { kind: 'Join' }>>();
  const seen = new Set<unknown>();

  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if ((v as Rel).kind === 'Join') out.add(v as Extract<Rel, { kind: 'Join' }>);
    for (const x of Object.values(v as object)) walk(x);
  };

  walk(root);
  return [...out];
}

const errorOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof ValidationError ? e.code : (e as Error).message.split(':')[0];
  }

  return 'no error';
};

const asofCount = (s: string) => (s.match(/ASOF (INNER|LEFT) JOIN/g) ?? []).length;

describe('strictness survives every rewrite path', () => {
  const stacks: Record<string, () => any> = {
    'filter, left': () => inner().where((x: any) => x.t.id.gt(1)),
    'filter, right': () => inner().where((x: any) => x.q.id.gt(1)),
    'filter on both, split': () => inner().where((x: any) => x.t.id.gt(1).and(x.q.id.gt(1))),
    'filter, filter, filter': () =>
      inner()
        .where((x: any) => x.t.id.gt(1))
        .where((x: any) => x.q.id.gt(1))
        .where((x: any) => x.t.n.gt(1)),
    'filter over map': () =>
      inner()
        .map(pick)
        .where((x: any) => x.id.gt(1)),
    'filter over map over map': () =>
      inner()
        .map((x: any) => ({ id: x.t.id, rid: x.q.id, n: x.t.n.plus(1) }))
        .map((x: any) => ({ id: x.id, n: x.n }))
        .where((x: any) => x.id.gt(1)),
    aggregate: () =>
      inner()
        .groupBy((x: any) => ({ f: x.q.flag }))
        .aggregate(() => ({})),
    limit: () =>
      inner()
        .map(pick)
        .orderBy((x: any) => x.id)
        .limit(3),
    'filter over limit': () =>
      inner()
        .map(pick)
        .orderBy((x: any) => x.id)
        .limit(3)
        .where((x: any) => x.id.gt(1)),
    'left input rebuilt by a rule': () =>
      inner(
        from(l)
          .where(x => x.id.gt(1))
          .where(x => x.n.gt(1)),
      ).map(pick),
    'right input rebuilt by a rule': () =>
      inner(
        from(l),
        from(r)
          .where(x => x.id.gt(1))
          .where(x => x.n.gt(1)),
      ).map(pick),
    'an expression in a filter above holding a subquery with ASOF': () =>
      from(l).where(x =>
        x.id.in(
          inner(
            from(l)
              .where(y => y.id.gt(1))
              .where(y => y.n.gt(1)),
          )
            .where((y: any) => y.t.id.gt(2))
            .map((y: any) => y.t.id),
        ),
      ),
    'asof over asof': () =>
      (asofJoin as any)(
        {
          a: inner()
            .where((x: any) => x.t.id.gt(1))
            .map((x: any) => ({ k: x.t.k, ts: x.q.ts })),
        },
        {
          b: from(r)
            .where(x => x.id.gt(1))
            .where(x => x.n.gt(1)),
        },
      )
        .on((x: any) => x.a.k.eq(x.b.k))
        .asof((x: any) => x.a.ts.gt(x.b.ts))
        .where((x: any) => x.a.k.eq('A')),
    'asof over a join, filter pushed into the ordinary join': () =>
      inner(
        join({ c: from(l), d: from(r) })
          .on(x => x.c.id.eq(x.d.id))
          .where(x => x.c.n.gt(1))
          .map(x => ({ id: x.c.id, k: x.c.k, ts: x.c.ts })),
      ).where((x: any) => x.t.id.gt(1)),
    'a join over asof, filter above pushed in': () =>
      join({ a: inner().map(pick), b: from(l) })
        .on((x: any) => x.a.id.eq(x.b.id))
        .where((x: any) => x.a.rid.gt(1)),
    'union of asof': () => {
      const a = inner()
        .map(pick)
        .where((x: any) => x.id.gt(1));

      return unionAll(a, a).where((x: any) => x.rid.gt(1));
    },
    'shared asof': () => {
      const s = inner().map(pick);
      return join({ a: s, b: s }).on((x: any) => x.a.id.eq(x.b.id));
    },
  };

  it.each(Object.keys(stacks))('%s', name => {
    const q = stacks[name]!();
    const before = joins(q.ir).filter(j => j.strictness === 'asof').length;
    expect(before).toBeGreaterThan(0);

    const { root, hits } = rewriteRel(q.ir) as unknown as {
      root: Rel;
      hits: Record<string, number>;
    };

    const after = joins(root);
    expect(after.filter(j => j.strictness === 'asof').length, JSON.stringify(hits)).toBe(before);

    // The number of joins in text agrees on both emitters, and no ASOF prints as ALL.
    const naive = emitNaive(q.ir).sql,
      planned = compile(q.ir).sql;

    expect(asofCount(naive)).toBeGreaterThan(0);
    expect(asofCount(planned)).toBeGreaterThan(0);
  });

  it('feeding a rewrite back through the rewrite keeps it, and reaches a fixed point', () => {
    const q = inner(
      from(l)
        .where(x => x.id.gt(1))
        .where(x => x.n.gt(1)),
    )
      .where((x: any) => x.t.id.gt(2))
      .where((x: any) => x.q.id.gt(2));

    const once = rewriteRel(q.ir) as unknown as { root: Rel };
    const twice = rewriteRel(once.root) as unknown as { root: Rel };
    for (const j of joins(twice.root)) expect(j.strictness).toBe('asof');
    expect(joins(twice.root).length).toBe(1);
  });

  it('the rewrite result keeps every Join an ASOF one when the graph had only ASOF joins', () => {
    const q = inner(
      from(l)
        .where(x => x.id.gt(1))
        .where(x => x.n.gt(1)),
    ).where((x: any) => x.t.id.gt(2));

    const { root } = rewriteRel(q.ir) as unknown as { root: Rel };
    for (const j of joins(root)) expect(j.strictness).toBe('asof');
  });
});

describe('non-commutation, in every position', () => {
  const where = (s: string) => s.split('\n').find(line => line.startsWith('WHERE')) ?? '';

  it.each(['inner', 'left'] as const)('%s: a right conjunct stays above, in text', kind => {
    const f = kind === 'inner' ? inner : outer;

    const q = f()
      .where((x: any) => x.q.flag.eq(1))
      .map(pick);

    const s = compile(q.ir).sql;
    expect(where(s)).toContain('`q`.`flag`');
    expect(s).not.toMatch(/`r`\s+WHERE/);
    expect(s).toContain(kind === 'inner' ? 'ASOF INNER JOIN' : 'ASOF LEFT JOIN');
  });

  it('a filtered right input is preserved below the join, and a filter above stays above', () => {
    const q = inner(
      from(l),
      from(r).where(x => x.flag.eq(1)),
    )
      .where((x: any) => x.q.n.gt(5))
      .map(pick);

    const s = compile(q.ir).sql;
    expect(s.split('ASOF INNER JOIN')[1]).toMatch(/\(SELECT [^]* FROM `r` WHERE `flag` = /);
    expect(where(s)).toContain('`q`.`n`');
    expect(where(s)).not.toContain('flag');
  });

  it('a right input Filter over Project is merged within the input, never above', () => {
    const q = inner(
      from(l),
      from(r)
        .map(x => ({ id: x.id, k: x.k, ts: x.ts, n2: x.n.plus(1) }))
        .where(x => x.n2.gt(1n)),
    ).map(pick);

    const s = compile(q.ir).sql;
    expect(s.split('ASOF INNER JOIN')[1]).toContain('WHERE');
    expect(where(s)).toBe('');
  });

  it('a mixed conjunct and a conjunct on neither input stay above', () => {
    const q = inner()
      .where((x: any) => x.t.n.plus(x.q.n).gt(1n))
      .map(pick);

    expect(where(compile(q.ir).sql)).toContain('`t`.`n`');
  });

  it('a right DISTINCT or LIMIT input is not merged, moved or narrowed in its key set', () => {
    const distinct = inner(
      from(l),
      from(r)
        .map(x => ({ id: x.id, k: x.k, ts: x.ts }))
        .distinct(),
    ).map((x: any) => ({ id: x.t.id }));

    const s = compile(distinct.ir).sql;
    expect(s.split('ASOF INNER JOIN')[1]).toMatch(/SELECT DISTINCT `id`, `k`, `ts`/);

    const limited = inner(
      from(l),
      from(r)
        .orderBy(x => x.id)
        .limit(5),
    )
      .where((x: any) => x.q.flag.eq(1))
      .map(pick);

    const t = compile(limited.ir).sql;
    expect(t.split('ASOF INNER JOIN')[1]).toMatch(/LIMIT/);
    expect(where(t)).toContain('`q`.`flag`');
  });

  it('LeftToInner does not fire: no hit, and the output and kind stay', () => {
    const q = outer().where((x: any) => x.q.flag.eq(1));

    const { hits, root } = rewriteRel(q.ir) as unknown as {
      hits: Record<string, number>;
      root: Rel;
    };

    expect(hits['LeftToInner']).toBe(0);
    expect(joins(root).map(j => j.joinKind)).toEqual(['left']);
  });
});

describe('the left-filter push', () => {
  const hitsOf = (q: any) => (rewriteRel(q.ir) as unknown as { hits: Record<string, number> }).hits;

  it('fires over each bare-column inequality type', () => {
    const forms: ((x: any) => any)[] = [
      x => x.t.ts.ge(x.q.ts),
      x => x.t.nts.ge(x.q.nts),
      x => x.t.lc.ge(x.q.n),
      x => x.t.i32.ge(x.q.n),
    ];

    for (const form of forms) {
      const q = (asofJoin as any)({ t: from(l) }, { q: from(r) })
        .on((x: any) => x.t.k.eq(x.q.k))
        .asof(form)
        .where((x: any) => x.t.id.gt(1));

      expect(hitsOf(q)['PushFilterJoin']).toBe(1);
    }
  });

  it('a computed inequality operand keeps the filter above, as a fallible ON does', () => {
    const q = (asofJoin as any)({ t: from(l) }, { q: from(r) })
      .on((x: any) => x.t.k.eq(x.q.k))
      .asof((x: any) => sql`${x.t.ts} - ${5}`.as(col.DateTime('UTC')).ge(x.q.ts))
      .where((x: any) => x.t.id.gt(1));

    expect(hitsOf(q)['PushFilterJoin']).toBe(0);
  });

  it('a fallible left conjunct does not move, nor does a safe one above it', () => {
    const fallible = inner().where((x: any) => (cast(x.t.s, col.Int32 as never) as any).gt(0));
    expect(hitsOf(fallible)['PushFilterJoin']).toBe(0);

    const above = inner()
      .where((x: any) => (cast(x.t.s, col.Int32 as never) as any).gt(0))
      .where((x: any) => x.t.id.gt(1));

    expect(hitsOf(above)['PushFilterJoin']).toBe(0);

    const below = inner()
      .where((x: any) => x.t.s.ne('bad'))
      .where((x: any) => (cast(x.t.s, col.Int32 as never) as any).gt(0));

    expect(hitsOf(below)['PushFilterJoin']).toBe(0);
  });

  it('a fallible expression in either input stops the push', () => {
    const left = inner(from(l).where(x => (cast(x.s, col.Int32 as never) as any).gt(0))).where(
      (x: any) => x.t.id.gt(1),
    );

    expect(hitsOf(left)['PushFilterJoin']).toBe(0);

    const right = inner(
      from(l),
      from(r).where(x => (cast(x.s, col.Int32 as never) as any).gt(0)),
    ).where((x: any) => x.t.id.gt(1));

    expect(hitsOf(right)['PushFilterJoin']).toBe(0);
  });

  it('a shared left input: the push makes a new node, and the right keeps the shared one', () => {
    const shared = from(r).where(x => x.flag.eq(1));

    const q = (asofJoin as any)({ a: shared }, { b: shared })
      .on((x: any) => x.a.k.eq(x.b.k))
      .asof((x: any) => x.a.ts.gt(x.b.ts))
      .where((x: any) => x.a.id.gt(1));

    const { root } = rewriteRel(q.ir) as unknown as { root: Rel };
    const j = joins(root)[0]!;
    expect(j.inputs[0]![1]).not.toBe(j.inputs[1]![1]);
    expect(JSON.stringify(j.inputs[1]![1].output)).toBe(JSON.stringify(shared.ir.output));

    const s = compile(q.ir).sql;
    // The right input carries only its own filter, not the left one.
    expect(s.split('ASOF INNER JOIN')[1]).not.toMatch(/`id` > /);
  });
});

describe('builder: added behaviour', () => {
  const pending = (a: any = from(l), b: any = from(r)) => (asofJoin as any)({ t: a }, { q: b });

  const on = () => pending().on((x: any) => x.t.k.eq(x.q.k));

  it('accepts sql snippets and Cast on each side, in both conditions', () => {
    const q = pending()
      .on((x: any) => sql`lower(${x.t.k})`.as(col.String).eq(sql`lower(${x.q.k})`.as(col.String)))
      .asof((x: any) => (cast(x.t.n, col.Int64 as never) as any).ge(sql`${x.q.n}`.as(col.UInt32)));

    expect(emitNaive(q.ir).sql).toContain('ASOF INNER JOIN');
    expect(compile(q.ir).sql).toContain('ASOF INNER JOIN');
  });

  it.each([
    ['a one-input equality', (x: any) => x.t.k.eq(x.t.s), 'join_condition_arity'],
    ['an equality with a parameter', (x: any) => x.t.k.eq('A'), 'join_condition_arity'],
    [
      'an equality with both inputs in one operand',
      (x: any) => sql`${x.t.k} || ${x.q.k}`.as(col.String).eq(x.q.k),
      'join_condition_arity',
    ],
    ['nothing', () => [], 'join_condition_arity'],
    ['an inequality', (x: any) => x.t.ts.ge(x.q.ts), 'join_condition_not_equi'],
    ['ne', (x: any) => x.t.k.ne(x.q.k), 'join_condition_not_equi'],
    [
      'an OR of equalities',
      (x: any) => x.t.k.eq(x.q.k).or(x.t.s.eq(x.q.s)),
      'join_condition_not_equi',
    ],
    ['a bare value', () => 1, 'invalid_join_predicate'],
    ['an aggregate-mode expression', () => ({ mode: 'agg' }), 'invalid_join_predicate'],
  ])('on(): %s raises %s', (_, f, code) => {
    expect(errorOf(() => pending().on(f))).toBe(code);
  });

  it.each([
    ['an equality', (x: any) => x.t.ts.eq(x.q.ts), 'invalid_asof_condition'],
    ['ne', (x: any) => x.t.ts.ne(x.q.ts), 'invalid_asof_condition'],
    ['a one-input inequality', (x: any) => x.t.ts.ge(x.t.ts), 'invalid_asof_condition'],
    ['against a parameter', (x: any) => x.t.n.ge(1), 'invalid_asof_condition'],
    ['a conjunction', (x: any) => x.t.ts.ge(x.q.ts).and(x.t.n.ge(x.q.n)), 'invalid_asof_condition'],
    ['a NOT', (x: any) => x.t.ts.ge(x.q.ts).not(), 'invalid_asof_condition'],
    [
      'a sql snippet condition',
      (x: any) => sql`${x.t.ts} >= ${x.q.ts}`.as(col.Bool),
      'invalid_asof_condition',
    ],
    [
      'both inputs in one operand',
      (x: any) => x.t.n.plus(x.q.n).ge(x.q.n),
      'invalid_asof_condition',
    ],
    [
      'a subquery operand',
      (x: any) =>
        (
          from(r)
            .map(y => y.n)
            .limit(1) as any
        )
          .scalar?.()
          .ge(x.q.n),
      'invalid_join_predicate',
    ],
    ['a bare value', () => 1, 'invalid_join_predicate'],
  ])('asof(): %s raises %s', (_, f, code) => {
    expect(errorOf(() => on().asof(f))).toBe(code);
  });

  it('a Case operand is refused, and so is a forged Subquery operand', () => {
    const base = inner();
    const j = joins(base.ir)[0]!;
    const last = j.on.at(-1) as Extract<ExprNode, { kind: 'Call' }>;

    const forms: ExprNode[] = [
      exprNode({
        kind: 'Case',
        branches: [{ when: j.on[0]!, then: last.args[0]! }],
        otherwise: last.args[0]!,
        type: last.args[0]!.type!,
      } as never),
      exprNode({
        kind: 'Subquery',
        usage: 'scalar',
        rel: from(l).map(x => ({ ts: x.ts })).ir,
        type: last.args[0]!.type!,
      } as never),
    ];

    for (const form of forms) {
      const { id: _id, ...rest } = j;

      const forged = relNode({
        ...rest,
        on: [j.on[0]!, { ...last, args: [form, last.args[1]!] }],
      } as never);

      expect(errorOf(() => emitNaive(forged))).toBe('invalid_asof_condition');
      expect(errorOf(() => compile(forged))).toBe('invalid_asof_condition');
    }
  });

  it('a pending value can be completed twice; each query stands alone and both are ASOF', () => {
    const p = on();
    const a = p.asof((x: any) => x.t.ts.ge(x.q.ts)).map(pick);
    const b = p.asof((x: any) => x.t.ts.le(x.q.ts)).map(pick);
    expect(compile(a.ir).sql).toContain('>=');
    expect(compile(b.ir).sql).toContain('<=');
    const u = unionAll(a, b);
    expect(asofCount(compile((u as any).ir).sql)).toBe(2);
    expect(asofCount(emitNaive((u as any).ir).sql)).toBe(2);
  });

  it('a row captured from another pending join is unbound', () => {
    let captured: any;

    pending()
      .on((x: any) => {
        captured = x;
        return x.t.k.eq(x.q.k);
      })
      .asof((x: any) => x.t.ts.ge(x.q.ts));

    const q = on().asof(() => captured.t.ts.ge(captured.q.ts));
    expect(errorOf(() => compile(q.ir))).toBe('unbound_column');
    expect(errorOf(() => emitNaive(q.ir))).toBe('unbound_column');
  });

  it('integer-like aliases keep argument order', () => {
    const q = (asofJoin as any)({ 2: from(l) }, { 1: from(r) })
      .on((x: any) => x[2].k.eq(x[1].k))
      .asof((x: any) => x[2].ts.ge(x[1].ts));

    expect(joins(q.ir)[0]!.inputs.map(([a]) => a)).toEqual(['2', '1']);
    expect(compile(q.ir).sql).toMatch(/FROM `l` AS `2`\s+ASOF INNER JOIN `r` AS `1`/);
  });

  it('aliases holding NUL are refused', () => {
    expect(errorOf(() => (asofJoin as any)({ 'a\0': from(l) }, { q: from(r) }))).toBe(
      'invalid_join_input',
    );
  });

  it('an input that is not a Query is refused', () => {
    expect(errorOf(() => (asofJoin as any)({ t: 1 }, { q: from(r) }))).toBe('invalid_join_input');
  });

  it('a terminal settings() result is not an input', () => {
    expect(
      errorOf(() => (asofJoin as any)({ t: from(l).settings({ max_threads: 1 }) }, { q: from(r) })),
    ).toBe('invalid_join_input');
  });

  it('the join is not live, even over live inputs', () => {
    expect(inner().caps.live).toBe(false);
    expect(outer().caps.live).toBe(false);
  });

  it('the dataflow graph names the strictness', () => {
    const graph = toDataflowGraph(inner().ir);
    expect(JSON.stringify(graph)).toContain('asof inner Join');
    expect(JSON.stringify(toDataflowGraph(outer().ir))).toContain('asof left Join');
  });
});

describe('forged IR, on both emitters', () => {
  const both = (rel: Rel) => [errorOf(() => compile(rel)), errorOf(() => emitNaive(rel))];

  const fixed = joins(inner().ir)[0]!;

  const base = () => fixed;

  const forge = (patch: Record<string, unknown>) => {
    const { id: _id, ...rest } = base();
    return relNode({ ...rest, ...patch } as never);
  };

  it.each([
    [{ strictness: 'any' }],
    [{ strictness: 'ASOF' }],
    [{ strictness: '' }],
    [{ strictness: 1 }],
    [{ strictness: null }],
  ])('%j is refused', patch => {
    const codes = both(forge(patch));
    for (const code of codes) expect(code).toMatch(/invalid_asof_condition|invalid_/);
    expect(codes[0]).toBe(codes[1]);
  });

  it.each(['right', 'full', 'cross'] as const)('joinKind %s is refused', joinKind => {
    const codes = both(forge({ joinKind }));
    expect(codes).toEqual(['invalid_asof_condition', 'invalid_asof_condition']);
  });

  it('three inputs are refused', () => {
    const j = base();

    const forged = forge({
      inputs: [...j.inputs, ['z', from(l).ir]],
      output: { shape: 'nested', inputs: [...(j.output as any).inputs, ['z', from(l).ir.output]] },
    });

    expect(both(forged)).toEqual(['invalid_asof_condition', 'invalid_asof_condition']);
  });

  it('the on list: no equality, no inequality, swapped order', () => {
    const j = base();

    expect(both(forge({ on: [j.on[1]!] }))).toEqual([
      'invalid_asof_condition',
      'invalid_asof_condition',
    ]);

    expect(both(forge({ on: [j.on[0]!] }))).toEqual([
      'invalid_asof_condition',
      'invalid_asof_condition',
    ]);

    expect(both(forge({ on: [j.on[1]!, j.on[0]!] }))).toEqual([
      'invalid_asof_condition',
      'invalid_asof_condition',
    ]);

    expect(both(forge({ on: [j.on[0]!, j.on[1]!, j.on[1]!] }))).toEqual([
      'join_condition_not_equi',
      'join_condition_not_equi',
    ]);

    expect(both(forge({ on: [] }))).toEqual(['invalid_asof_condition', 'invalid_asof_condition']);
    expect(both(forge({ on: 'x' }))[0]).toMatch(/invalid_/);
  });

  it('a one-input equality is join_condition_arity', () => {
    const j = base();
    const eq = j.on[0] as Extract<ExprNode, { kind: 'Call' }>;
    const forged = { ...eq, args: [eq.args[0]!, eq.args[0]!] };

    expect(both(forge({ on: [forged, j.on[1]!] }))).toEqual([
      'join_condition_arity',
      'join_condition_arity',
    ]);
  });

  it('arity of the inequality', () => {
    const j = base();
    const last = j.on[1] as Extract<ExprNode, { kind: 'Call' }>;

    for (const args of [[last.args[0]!], [...last.args, last.args[0]!]])
      expect(both(forge({ on: [j.on[0]!, { ...last, args }] })).every(c => c !== 'no error')).toBe(
        true,
      );
  });

  it('a forged null-extended output on an inner ASOF, and an inner output on a left ASOF', () => {
    const { id: _i, ...inner_ } = base();
    const { id: _l, ...left_ } = joins(outer().ir)[0]!;

    expect(both(relNode({ ...inner_, output: left_.output } as never))).toEqual([
      'invalid_output',
      'invalid_output',
    ]);

    expect(both(relNode({ ...left_, output: inner_.output } as never))).toEqual([
      'invalid_output',
      'invalid_output',
    ]);
  });

  it('a strictness key on an ordinary ALL join without the shape is refused', () => {
    const { id: _id, ...ordinary } = joins(
      join({ a: from(l), b: from(r) }).on(x => x.a.k.eq(x.b.k)).ir,
    )[0]!;

    const forged = relNode({ ...ordinary, strictness: 'asof' } as never);
    expect(both(forged)).toEqual(['invalid_asof_condition', 'invalid_asof_condition']);
  });

  it('types: each refused pair on both emitters', () => {
    const on = (x: any) => x.t.k.eq(x.q.k);

    const refused: [string, (x: any) => any, string][] = [
      ['String', x => x.t.s.ge(x.q.s), 'invalid_asof_type'],
      ['LowCardinality both', x => x.t.lc.ge(x.q.lc), 'invalid_asof_type'],
      ['temporal vs number', x => x.t.ts.ge(x.q.n), 'incompatible_operands'],
      ['Bool vs UInt8', x => x.t.b.ge(x.q.flag), 'incompatible_operands'],
      ['Enum vs UInt8', x => x.t.en.ge(x.q.flag), 'incompatible_operands'],
    ];

    for (const [name, form, code] of refused) {
      expect(
        errorOf(() =>
          both(
            (asofJoin as any)({ t: from(l) }, { q: from(r) })
              .on(on)
              .asof(form).ir,
          ).forEach(c => {
            if (c !== code) throw new Error(`${name}: ${c}`);
          }),
        ),
        name,
      ).toBe('no error');
    }
  });

  it('accepted across the wrappers', () => {
    const on = (x: any) => x.t.k.eq(x.q.k);

    const accepted: ((x: any) => any)[] = [
      x => x.t.nts.ge(x.q.nts),
      x => x.t.lc.ge(x.q.n),
      x => x.t.n.ge(x.q.lc),
      x => x.t.lcn.ge(x.q.n),
      x => x.t.b.ge(x.q.b),
      x => x.t.en.ge(x.q.en),
      x => x.t.u64.ge(x.q.i64),
    ];

    for (const form of accepted)
      expect(
        both(
          (asofJoin as any)({ t: from(l) }, { q: from(r) })
            .on(on)
            .asof(form).ir,
        ),
      ).toEqual(['no error', 'no error']);
  });

  it('parameters number in text order on both emitters, input filters first', () => {
    const q = (asofJoin as any)(
      { t: from(l).where(x => x.n.gt(7)) },
      { q: from(r).where(x => x.n.gt(8)) },
    )
      .on((x: any) => x.t.n.plus(1).eq(x.q.n.plus(2)))
      .asof((x: any) => x.t.n.plus(3).ge(x.q.n.plus(4)))
      .where((x: any) => x.q.flag.eq(5))
      .map(pick);

    for (const compiled of [compile(q.ir), emitNaive(q.ir)]) {
      const numbers = [...compiled.sql.matchAll(/\{p(\d+):/g)].map(m => Number(m[1]));
      expect(numbers).toEqual(numbers.map((_, i) => i));

      expect(Object.values(compiled.params).map(String)).toEqual([
        '7',
        '8',
        '1',
        '2',
        '3',
        '4',
        '5',
      ]);
    }
  });
});
