import { expect, it } from 'vitest';
import { cast, col, count, from, sql, table, unionAll, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { structure } from './explain-corpus-support.js';

const t = from(
  table(
    'project_limit',
    { id: col.UInt32, n: col.Int64, s: col.String, nullable: col.Nullable(col.String) },
    { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
  ),
);

const selects = (q: { ir: Parameters<typeof compile>[0] }) =>
  compile(q.ir).sql.match(/SELECT /g)?.length;

it('folds total scan projections under LIMIT without changing Params or descriptors', () => {
  const shared = val(1n, col.Int64);

  const q = t
    .where(a => a.id.eq(2))
    .map(a => ({ renamed: a.n.plus(shared), second: a.n.minus(shared), nullable: a.nullable }))
    .limit(1, 1);

  const result = compile(q.ir),
    reference = emitNaive(q.ir);

  expect(selects(q)).toBe(1);

  expect(result.sql).toBe(
    'SELECT `n` + {p0:Int64} AS `renamed`, `n` - {p0:Int64} AS `second`, `nullable` AS `nullable` FROM `project_limit` WHERE `id` = {p1:UInt32} LIMIT 1 OFFSET 1',
  );

  expect(result.params).toEqual(reference.params);
  expect(result.columns).toEqual(reference.columns);
  expect(structure(q.ir).selects).toHaveLength(1);
});

it('agent2: retains typed Param identity, reordered interfaces and nested empty caps', () => {
  const shared = val(7n, col.Int64);

  const projected = t
    .where(a => a.n.eq(shared))
    .map(a => ({
      second: a.n.minus(shared),
      first: a.n.plus(shared),
      absent: val(null, col.Nullable(col.String)),
    }));

  for (const q of [
    projected.limit(0, 2),
    projected.limit(2, 1).limit(0, 1),
    projected.limit(0).limit(3, 1),
    projected.limit(2).map(a => ({ absent: a.absent, first: a.first, second: a.second })),
  ]) {
    const result = compile(q.ir),
      reference = emitNaive(q.ir);

    expect(result.params).toEqual({ p0: '7' });
    expect(result.params).toEqual(reference.params);
    expect(result.parameterTypes).toEqual(reference.parameterTypes);
    expect(result.columns).toEqual(reference.columns);
    expect(Object.keys(result.columns)).toEqual(Object.keys(reference.columns));
  }

  expect(selects(projected.limit(0, 2))).toBe(1);
  expect(selects(projected.limit(2, 1).limit(0, 1))).toBe(2);
});

it('final agent2: preserves extreme caps verbatim and narrows only direct projection interfaces', () => {
  const max = Number.MAX_SAFE_INTEGER;

  const q = t
    .map(a => ({ renamed: a.id, nullable: a.nullable }))
    .limit(max, max)
    .limit(0, max)
    .map(a => ({ nullable: a.nullable }));

  const result = compile(q.ir);
  expect(result.sql).toContain(`LIMIT ${max} OFFSET ${max}`);
  expect(result.sql).toContain(`LIMIT 0 OFFSET ${max}`);
  expect(result.columns).toEqual(emitNaive(q.ir).columns);
  expect(result.sql).not.toContain('`renamed`');
  const plan = structure(q.ir).plan;

  const folded = [...plan.blocks.values()].filter(
    b => b.project && b.clauses.some(c => c.kind === 'Limit'),
  );

  expect(folded).toHaveLength(1);
});

it('final agent2: shared scans and filters are extracted before LIMIT projection admission', () => {
  for (const source of [t, t.where(a => a.id.eq(2))]) {
    const left = source.map(a => ({ v: a.n.plus(1n) })).limit(1);
    const right = source.map(a => ({ v: a.n.minus(1n) })).limit(0, 1);
    const result = structure(unionAll(left, right).ir);
    expect(result.plan.ctes!.definitions).toContain(source.ir);

    expect(
      [...result.plan.blocks.values()].some(
        b => b.project && b.clauses.some(c => c.kind === 'Limit'),
      ),
    ).toBe(false);

    expect(
      result.selects.filter(s => s.fence === 'unfenced' && s.consumer?.kind === 'Limit'),
    ).toEqual([]);
  }
});

it('LIMIT cannot bypass the hidden physical-name Project gate', () => {
  const source = from(
    table(
      'hidden_limit',
      { id: col.UInt32, other: col.UInt32 },
      {
        engine: 'MergeTree',
        sortingKey: ['id'],
        partitionKey: [],
        hiddenColumns: ['hidden', 'mat'],
      },
    ),
  );

  expect(Object.keys(compile(source.ir).columns)).toEqual(['id', 'other']);

  for (const name of ['hidden', 'mat'])
    for (const offset of [0, 1]) {
      // Known typed references do not read the hidden name, even when they read the
      // same dependency as the server ALIAS. No dependency expansion is invented.
      for (const same of [false, true]) {
        const q = source
          .where(r => (same ? r.id : r.other).eq(1))
          .map(r => ({ [name]: r.id.plus(1), sibling: same ? r.id : r.other }))
          .limit(1, offset);

        expect(selects(q)).toBe(1);
      }

      // Raw conservatively reads every name, including an omitted physical column.
      // Inspect the Project itself: a LIMIT-only opacity fence would not prove this gate.
      for (const q of [
        source
          .map(r => ({ [name]: r.id.plus(1), sibling: sql`${r.other}`.as(col.UInt32) }))
          .limit(1, offset),
        source
          .where(r => sql`${r.other} = 1`.as(col.Bool))
          .map(r => ({ [name]: r.id.plus(1) }))
          .limit(1, offset),
      ]) {
        const blocks = structure(q.ir).plan.blocks;
        expect([...blocks.values()].some(b => b.project)).toBe(false);
        expect(selects(q)).toBe(3);
      }
    }
});

it('does not excuse an eligible derived boundary merely because its consumer is LIMIT', () => {
  const q = t.map(a => ({ renamed: a.n.plus(1n) })).limit(2);
  expect(structure(q.ir).selects.filter(s => s.fence === 'unfenced')).toEqual([]);
});

it('keeps fallible, opaque and volatile projection scopes, including unused outputs', () => {
  for (const q of [
    t.map(a => ({ v: cast(a.s, col.UInt64) })).limit(1),
    t.map(a => ({ v: a.n.divide(1n) })).limit(1),
    t.map(a => ({ v: sql`${a.n}`.as(col.Int64) })).limit(1),
    t.map(() => ({ v: sql`rand()`.as(col.UInt32) })).limit(1),
    t
      .where(a => cast(a.s, col.UInt64).gt(0n))
      .map(a => ({ renamed: a.n }))
      .limit(1),
  ])
    expect(selects(q)).toBe(2);

  expect(
    selects(
      t
        .map(a => ({ id: a.id, v: cast(a.s, col.UInt64) }))
        .limit(1)
        .map(a => ({ id: a.id })),
    ),
  ).toBe(3);
});

it('checks non-enumerable projection expressions in legal manual graphs too', () => {
  const root = structuredClone(t.map(a => ({ id: a.id, bad: cast(a.s, col.UInt64) })).limit(1).ir);
  if (root.kind !== 'Limit' || root.input.kind !== 'Project') throw new Error('shape');
  Object.defineProperty(root.input.exprs, 'bad', { enumerable: false });

  Object.defineProperty(root.input.exprs, 'spare', {
    enumerable: true,
    value: root.input.exprs.id,
  });

  expect(compile(root).sql.match(/SELECT /g)).toHaveLength(2);
});

it('keeps Sort, Aggregate, DISTINCT, explicit/shared CTE, repeated LIMIT and physical-shadow boundaries', () => {
  const projected = t.map(a => ({ renamed: a.n.plus(1n) }));
  expect(selects(projected.orderBy(a => a.renamed).limit(1))).toBe(2);
  expect(selects(projected.aggregate(() => ({ total: count() })))).toBe(2);
  expect(selects(projected.distinct().limit(1))).toBe(2);
  expect(selects(projected.cte().limit(1))).toBe(2);
  expect(selects(projected.limit(2).limit(1))).toBe(2);
  expect(compile(unionAll(projected.limit(1), projected.limit(2)).ir).sql).toContain('WITH');
  expect(selects(t.map(a => ({ n: a.id, sibling: a.n })).limit(1))).toBe(3);

  // A computed, otherwise unused Param must not disappear through demand pruning.
  expect(
    selects(
      t
        .map(a => ({ id: a.id, extra: a.n.plus(1n) }))
        .limit(1)
        .map(a => ({ id: a.id })),
    ),
  ).toBe(3);
});
