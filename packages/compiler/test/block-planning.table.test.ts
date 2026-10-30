import { expect, it } from 'vitest';
import { cast, col, count, defineFunction, from, join, outputLeaves, table, unionAll, type Rel } from '@typedhouse/core';
import { compile } from '../src/index.js';
import { emitPlanned, validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { planSelects, type SqlPlan } from '../src/plan-selects.js';
import { pruneColumns } from '../src/prune-columns.js';

// Spec Part 3, stage 3: IR shape in, block boundaries out. Rows plan the graph as built
// (no rewrite), so each row isolates one folding decision. Each inner array lists the
// node kinds of one block root first; `Scan`, `Join` and `CTE` close a block's FROM.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const t = from(table('t', { id: col.UInt64, k: col.String, ids: col.Array(col.String) }, meta));
const u = from(table('u', { id: col.UInt64, v: col.UInt64 }, meta));
const safe = (r: typeof t.row) => r.id.gt(1n);
const unsafe = (r: typeof t.row) => cast(r.k, col.UInt64).gt(1n);
const volatile = defineFunction({ name: 'rowNumberInAllBlocks', args: [], returns: col.UInt64, deterministic: false });
const grouped = t.groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() }));

function layout(plan: SqlPlan, rel: Rel): string[][] {
  if (plan.ctes?.names.has(rel)) return [['CTE']];
  const block = plan.blocks.get(rel);
  if (!block) return [[rel.kind], ...('input' in rel ? layout(plan, rel.input) : [])];
  const stop = block.source.kind === 'table' ? block.source.scan : block.source.rel;
  const kinds: string[] = [];
  for (let cur: Rel = rel; cur !== stop; cur = (cur as Extract<Rel, { input: Rel }>).input) kinds.push(cur.kind);
  if (block.source.kind === 'table') return [[...kinds, 'Scan']];
  if (block.source.kind === 'join') return [[...kinds, 'Join']];
  if (block.source.kind === 'cte') return [[...kinds, 'CTE']];
  return [kinds, ...layout(plan, stop)];
}

