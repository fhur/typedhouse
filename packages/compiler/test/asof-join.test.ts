import { describe, expect, it } from 'vitest';
import {
  asofJoin,
  asofLeftJoin,
  col,
  exprNode,
  from,
  join,
  relNode,
  table,
  type ExprNode,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import { rewriteRel } from '../src/rewrite-rel.js';

const trades = table(
  'trades',
  {
    id: col.UInt32,
    sym: col.String,
    ts: col.DateTime(),
    n: col.UInt32,
    lc: col.LowCardinality(col.UInt32),
    name: col.String,
    nts: col.Nullable(col.DateTime()),
  },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const quotes = table(
  'quotes',
  {
    sym: col.String,
    ts: col.DateTime(),
    n: col.UInt32,
    lc: col.LowCardinality(col.UInt32),
    name: col.String,
    uuid: col.UUID,
    flag: col.UInt8,
    bid: col.Float64,
    nts: col.Nullable(col.DateTime()),
  },
  { engine: 'MergeTree', sortingKey: ['sym', 'ts'], partitionKey: [] },
);

const pending = () => asofJoin({ t: from(trades) }, { q: from(quotes) });

const leftPending = () => asofLeftJoin({ t: from(trades) }, { q: from(quotes) });

const inner = () =>
  pending()
    .on(r => r.t.sym.eq(r.q.sym))
    .asof(r => r.t.ts.ge(r.q.ts));

const left = () =>
  leftPending()
    .on(r => r.t.sym.eq(r.q.sym))
    .asof(r => r.t.ts.ge(r.q.ts));

function joinOf(rel: Rel): Extract<Rel, { kind: 'Join' }> {
  let node = rel;
  while (node.kind !== 'Join') node = (node as Extract<Rel, { input: Rel }>).input;
  return node;
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof ValidationError ? error.code : String(error);
  }

  return 'no error';
}

describe('asofJoin builder', () => {
  it('builds a binary Join with the inequality last, not live', () => {
    const q = inner();
    expect(q.ir.kind).toBe('Join');
    const node = joinOf(q.ir);
    expect(node.strictness).toBe('asof');
    expect(node.joinKind).toBe('inner');
    expect(node.on.map(e => (e.kind === 'Call' ? e.fn.name : e.kind))).toEqual(['eq', 'ge']);
    expect(q.caps.live).toBe(false);
    expect(joinOf(left().ir).joinKind).toBe('left');
  });

  it('returns an intermediate from on() that is only asof()', () => {
    const on = pending().on(r => r.t.sym.eq(r.q.sym));
    expect(Object.keys(on)).toEqual(['asof']);
    expect(Object.keys(pending())).toEqual(['on']);
  });

  it('splits and accepts several equalities, keeping the inequality last', () => {
    const node = joinOf(
      pending()
        .on(r => [r.t.sym.eq(r.q.sym).and(r.t.name.eq(r.q.name)), r.t.n.eq(r.q.n)])
        .asof(r => r.q.ts.le(r.t.ts)).ir,
    );

    expect(node.on.map(e => (e.kind === 'Call' ? e.fn.name : e.kind))).toEqual([
      'eq',
      'eq',
      'eq',
      'le',
    ]);
  });

  it('refuses a non-equality, a one-input equality and nothing at all in on()', () => {
    expect(() => pending().on(r => r.t.ts.ge(r.q.ts))).toThrow(/join_condition_not_equi/);
    expect(() => pending().on(r => r.t.sym.ne(r.q.sym))).toThrow(/join_condition_not_equi/);
    expect(() => pending().on(r => r.q.flag.eq(1))).toThrow(/join_condition_arity/);
    expect(() => pending().on(r => r.t.n.eq(r.t.n))).toThrow(/join_condition_arity/);
    expect(() => pending().on(() => [])).toThrow(/join_condition_arity/);
    expect(() => pending().on(() => 'x' as never)).toThrow(/invalid_join_predicate/);
  });

  it('refuses an equality, a one-input inequality and a conjunction in asof()', () => {
    const on = () => pending().on(r => r.t.sym.eq(r.q.sym));
    expect(() => on().asof(r => r.t.n.eq(r.q.n))).toThrow(/invalid_asof_condition/);
    expect(() => on().asof(r => r.q.ts.ge(r.q.ts))).toThrow(/invalid_asof_condition/);
    expect(() => on().asof(r => r.q.n.ge(1))).toThrow(/invalid_asof_condition/);

    expect(() => on().asof(r => r.t.n.ge(r.q.n).and(r.t.n.le(r.q.n)))).toThrow(
      /invalid_asof_condition/,
    );

    expect(() => on().asof((() => [] as never) as never)).toThrow(/invalid_join_predicate/);
  });

  it('refuses the wrong arity and a repeated alias', () => {
    const call = asofJoin as unknown as (...args: unknown[]) => unknown;
    expect(() => call({ t: from(trades) })).toThrow(/outer_join_arity: asofJoin/);

    expect(() => call({ t: from(trades), q: from(quotes) }, { x: from(quotes) })).toThrow(
      /outer_join_arity/,
    );

    expect(() => call({ t: from(trades) }, { t: from(quotes) })).toThrow(/outer_join_alias/);
    expect(() => call({ t: 1 }, { q: from(quotes) })).toThrow(/invalid_join_input/);
  });

  it('keeps argument order for integer-like aliases', () => {
    const q = (asofJoin as unknown as (...args: unknown[]) => { ir: Rel })(
      { 1: from(trades) },
      { 0: from(quotes) },
    ) as unknown as {
      on(f: (r: never) => unknown): { asof(f: (r: never) => unknown): { ir: Rel } };
    };

    const ir = q
      .on((r: never) => (r as any)[1].sym.eq((r as any)[0].sym))
      .asof((r: never) => (r as any)[1].ts.ge((r as any)[0].ts)).ir;

    expect(joinOf(ir).inputs.map(([alias]) => alias)).toEqual(['1', '0']);
  });
});

describe('asofJoin SQL', () => {
  it('prints both keywords on both emitters, with the inequality in ON', () => {
    const planned = compile(inner().map(r => ({ id: r.t.id, bid: r.q.bid })).ir).sql;
    expect(planned).toContain('ASOF INNER JOIN');
    expect(planned).toMatch(/ON `t`\.`sym` = `q`\.`sym` AND `t`\.`ts` >= `q`\.`ts`/);
    expect(planned).not.toContain('join_use_nulls');

    const naive = emitNaive(inner().map(r => ({ id: r.t.id, bid: r.q.bid })).ir).sql;
    expect(naive).toContain('ASOF INNER JOIN');
    expect(naive).toMatch(/greaterOrEquals\(`t`\.`ts`, `q`\.`ts`\)/);

    const outerPlanned = compile(left().map(r => ({ bid: r.q.bid })).ir).sql;
    expect(outerPlanned).toContain('ASOF LEFT JOIN');
    expect(outerPlanned).toContain('join_use_nulls = 1');
    const outerNaive = emitNaive(left().map(r => ({ bid: r.q.bid })).ir).sql;
    expect(outerNaive).toContain('ASOF LEFT JOIN');
    expect(outerNaive).toContain('join_use_nulls = 1');
  });

  it('numbers parameters in text order, input filters first', () => {
    const q = asofJoin(
      { t: from(trades).where(r => r.name.eq('first')) },
      { q: from(quotes).where(r => r.name.eq('second')) },
    )
      .on(r => r.t.name.length().plus(3n).eq(r.q.name.length().plus(4n)))
      .asof(r => r.t.n.plus(5).ge(r.q.n.plus(6)))
      .map(r => ({ id: r.t.id }));

    for (const emitted of [compile(q.ir), emitNaive(q.ir)]) {
      const order = [...emitted.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]);
      expect(order).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);

      expect(Object.values(emitted.params)).toEqual(['first', 'second', '3', '4', '5', '6']);
    }
  });
});

