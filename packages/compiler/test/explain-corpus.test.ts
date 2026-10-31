import { expect, it } from 'vitest';
import { cast, col, count, from, join, print, table, unionAll } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { entries, unfencedControl, type FenceKind } from './fixtures/corpus/explain-corpus.js';
import { components, db, forTenant } from './fixtures/corpus/low-stock.js';
import { columnName, flatten, headerColumns, parseExplainJson, parseExplainText, readTable, stepTypes, structure } from './explain-corpus-support.js';

// Docker-free half of the EXPLAIN corpus (spec "Testing"): the fence clause on the planned emission, the per-rule
// hit evidence and the SQL text snapshots. This compiler-side clause (i) is the discriminating one: the 24.8 analyzer
// absorbs derived tables into Expression steps and prunes their columns itself, so the native clauses in
// explain-corpus.integration.ts (step types, MergeTree read sets) are a server-side sanity check, not the proof.
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
const fenceSet = (kinds: Iterable<FenceKind | 'unfenced' | 'root'>) => [...new Set([...kinds].filter(k => k !== 'root'))].sort();

it('has at least thirty ids, each unique, with every rewrite rule represented once', () => {
  expect(entries.length).toBeGreaterThanOrEqual(30);
  expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
  expect(entries.filter(e => e.rule).map(e => e.rule).sort()).toEqual(['MergeFilter', 'MergeProject', 'PruneColumns', 'PushFilterAggKey', 'PushFilterArrayJoin', 'PushFilterJoin', 'PushFilterProject', 'PushFilterUnion']);
});