const rows: { readonly name: string; readonly build: () => Rel; readonly blocks: readonly (readonly string[])[] }[] = [
  { name: 'filter, sort, limit in clause order', build: () => t.where(safe).orderBy(r => r.id).limit(3).ir, blocks: [['Limit', 'Sort', 'Filter', 'Scan']] },
  { name: 'repeated filters share WHERE', build: () => t.where(safe).where(r => r.k.eq('a')).ir, blocks: [['Filter', 'Filter', 'Scan']] },
  { name: 'where after orderBy opens a block', build: () => t.orderBy(r => r.id).where(safe).ir, blocks: [['Filter'], ['Sort', 'Scan']] },
  { name: 'where after limit opens a block', build: () => t.limit(2).where(safe).ir, blocks: [['Filter'], ['Limit', 'Scan']] },
  { name: 'repeated limits', build: () => t.limit(4, 1).limit(2).ir, blocks: [['Limit'], ['Limit', 'Scan']] },
  { name: 'sort after limit opens a block', build: () => t.limit(2).orderBy(r => r.id).ir, blocks: [['Sort'], ['Limit', 'Scan']] },
  { name: 'groupBy().aggregate().where().orderBy().limit() is one block', build: () => t.where(safe).groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)).orderBy(r => r.k).limit(5).ir, blocks: [['Limit', 'Sort', 'Filter', 'Aggregate', 'Filter', 'Scan']] },
  { name: 'aggregate having after orderBy opens a block', build: () => grouped.orderBy(r => r.n).where(r => r.n.gt(1n)).ir, blocks: [['Filter'], ['Sort', 'Aggregate', 'Scan']] },
  { name: 'identity selection folds before sort/limit', build: () => t.where(safe).map(r => ({ id: r.id })).orderBy(r => r.id).limit(1).ir, blocks: [['Limit', 'Sort', 'Project', 'Filter', 'Scan']] },
  { name: 'computed selection folds over scan and filters', build: () => t.where(safe).map(r => ({ next: r.id.plus(1n) })).ir, blocks: [['Project', 'Filter', 'Scan']] },
  { name: 'computed selection after limit opens a block', build: () => t.limit(1).map(r => ({ next: r.id.plus(1n) })).ir, blocks: [['Project'], ['Limit', 'Scan']] },
  { name: 'filter after a computed selection opens a block', build: () => t.map(r => ({ next: r.id.plus(1n) })).where(r => r.next.gt(1n)).ir, blocks: [['Filter'], ['Project', 'Scan']] },
  { name: 'distinct sets the flag over filters', build: () => t.where(safe).distinct().ir, blocks: [['Distinct', 'Filter', 'Scan']] },
  { name: 'distinct before orderBy and limit folds', build: () => t.where(safe).distinct().orderBy(r => r.id).limit(2).ir, blocks: [['Limit', 'Sort', 'Distinct', 'Filter', 'Scan']] },
  { name: 'distinct after orderBy opens a block', build: () => t.orderBy(r => r.id).distinct().ir, blocks: [['Distinct'], ['Sort', 'Scan']] },
  { name: 'distinct after limit opens a block, later sort folds into it', build: () => t.limit(2).distinct().orderBy(r => r.id).ir, blocks: [['Sort', 'Distinct'], ['Limit', 'Scan']] },
  { name: 'filter after distinct opens a block', build: () => t.distinct().where(safe).ir, blocks: [['Filter'], ['Distinct', 'Scan']] },
  { name: 'distinct twice', build: () => t.distinct().distinct().ir, blocks: [['Distinct'], ['Distinct', 'Scan']] },
  { name: 'selection after distinct opens a block', build: () => t.distinct().map(r => ({ id: r.id })).ir, blocks: [['Project'], ['Distinct', 'Scan']] },
  { name: 'computed selection after distinct opens a block', build: () => t.distinct().map(r => ({ next: r.id.plus(1n) })).ir, blocks: [['Project'], ['Distinct', 'Scan']] },
  { name: 'distinct over a computed selection folds', build: () => t.map(r => ({ next: r.id.plus(1n) })).distinct().ir, blocks: [['Distinct', 'Project', 'Scan']] },
  { name: 'distinct over an aggregate block folds', build: () => grouped.where(r => r.n.gt(1n)).distinct().orderBy(r => r.k).ir, blocks: [['Sort', 'Distinct', 'Filter', 'Aggregate', 'Scan']] },
  { name: 'aggregate after distinct opens a block', build: () => t.distinct().groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['Distinct', 'Scan']] },
  { name: 'inner arrayJoin over a safe where folds', build: () => t.where(safe).arrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'inner arrayJoin over an unsafe where opens a block', build: () => t.where(unsafe).arrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin'], ['Filter', 'Scan']] },
  { name: 'inner arrayJoin over a total-but-unsafe where opens a block', build: () => t.where(r => r.id.plus(1n).gt(2n)).arrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin'], ['Filter', 'Scan']] },
  { name: 'left arrayJoin over an unsafe where folds', build: () => t.where(unsafe).leftArrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'left arrayJoin over a safe where folds', build: () => t.where(safe).leftArrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'left arrayJoin over a volatile where opens a block', build: () => t.where(() => volatile().eq(0n)).leftArrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin'], ['Filter', 'Scan']] },
  { name: 'filter on the alias after arrayJoin folds as WHERE', build: () => t.arrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).ir, blocks: [['Filter', 'ArrayJoin', 'Scan']] },
  { name: 'limit().arrayJoin() is two blocks', build: () => t.limit(2).arrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin'], ['Limit', 'Scan']] },
  { name: 'one ARRAY JOIN per block', build: () => t.arrayJoin(r => r.ids, 'x').arrayJoin(r => r.ids, 'y').ir, blocks: [['ArrayJoin'], ['ArrayJoin', 'Scan']] },
  { name: 'distinct, sort and limit fold over an expansion', build: () => t.arrayJoin(r => r.ids, 'x').distinct().orderBy(r => r.x).limit(3).ir, blocks: [['Limit', 'Sort', 'Distinct', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate over an expansion opens a block', build: () => t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['ArrayJoin', 'Scan']] },
  { name: 'identity selection over an expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ id: r.id, x: r.x })).ir, blocks: [['Project', 'ArrayJoin', 'Scan']] },
  { name: 'computed selection over an expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ next: r.id.plus(1n), x: r.x })).ir, blocks: [['Project', 'ArrayJoin', 'Scan']] },
  { name: 'computed alias shadowing the expansion alias opens a block', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ x: r.id.plus(1n) })).ir, blocks: [['Project'], ['ArrayJoin', 'Scan']] },
  { name: 'CTE input is never folded into an expansion', build: () => t.cte().arrayJoin(r => r.ids, 'x').ir, blocks: [['ArrayJoin'], ['CTE']] },
  { name: 'CTE reference takes filters and sorts directly', build: () => t.cte().where(safe).orderBy(r => r.id).ir, blocks: [['Sort', 'Filter', 'CTE']] },
  { name: 'distinct reads a CTE directly', build: () => t.cte().distinct().ir, blocks: [['Distinct', 'CTE']] },
  { name: 'join block takes filters and sorts', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.v.gt(1n)).orderBy(r => r.a.id).ir, blocks: [['Sort', 'Filter', 'Join']] },
  { name: 'distinct over a join block folds', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })).distinct().ir, blocks: [['Distinct', 'Project', 'Join']] },
  { name: 'union always opens a block', build: () => unionAll(t, t).where(safe).ir, blocks: [['Filter'], ['Union']] },
];