describe('asofJoin rewrite fences', () => {
  const hits = (rel: Rel) => rewriteRel(rel).hits;

  it('leaves a right-side filter above ASOF INNER', () => {
    const q = inner().where(r => r.q.flag.eq(1));
    const { root, hits: h } = rewriteRel(q.ir);
    expect(h.PushFilterJoin).toBe(0);
    expect(root.kind).toBe('Filter');
    expect(joinOf(root).inputs[1]![1].kind).toBe('Scan');
    expect(compile(q.ir).sql).toMatch(/WHERE \(`q`\.`flag` = /);
  });

  it('leaves a right-side filter above ASOF LEFT, with no LeftToInner', () => {
    const q = left().where(r => r.q.flag.eq(1));
    const { root, hits: h } = rewriteRel(q.ir);
    expect(h.PushFilterJoin).toBe(0);
    expect(h.LeftToInner).toBe(0);
    expect(joinOf(root).joinKind).toBe('left');
    expect(joinOf(root).strictness).toBe('asof');
    expect(compile(q.ir).sql).toContain('ASOF LEFT JOIN');
  });

  it('moves a left-side conjunct below on either kind, also over a DateTime inequality', () => {
    for (const q of [inner(), left()]) {
      const filtered = q.where(r => r.t.sym.eq('A'));
      const { root, hits: h } = rewriteRel(filtered.ir);
      expect(h.PushFilterJoin).toBe(1);
      expect(root.kind).toBe('Join');
      const node = joinOf(root);
      expect(node.strictness).toBe('asof');
      expect(node.inputs[0]![1].kind).toBe('Filter');
      expect(node.inputs[1]![1].kind).toBe('Scan');

      expect(
        node.on.at(-1)!.kind === 'Call' && (node.on.at(-1) as { fn: { name: string } }).fn.name,
      ).toBe('ge');

      expect(compile(filtered.ir).sql).toContain('ASOF');
    }
  });

  it('splits a conjunction: the left part moves, the right part stays', () => {
    const q = inner().where(r => r.t.sym.eq('A').and(r.q.flag.eq(1)));
    const { root, hits: h } = rewriteRel(q.ir);
    expect(h.PushFilterJoin).toBe(1);
    expect(root.kind).toBe('Filter');
    expect(joinOf(root).inputs[0]![1].kind).toBe('Filter');
    expect(joinOf(root).inputs[1]![1].kind).toBe('Scan');
  });

  it('keeps strictness through rebuilding an input and through a subquery input', () => {
    const shifted = asofJoin(
      {
        t: from(trades)
          .where(r => r.id.gt(1))
          .where(r => r.id.lt(9)),
      },
      { q: from(quotes) },
    )
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts));

    const { root, hits: h } = rewriteRel(shifted.ir);
    expect(h.MergeFilter).toBe(1);
    expect(root).not.toBe(shifted.ir);
    expect(joinOf(root).strictness).toBe('asof');
    expect(compile(shifted.map(r => ({ id: r.t.id })).ir).sql).toContain('ASOF INNER JOIN');

    const over = join({ a: shifted.map(r => ({ id: r.t.id })), b: from(trades) })
      .on(r => r.a.id.eq(r.b.id))
      .where(r => r.b.sym.eq('A'))
      .map(r => r.a.id);

    expect(compile(over.ir).sql).toContain('ASOF INNER JOIN');
  });

  it('never changes the inequality position or a plain join', () => {
    const plain = join({ t: from(trades), q: from(quotes) })
      .on(r => r.t.sym.eq(r.q.sym))
      .where(r => r.q.flag.eq(1));

    expect(hits(plain.ir).PushFilterJoin).toBe(1);
    expect(compile(plain.ir).sql).toContain('INNER ALL JOIN');
  });

  it('folds into a join block on bare columns and nests on expressions', () => {
    const bare = compile(inner().ir).sql;
    expect(bare).toContain('FROM `trades` AS `t`\nASOF INNER JOIN `quotes` AS `q` ON ');

    const computed = compile(
      pending()
        .on(r => r.t.sym.eq(r.q.sym))
        .asof(r => r.t.n.plus(5).ge(r.q.n.plus(0)))
        .map(r => ({ id: r.t.id })).ir,
    ).sql;

    expect(computed).toContain('ASOF INNER JOIN');
    expect(computed).toMatch(/`t`\.`n` \+ \{p0:\w+\}|plus\(`t`\.`n`/);
  });
});