for (const entry of entries) {
  // Fence clause (i): every non-root SELECT is justified by a fence or a CTE, and the planned SQL has exactly as
  // many SELECTs as the structure walk predicts.
  it(`${entry.id}: every SELECT boundary is fenced`, () => {
    const compiled = compile(entry.query.ir), s = structure(entry.query.ir);
    expect(selects(compiled.sql), compiled.sql).toBe(s.selects.length);
    expect(s.selects.filter(x => x.fence === 'unfenced').map(x => `${x.consumer?.kind} over ${x.rel.kind}`), compiled.sql).toEqual([]);
    expect(compiled.sql).not.toMatch(/SELECT \*/);
  });
  it(`${entry.id}: declared fences, SELECT count, metadata and snapshot`, async () => {
    const compiled = compile(entry.query.ir), naive = emitNaive(entry.query.ir), s = structure(entry.query.ir);
    expect(selects(compiled.sql), compiled.sql).toBe(s.selects.length);
    expect(fenceSet(s.selects.map(x => x.fence).filter(f => f !== 'unfenced')), compiled.sql).toEqual(fenceSet(entry.fences));
    expect(s.selects.some(x => x.fence === 'unfenced')).toBe(false);
    expect(selects(compiled.sql)).toBeLessThanOrEqual(selects(naive.sql));
    expect(compiled.columns).toEqual(naive.columns);
    expect(compiled.columnPaths).toEqual(naive.columnPaths);
    // Params are numbered by first appearance in each text, so compare the multiset of wire types, not the names.
    expect(Object.values(compiled.parameterTypes ?? {}).map(t => print(t)).sort()).toEqual(Object.values(naive.parameterTypes ?? {}).map(t => print(t)).sort());
    expect([...new Set([...compiled.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(compiled.params));
    // Review aid, not a byte contract (lowStock's is low-stock.test.ts): regenerate with `vitest -u` and read the diff.
    await expect(compiled.sql + '\n').toMatchFileSnapshot(`./snapshots/explain-corpus/${entry.id}.sql`);
  });
  const rule = entry.rule;
  if (rule) it(`${entry.id}: exercises exactly ${rule}`, () => {
    const { hits } = rewriteRel(entry.query.ir), s = structure(entry.query.ir);
    if (rule === 'PruneColumns') {
      expect(Object.values(hits).every(n => n === 0)).toBe(true);
      expect([...s.demand.values()].flat()).toEqual([['entityId']]);
    } else {
      expect(hits[rule]).toBeGreaterThan(0);
      for (const [other, n] of Object.entries(hits)) if (other !== rule && other !== 'MergeFilter') expect(n, other).toBe(0);
    }
  });
}

it('negative control: naive emission fails the SELECT-count clause on wide queries', () => {
  for (const id of ['composition/lowStock', 'entities/componentsLatest', 'entities/categoryShare']) {
    const entry = entries.find(e => e.id === id)!;
    expect(selects(emitNaive(entry.query.ir).sql)).toBeGreaterThan(structure(entry.query.ir).selects.length);
  }
});
it('negative control: a hand-injected unfenced derived table is reported as such', () => {
  // The fallible selection folds over its scan; the filter above it cannot be pushed, so that boundary is unfenced.
  const s = structure(unfencedControl.ir);
  expect(s.selects.map(x => [x.role, x.rel.kind, x.fence])).toEqual([['root', 'Filter', 'root'], ['derived', 'Project', 'unfenced']]);
  expect(selects(compile(unfencedControl.ir).sql)).toBe(2);
});
it('Filter fence (slice 3b): justified only where the totality rule refused the fold; other derived tables under a Filter stay unfenced', () => {
  const fences = (root: import('@typedhouse/core').Rel) => structure(root).selects.map(x => `${x.role}:${x.rel.kind}:${x.fence}`);
  const fallible = (c: typeof components.row) => cast(c.countOfParts, col.String).eq('1');
  // Fallible over total, total over fallible, fallible over fallible: each boundary is a Filter fence and one SELECT per block.
  expect(fences(components.where(forTenant('acme')).where(fallible).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter']);
  expect(fences(components.where(fallible).where(forTenant('acme')).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter']);
  expect(fences(components.where(fallible).where(c => cast(c.countOfParts, col.String).ne('2')).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter']);
  // Over a join block (the residual is its WHERE) and over an aggregate block's HAVING.
  const j = join({ a: components, b: from(db.entity_ots_component) }).on(r => r.a.entityId.eq(r.b.entityId)).where(r => r.a.countOfParts.plus(r.b.countOfParts).gt(2n)).where(r => cast(r.a.countOfParts, col.String).eq('1')).map(r => ({ id: r.a.entityId }));
  expect(fences(j.ir)).toEqual(['root:Project:root', 'derived:Filter:Filter', 'join-input:Scan:Join', 'join-input:Scan:Join']); // both inputs are pruned derived tables
  expect(selects(compile(j.ir).sql)).toBe(4);
  const having = components.groupBy(c => ({ tenantId: c.tenantId })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)).where(r => cast(r.tenantId, col.UInt64).gt(1n));
  expect(fences(having.ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter']);
  // Not a Filter fence: a Filter over a folded computed selection (the slice 3 control), over a plain scan block with no
  // Filter clause (never a boundary; folds), and a fallible first HAVING (the pre-existing safe-HAVING gate, rel kind Aggregate).
  expect(fences(unfencedControl.ir)).toEqual(['root:Filter:root', 'derived:Project:unfenced']);
  expect(fences(components.where(fallible).ir)).toEqual(['root:Filter:root']);
  expect(fences(components.groupBy(c => ({ tenantId: c.tenantId })).aggregate(() => ({ n: count() })).where(r => cast(r.tenantId, col.UInt64).gt(1n)).ir)).toEqual(['root:Filter:root', 'derived:Aggregate:Aggregate']);
  // A total filter over a total WHERE never opens a boundary, so the fence is never claimed for one.
  expect(fences(components.where(forTenant('acme')).where(c => c.countOfParts.gt(1n)).ir)).toEqual(['root:Filter:root']);
  // Tester Finding 2: a computed selection over a join block whose held WHERE is non-total is an unfenced derived table
  // (the consumer is a Project, not a Filter); only `filterFence`'s consumer-kind check keeps it from being misread as a
  // Filter fence, since the inner block ends in a non-total Filter clause.
  const computed = join({ a: components, b: from(db.entity_ots_component) }).on(r => r.a.entityId.eq(r.b.entityId)).where(r => cast(r.a.countOfParts, col.String).eq('1')).map(r => ({ next: r.a.countOfParts.plus(1n) }));
  const over = structure(computed.ir).selects.filter(x => x.role === 'derived');
  expect(over.map(x => `${x.role}:${x.consumer?.kind} over ${x.rel.kind}:${x.fence}`)).toEqual(['derived:Project over Filter:unfenced']);
  expect(fences(computed.ir)).toContain('derived:Filter:unfenced');
  expect(fences(computed.ir)).not.toContain('derived:Filter:Filter');
});
it('negative control: the structure walk sees through CTE references, union branches, join inputs and subqueries', () => {
  const w = table('w', { id: col.UInt64, k: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] }), t = from(w);
  const shared = t.where(r => r.id.gt(1n)).cte();
  // `t` is shared by the materialized chain and the IN subquery, so the scan itself is a CTE too.
  const s = structure(shared.where(r => r.k.in(t.map(x => ({ k: x.k })))).ir);
  expect(s.selects.map(x => [x.role, x.rel.kind, x.fence])).toEqual([['cte', 'Scan', 'CTE'], ['cte', 'Filter', 'CTE'], ['root', 'Filter', 'root'], ['subquery', 'Project', 'Subquery']]);
  expect([...s.fences].sort()).toEqual(['CTE', 'Materialize', 'Subquery']);
  expect([...s.planned].sort()).toEqual(['CTE', 'Materialize', 'Subquery']);
  expect(s.scans.get('w')).toBe(1); // the subquery's scan is a separate pipeline on 24.8
  const union = structure(unionAll(t.where(r => r.id.gt(1n)), from(w)).ir);
  expect(union.selects.map(x => [x.role, x.rel.kind, x.fence])).toEqual([['union-branch', 'Filter', 'Union'], ['union-input', 'Filter', 'Union'], ['union-branch', 'Scan', 'Union'], ['union-input', 'Scan', 'Union']]);
  expect(union.scans.get('w')).toBe(2);
});

it('parses json and text EXPLAIN output alike, normalising analyzer qualifiers', () => {
  const json = '[{"Plan":{"Node Type":"Expression","Description":"(Project names + Projection)","Header":[{"Name":"__table1.id","Type":"UInt64"}],"Plans":[{"Node Type":"ReadFromMergeTree","Description":"default.w","Header":[{"Name":"id","Type":"UInt64"},{"Name":"k","Type":"Nullable(String)"}]}]}}]';
  const text = 'Expression ((Project names + Projection))\nHeader: __table1.id UInt64\n  ReadFromMergeTree (default.w)\n  Header: id UInt64\n          k Nullable(String)\n          parts Array(Tuple(id String, mpn Nullable(String)))\n';
  const fromJson = parseExplainJson(json), fromText = parseExplainText(text);
  expect(fromJson[0]!.type).toBe('Expression');
  expect(fromJson[0]!.header.map(columnName)).toEqual(['id']);
  expect(fromText[0]!.header.map(columnName)).toEqual(['id']);
  expect(flatten(fromJson).map(s => s.type)).toEqual(['Expression', 'ReadFromMergeTree']);
  expect(flatten(fromText).map(s => s.type)).toEqual(['Expression', 'ReadFromMergeTree']);
  expect(readTable(fromJson[1 - 1]!.children[0]!)).toBe('w');
  expect(fromText[0]!.children[0]!.header).toEqual(['id', 'k', 'parts']);
  expect(stepTypes.base).toContain('ReadFromMergeTree');
  // PREWHERE expressions and subcolumns stand for the physical columns they name; unknown names stay visible.
  expect(headerColumns(["plus(__table1.countOfParts, _CAST(1_UInt64, 'UInt64'_String))", 'countOfParts', 'entityId'], ['entityId', 'countOfParts'])).toEqual(['countOfParts', 'entityId']);
  expect(headerColumns(['tenantId', 'matched_part_ids.size0', 'category'], ['tenantId', 'category', 'matched_part_ids'])).toEqual(['tenantId', 'matched_part_ids', 'category']);
  expect(headerColumns(['__table1.waste', 'equals(__table2.spare, \'x\'_String)', 'odd.name'], ['id'])).toEqual(['waste', 'spare', 'odd.name']);
});