it.each(rows)('$name', ({ build, blocks }) => {
  const root = build();
  const nodes = Object.values(validateRel(root).nodes);
  const plan = planSelects(root, nodes, pruneColumns(root), planCtes(root));
  expect(layout(plan, root)).toEqual(blocks);
  const sql = emitPlanned(plan).sql;
  expect(sql).not.toContain('*');
  // Without joins, CTEs or unions every planned block is exactly one SELECT.
  if (!blocks.flat().some(k => k === 'Join' || k === 'CTE' || k === 'Union')) expect(sql.match(/SELECT /g)).toHaveLength(blocks.length);
  expect(sql.includes('DISTINCT')).toBe(blocks.flat().includes('Distinct'));
});

it('covers at least twenty shapes, including every fold arm', () => {
  expect(rows.length).toBeGreaterThanOrEqual(20);
  const folded = new Set(rows.flatMap(r => r.blocks).filter(b => b.length > 2 || b[1] === 'Join' || b[1] === 'CTE').flat());
  for (const kind of ['Filter', 'Sort', 'Limit', 'Project', 'Aggregate', 'Distinct', 'ArrayJoin']) expect(folded.has(kind), kind).toBe(true);
});

it('a folded DISTINCT block selects the Distinct node\'s full leaf set even when the clause above it is pruned by its consumer', () => {
  // Fix round 1 (Tester Finding 1): the clause folded above the Distinct carries its consumer's narrower demand;
  // the DISTINCT list must come from the Distinct node, whose demand pruning keeps full.
  const shapes: [string, Rel, Rel][] = [
    ['distinct -> orderBy -> narrowing map', t.distinct().orderBy(r => r.id).map(r => ({ id: r.id })).ir, t.distinct().ir],
    ['distinct -> limit as a join side', join({ a: t.distinct().limit(3), b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })).ir, t.distinct().ir],
    ['distinct -> orderBy -> aggregate', t.distinct().orderBy(r => r.id).groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir, t.distinct().ir],
  ];
  const full = outputLeaves(t.distinct().ir.output).map(l => '`' + l.name + '`').join(', ');
  expect(full).toBe('`id`, `k`, `ids`');
  for (const [label, root] of shapes) {
    const sql = compile(root).sql;
    expect(/SELECT DISTINCT (.*?) FROM/.exec(sql)?.[1], `${label}: ${sql}`).toBe(full);
    expect(sql.match(/SELECT DISTINCT /g), label).toHaveLength(1);
  }
  expect(compile(shapes[0]![1]).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `id`, `k`, `ids` FROM `t` ORDER BY `id` ASC) AS `__typedhouse_input`');
});

it('a Sort over a folded Distinct can only reference selected columns', () => {
  // Sort keys bind to the Distinct node, whose output is the full selected leaf set:
  // an ORDER BY on an unselected column is unreachable in the IR, so it is not a row above.
  const sorted = t.where(safe).distinct().orderBy(r => r.k);
  if (sorted.ir.kind !== 'Sort' || sorted.ir.input.kind !== 'Distinct') throw new Error('shape');
  const key = sorted.ir.keys[0]!.expr;
  expect(key.kind === 'ColumnRef' && key.rel).toBe(sorted.ir.input.id);
  const plan = planSelects(sorted.ir, Object.values(validateRel(sorted.ir).nodes), pruneColumns(sorted.ir), planCtes(sorted.ir));
  expect(plan.columns?.get(sorted.ir.input)?.map(l => l.name)).toEqual(['id', 'k', 'ids']);
  expect(emitPlanned(plan).sql).toBe('SELECT DISTINCT `id`, `k`, `ids` FROM `t` WHERE `id` > {p0:UInt64} ORDER BY `k` ASC');
});