describe('asofJoin validation', () => {
  const scope = joinOf(inner().ir);

  const forged = (fields: Partial<Record<string, unknown>>): Rel => {
    const { id: _id, ...own } = scope;
    return relNode({ ...own, ...fields } as never) as Rel;
  };

  const both = (rel: Rel) => [codeOf(() => compile(rel)), codeOf(() => emitNaive(rel))];

  it('rejects forged strictness, kinds and inputs on both emitters', () => {
    expect(both(forged({ strictness: 'any' }))).toEqual(Array(2).fill('invalid_asof_condition'));

    for (const joinKind of ['right', 'full', 'cross'])
      expect(both(forged({ joinKind }))[1]).toBe('invalid_asof_condition');

    const three = forged({
      inputs: [...scope.inputs, ['x', from(trades).ir]],
    });

    expect(both(three)).toEqual(Array(2).fill('invalid_asof_condition'));
  });

  it('rejects a forged ON on both emitters', () => {
    const [eq, ge] = scope.on;
    expect(both(forged({ on: [ge] }))).toEqual(Array(2).fill('invalid_asof_condition'));
    expect(both(forged({ on: [] }))).toEqual(Array(2).fill('invalid_asof_condition'));
    expect(both(forged({ on: [eq, eq] }))).toEqual(Array(2).fill('invalid_asof_condition'));
    expect(both(forged({ on: [ge, eq] }))).toEqual(Array(2).fill('invalid_asof_condition'));
    expect(both(forged({ on: [ge, ge] }))).toEqual(Array(2).fill('join_condition_not_equi'));
  });

  it('rejects a one-input inequality that bypassed the builder', () => {
    const { id: _id, ...ge } = scope.on[1] as Extract<ExprNode, { kind: 'Call' }>;
    const oneInput = exprNode({ ...ge, args: [ge.args[0]!, ge.args[0]!] });

    expect(both(forged({ on: [scope.on[0], oneInput] }))).toEqual(
      Array(2).fill('invalid_asof_condition'),
    );
  });

  it('rejects a mismatched output', () => {
    expect(both(forged({ output: joinOf(left().ir).output }))).toEqual(
      Array(2).fill('invalid_output'),
    );
  });

  const type = (f: (r: never) => never) =>
    codeOf(() =>
      compile(
        (
          pending().on(r => r.t.sym.eq(r.q.sym)) as unknown as { asof(f: unknown): { ir: Rel } }
        ).asof(f).ir,
      ),
    );

  it('refuses inequality types the server refuses', () => {
    expect(type(((r: any) => r.t.name.ge(r.q.name)) as never)).toBe('invalid_asof_type');
    expect(type(((r: any) => r.t.lc.ge(r.q.lc)) as never)).toBe('invalid_asof_type');
  });

  it('accepts LowCardinality on one side, and Nullable on either', () => {
    const q = pending()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.lc.ge(r.q.n));

    expect(compile(q.ir).sql).toContain('ASOF INNER JOIN');

    const n = pending()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.nts.ge(r.q.nts));

    expect(compile(n.ir).sql).toContain('ASOF INNER JOIN');
  });
});
