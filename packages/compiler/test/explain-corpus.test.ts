import { expect, it } from 'vitest';
import { col, from, print, table, unionAll } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { entries, unfencedControl, type FenceKind } from './fixtures/corpus/explain-corpus.js';
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
