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
  // (viii) A whole-row selection folds over a DISTINCT block; narrower, renaming or later-filtered ones do not.
  { name: 'whole-row selection after distinct folds', build: () => t.distinct().map(r => ({ id: r.id, k: r.k, ids: r.ids })).ir, blocks: [['Project', 'Distinct', 'Scan']] },
  { name: 'reordered whole-row selection after distinct folds', build: () => t.distinct().map(r => ({ ids: r.ids, k: r.k, id: r.id })).ir, blocks: [['Project', 'Distinct', 'Scan']] },
  { name: 'whole-row selection after distinct, then sort and limit, is one block', build: () => t.distinct().map(r => ({ id: r.id, k: r.k, ids: r.ids })).orderBy(r => r.k).limit(2).ir, blocks: [['Limit', 'Sort', 'Project', 'Distinct', 'Scan']] },
  { name: 'whole-row selection after a filtered distinct folds', build: () => t.where(safe).distinct().map(r => ({ id: r.id, k: r.k, ids: r.ids })).ir, blocks: [['Project', 'Distinct', 'Filter', 'Scan']] },
  { name: 'renaming whole-row selection after distinct opens a block', build: () => t.distinct().map(r => ({ a: r.id, k: r.k, ids: r.ids })).ir, blocks: [['Project'], ['Distinct', 'Scan']] },
  { name: 'filter after a folded whole-row selection over distinct opens a block', build: () => t.distinct().map(r => ({ id: r.id, k: r.k, ids: r.ids })).where(safe).ir, blocks: [['Filter'], ['Project', 'Distinct', 'Scan']] },
  { name: 'whole-row selection after distinct over a sorted block opens a block', build: () => t.distinct().orderBy(r => r.id).map(r => ({ id: r.id, k: r.k, ids: r.ids })).ir, blocks: [['Project'], ['Sort', 'Distinct', 'Scan']] },
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
  // (vii) An Aggregate folds over an expanded scan block: inner/left, with/without WHERE, key on the alias or a source column.
  { name: 'aggregate keyed on the alias over an inner expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate keyed on a source column over an inner expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate keyed on the alias over a left expansion folds', build: () => t.leftArrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate keyed on a source column over a left expansion folds', build: () => t.leftArrayJoin(r => r.ids, 'x').groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate over an inner expansion of a safe where folds', build: () => t.where(safe).arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Filter', 'Scan']] },
  { name: 'aggregate over a where after an inner expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'Filter', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate over a left expansion with total wheres on both sides folds', build: () => t.where(safe).leftArrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'Filter', 'ArrayJoin', 'Filter', 'Scan']] },
  // Slice 3b: the total where above the expansion must not be AND-ed into the fallible one below it, so it opens a block and the aggregate another.
  { name: 'aggregate over a left expansion with a fallible where below and a total where above keeps both boundaries', build: () => t.where(unsafe).leftArrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['Filter'], ['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'keyless aggregate over a left expansion folds', build: () => t.leftArrayJoin(r => r.ids, 'x').aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'having, sort and limit fold over an aggregated expansion', build: () => t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)).orderBy(r => r.x).limit(3).ir, blocks: [['Limit', 'Sort', 'Filter', 'Aggregate', 'ArrayJoin', 'Scan']] },
  { name: 'aggregate over an inner expansion of an unsafe where keeps the derived table', build: () => t.where(unsafe).arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['ArrayJoin'], ['Filter', 'Scan']] },
  { name: 'aggregate key shadowing the expansion alias keeps the explicit scope', build: () => t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ x: r.k })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['ArrayJoin', 'Scan']] },
  { name: 'aggregate over a second expansion keeps the derived table', build: () => t.arrayJoin(r => r.ids, 'x').arrayJoin(r => r.ids, 'y').groupBy(r => ({ y: r.y })).aggregate(() => ({ n: count() })).ir, blocks: [['Aggregate'], ['ArrayJoin'], ['ArrayJoin', 'Scan']] },
  { name: 'identity selection over an expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ id: r.id, x: r.x })).ir, blocks: [['Project', 'ArrayJoin', 'Scan']] },
  { name: 'computed selection over an expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ next: r.id.plus(1n), x: r.x })).ir, blocks: [['Project', 'ArrayJoin', 'Scan']] },
  { name: 'computed alias shadowing the expansion alias opens a block', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ x: r.id.plus(1n) })).ir, blocks: [['Project'], ['ArrayJoin', 'Scan']] },
  // Slice 3 fix round 1 (a): any selection folds over a scan block with Filter-only clauses; a computed alias equal to a
  // column the block reads (WHERE, expansion, another item) or to the expansion alias keeps its own block.
  { name: 'fallible selection over a filtered scan folds', build: () => t.where(safe).map(r => ({ n: cast(r.k, col.UInt64) })).ir, blocks: [['Project', 'Filter', 'Scan']] },
  { name: 'volatile selection over a scan folds', build: () => t.map(r => ({ id: r.id, row: volatile() })).ir, blocks: [['Project', 'Scan']] },
  { name: 'fallible selection over an expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ x: r.x, n: cast(r.k, col.UInt64) })).ir, blocks: [['Project', 'ArrayJoin', 'Scan']] },
  { name: 'computed alias shadowing an unread column folds', build: () => t.where(safe).map(r => ({ k: cast(r.id, col.String) })).ir, blocks: [['Project', 'Filter', 'Scan']] },
  { name: 'computed alias shadowing a column the where reads opens a block', build: () => t.where(r => r.k.eq('a')).map(r => ({ k: cast(r.id, col.String) })).ir, blocks: [['Project'], ['Filter', 'Scan']] },
  { name: 'computed alias shadowing a column the expansion reads opens a block', build: () => t.arrayJoin(r => r.ids, 'x').map(r => ({ ids: cast(r.id, col.String), x: r.x })).ir, blocks: [['Project'], ['ArrayJoin', 'Scan']] },
  { name: 'computed alias shadowing a column another item reads opens a block', build: () => t.map(r => ({ k: cast(r.id, col.String), n: r.k.eq('a') })).ir, blocks: [['Project'], ['Scan']] },
  { name: 'fallible selection after limit opens a block', build: () => t.limit(1).map(r => ({ n: cast(r.k, col.UInt64) })).ir, blocks: [['Project'], ['Limit', 'Scan']] },
  { name: 'fallible selection after sort opens a block', build: () => t.orderBy(r => r.id).map(r => ({ n: cast(r.k, col.UInt64) })).ir, blocks: [['Project'], ['Sort', 'Scan']] },
  { name: 'fallible selection after an aggregate opens a block', build: () => grouped.map(r => ({ m: cast(r.n, col.String) })).ir, blocks: [['Project'], ['Aggregate', 'Scan']] },
  { name: 'fallible selection after distinct opens a block', build: () => t.distinct().map(r => ({ n: cast(r.k, col.UInt64) })).ir, blocks: [['Project'], ['Distinct', 'Scan']] },
  // Slice 3 fix round 1 (b): a direct selection folds over a join block with Filter-only clauses.
  { name: 'direct selection over a filtered join block folds', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.v.gt(1n)).map(r => ({ id: r.a.id, v: r.b.v })).ir, blocks: [['Project', 'Filter', 'Join']] },
  { name: 'direct selection over a join residual folds', build: () => join({ a: t, b: u }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.v)]).map(r => ({ id: r.a.id })).ir, blocks: [['Project', 'Filter', 'Join']] },
  { name: 'computed selection over a filtered join block opens a block', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.v.gt(1n)).map(r => ({ next: r.a.id.plus(1n) })).ir, blocks: [['Project'], ['Filter', 'Join']] },
  { name: 'direct selection over a sorted join block opens a block', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.id).map(r => ({ id: r.a.id })).ir, blocks: [['Project'], ['Sort', 'Join']] },
  { name: 'direct selection over a distinct join block opens a block', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).distinct().map(r => ({ id: r.a.id })).ir, blocks: [['Project'], ['Distinct', 'Join']] },
  // Slice 3b: consecutive Filters share a WHERE/HAVING only when every predicate is total (what MergeFilter merges). A
  // Filter outside the total fragment keeps its own block over earlier filters, a total one over it does the same, and
  // two non-total ones never share; a non-total Filter that is the block's first WHERE folds. Scan, join-bound,
  // expanded and aggregate blocks alike. `total` is total but not safe (arithmetic), so it still shares a WHERE.
  { name: 'fallible where after a total where opens a block', build: () => t.where(safe).where(unsafe).ir, blocks: [['Filter'], ['Filter', 'Scan']] },
  { name: 'fallible where alone folds as the first WHERE', build: () => t.where(unsafe).ir, blocks: [['Filter', 'Scan']] },
  { name: 'total where after a fallible where opens a block', build: () => t.where(unsafe).where(safe).ir, blocks: [['Filter'], ['Filter', 'Scan']] },
  { name: 'two fallible wheres never share a WHERE', build: () => t.where(unsafe).where(r => cast(r.k, col.Int64).lt(9n)).ir, blocks: [['Filter'], ['Filter', 'Scan']] },
  { name: 'total arithmetic where after a safe where shares the WHERE', build: () => t.where(safe).where(r => r.id.plus(1n).gt(2n)).ir, blocks: [['Filter', 'Filter', 'Scan']] },
  { name: 'total, fallible, total wheres are three blocks', build: () => t.where(safe).where(unsafe).where(r => r.k.eq('a')).ir, blocks: [['Filter'], ['Filter'], ['Filter', 'Scan']] },
  { name: 'sort and limit fold above the isolated fallible where', build: () => t.where(safe).where(unsafe).orderBy(r => r.id).limit(2).ir, blocks: [['Limit', 'Sort', 'Filter'], ['Filter', 'Scan']] },
  { name: 'fallible where after a total where and a folded computed selection: selection below, filter above', build: () => t.where(safe).map(r => ({ next: r.id.plus(1n), k: r.k })).where(r => cast(r.k, col.UInt64).gt(1n)).ir, blocks: [['Filter'], ['Project', 'Filter', 'Scan']] },
  { name: 'whole-row identity selection between a total and a fallible where is transparent', build: () => t.where(safe).map(r => ({ id: r.id, k: r.k, ids: r.ids })).where(unsafe).ir, blocks: [['Filter'], ['Project', 'Filter', 'Scan']] },
  { name: 'fallible where after a filtered join block opens a block over it', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.v.gt(1n)).where(r => cast(r.a.k, col.UInt64).gt(1n)).ir, blocks: [['Filter'], ['Filter', 'Join']] },
  { name: 'fallible where alone on a join block folds', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => cast(r.a.k, col.UInt64).gt(1n)).ir, blocks: [['Filter', 'Join']] },
  { name: 'fallible where after a join residual opens a block over it', build: () => join({ a: t, b: u }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.v)]).where(r => cast(r.a.k, col.UInt64).gt(1n)).ir, blocks: [['Filter'], ['Filter', 'Join']] },
  { name: 'direct selection folds over the isolated fallible where of a join block', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.v.gt(1n)).where(r => cast(r.a.k, col.UInt64).gt(1n)).map(r => ({ id: r.a.id })).ir, blocks: [['Project', 'Filter'], ['Filter', 'Join']] },
  { name: 'total where after a fallible one on a join block opens a block', build: () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => cast(r.a.k, col.UInt64).gt(1n)).where(r => r.b.v.gt(1n)).ir, blocks: [['Filter'], ['Filter', 'Join']] },
  { name: 'fallible where after a safe where under an inner expansion opens a block', build: () => t.where(safe).arrayJoin(r => r.ids, 'x').where(r => cast(r.x, col.UInt64).gt(1n)).ir, blocks: [['Filter'], ['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'fallible where alone above an inner expansion folds', build: () => t.arrayJoin(r => r.ids, 'x').where(r => cast(r.x, col.UInt64).gt(1n)).ir, blocks: [['Filter', 'ArrayJoin', 'Scan']] },
  { name: 'total where after a fallible one above an expansion opens a block', build: () => t.arrayJoin(r => r.ids, 'x').where(r => cast(r.x, col.UInt64).gt(1n)).where(r => r.x.eq('a')).ir, blocks: [['Filter'], ['Filter', 'ArrayJoin', 'Scan']] },
  { name: 'total where above a left expansion over a fallible where opens a block', build: () => t.where(unsafe).leftArrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).ir, blocks: [['Filter'], ['ArrayJoin', 'Filter', 'Scan']] },
  { name: 'fallible having after a safe having opens a block, sort and limit fold above it', build: () => grouped.where(r => r.n.gt(1n)).where(r => cast(r.k, col.UInt64).gt(1n)).orderBy(r => r.k).limit(2).ir, blocks: [['Limit', 'Sort', 'Filter'], ['Filter', 'Aggregate', 'Scan']] },
  { name: 'fallible having alone keeps its own block (pre-existing safe-HAVING gate, unchanged)', build: () => grouped.where(r => cast(r.k, col.UInt64).gt(1n)).ir, blocks: [['Filter'], ['Aggregate', 'Scan']] },
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
  // Every emitted DISTINCT list set-equals its Distinct node's full output (slice 2 Finding 1, kept through slice 3).
  const distincts: Rel[] = [];
  for (let cur: Rel | undefined = root; cur; cur = 'input' in cur ? cur.input : undefined) if (cur.kind === 'Distinct') distincts.push(cur);
  const lists = [...sql.matchAll(/SELECT DISTINCT ([\s\S]*?)\s+FROM/g)].map(m => m[1]!.split(', ').map(c => / AS /.test(c) ? c.replace(/^.* AS /, '') : c.replace(/^`[^`]+`\./, '')).sort());
  expect(lists).toHaveLength(distincts.length);
  for (const [i, node] of distincts.entries()) expect(lists[i]).toEqual(outputLeaves(node.output).map(l => '`' + l.name + '`').sort());
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
  // (viii) A folded whole-row selection keeps the full list even when its consumer prunes it, and orders it as selected.
  const folded = t.distinct().map(r => ({ ids: r.ids, k: r.k, id: r.id })).orderBy(r => r.k).map(r => ({ id: r.id })).ir;
  expect(compile(folded).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `ids`, `k`, `id` FROM `t` ORDER BY `k` ASC) AS `__typedhouse_input`');
  const ordered = t.distinct().map(r => ({ ids: r.ids, k: r.k, id: r.id })).orderBy(r => r.k).limit(2).ir;
  expect(compile(ordered).sql).toBe('SELECT DISTINCT `ids`, `k`, `id` FROM `t` ORDER BY `k` ASC LIMIT 2');
  expect(Object.keys(compile(ordered).columns)).toEqual(['ids', 'k', 'id']);
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
