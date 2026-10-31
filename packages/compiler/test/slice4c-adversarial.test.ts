import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { col, count, max, from, join, leftJoin, rightJoin, fullJoin, table, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { entries } from './fixtures/corpus/explain-corpus.js';
import * as lowStock from './fixtures/corpus/low-stock.js';
import * as supported from './fixtures/corpus/supported-types.js';
import { componentsLatest } from './fixtures/corpus/components-latest.js';
import { stockHistory } from './fixtures/corpus/stock-history.js';
import { projectionEnrichment } from './fixtures/corpus/projection-enrichment.js';
import { knownHash, knownUnique } from './fixtures/corpus/known-functions.js';
import { userEditDistance } from './fixtures/corpus/user-functions.js';

// Tester probes for slice 4c (Docker-free half). Native agreement lives in packages/client/test/slice4c-adversarial.integration.ts.
const m = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const cols = { id: col.UInt32, s: col.String, n: col.Int64, lc: col.LowCardinality(col.String) };
const A = from(table('xa', cols, m)), B = from(table('xb', cols, m)), C = from(table('xc', { id: col.UInt32, v: col.String, N: col.Int64 }, m));
const derived = (sql: string) => /AS `__typedhouse_input`\s*(\n|$|GROUP|WHERE|HAVING|ORDER)/.test(sql);
const kinds = [
  ['inner', () => join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id))],
  ['left', () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id))],
  ['right', () => rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id))],
  ['full', () => fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id))],
  ['converted', () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n))],
] as const;
const fenced = (root: Rel) => { const c = compile(root); expect(c.columns).toEqual(emitNaive(root).columns); return derived(c.sql); };

it('identity exemption: shared-name identity keys fold beside qualified readers and fence only on HAVING/ORDER BY', () => {
  for (const [k, q] of kinds) {
    const j = q() as any;
    expect(fenced(j.groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ m: max(g.b.id) })).ir), k).toBe(false);
    expect(fenced(j.groupBy((r: any) => ({ id: r.a.id, bid: r.b.id })).aggregate(() => ({ c: count() })).ir), k).toBe(false);
    expect(fenced(j.groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).distinct().ir), k).toBe(false);
    expect(fenced(j.where((r: any) => r.a.n.gt(r.b.n)).groupBy((r: any) => ({ n: r.b.n })).aggregate((g: any) => ({ m: max(g.a.n) })).ir), k).toBe(false);
    expect(fenced(j.groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).orderBy((r: any) => r.id).ir), k).toBe(true);
    expect(fenced(j.groupBy((r: any) => ({ id: r.b.id })).aggregate(() => ({ c: count() })).distinct().orderBy((r: any) => r.id).ir), k).toBe(true);
    // Non-identity alias in N read only qualified (no HAVING/ORDER BY): fenced by the brief's conservative rule.
    expect(fenced(j.groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n2: max(g.b.n), n: count() })).ir), k).toBe(true);
    // Output alias equal to a join input alias: not in N, folds; plan-ctes renames the physical aliases.
    const sql = compile(j.groupBy((r: any) => ({ a: r.b.s })).aggregate((g: any) => ({ b: max(g.a.n) })).orderBy((r: any) => r.a).ir).sql;
    expect(derived(sql), k).toBe(false);
    expect(sql).toContain('AS `a_`');
  }
});

it('clausesRead: HAVING/ORDER BY reachable through Limit/Distinct and expression sort keys fence; unrelated clauses do not', () => {
  const base = () => join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: count(), top: max(g.b.n) }));
  expect(fenced(base().distinct().orderBy(r => r.n).ir)).toBe(true);
  expect(fenced(base().limit(3).where(r => r.n.gt(1n)).ir)).toBe(true);
  expect(fenced(base().orderBy(r => r.n.plus(1n)).ir)).toBe(true);
  // `n` is still a column of both inputs and is read by max(b.n): the brief's "another aggregate" condition fences too.
  expect(fenced(base().where(r => r.top.gt(1n)).ir)).toBe(true);
  // Non-colliding names keep the fold with HAVING and ORDER BY.
  expect(fenced(join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ key: r.a.lc })).aggregate(g => ({ c: count(), top: max(g.b.n) })).where(r => r.c.gt(0n)).orderBy(r => r.key).ir)).toBe(false);
  // Case: `N` (only xc) vs `n` (xa/xb).
  const three = join({ a: A, b: B, c: C }).on(r => [r.a.id.eq(r.b.id), r.b.id.eq(r.c.id)]);
  expect(fenced(three.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ N: max(g.a.id) })).orderBy(r => r.N).ir)).toBe(true);
  expect(fenced(three.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ NN: max(g.a.id) })).orderBy(r => r.NN).ir)).toBe(false);
});

it('lowStock expectedSql is byte-identical and the CTE `version: max(version)` keeps its fold', () => {
  expect(compile(lowStock.query.ir).sql).toBe(lowStock.expectedSql);
  expect(compile(lowStock.query.ir).sql).toContain('max(`version`) AS `version` FROM `t0` GROUP BY');
});

// Before/after corpus dump: TH_DUMP_PATH=<file> writes compile(q).sql and emitNaive(q).sql for every corpus query.
it('corpus dump (TH_DUMP_PATH)', () => {
  const out: Record<string, { sql: string; naive: string }> = {};
  const add = (id: string, root: Rel) => { out[id] = { sql: compile(root).sql, naive: emitNaive(root).sql }; };
  for (const e of entries) add(`explain/${e.id}`, e.query.ir);
  for (const [name, v] of Object.entries(supported)) if (v && typeof v === 'object' && 'ir' in v) add(`supported/${name}`, (v as { ir: Rel }).ir);
  add('lowStock', lowStock.query.ir);
  add('categoryRollup', lowStock.categoryRollup('acme').ir);
  add('componentsLatest', componentsLatest.ir);
  add('stockHistory', stockHistory(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z')).ir);
  add('projectionEnrichment', projectionEnrichment.ir);
  add('knownHash', knownHash.ir); add('knownUnique', knownUnique.ir); add('userEditDistance', userEditDistance.ir);
  expect(Object.keys(out).length).toBeGreaterThan(80);
  if (process.env.TH_DUMP_PATH) writeFileSync(process.env.TH_DUMP_PATH, JSON.stringify(out, null, 1));
});

// Differential review: TH_COLLIDING_DUMP=<file> writes the planned SQL of the same fc.check stream the 500-run 4c suite
// draws (same seed/numRuns), so the stream can be compared against HEAD's planner (newly fenced = actual capture risk).
it('colliding stream dump (TH_COLLIDING_DUMP)', async () => {
  const fc = (await import('fast-check')).default;
  const { colliding, buildColliding, collidingShape, seed } = await import('../../client/test/join-block-arbitrary.js');
  const out: [string, string][] = [];
  fc.assert(fc.property(colliding, r => { out.push([collidingShape(r), compile(buildColliding(r).ir).sql]); }), { seed, numRuns: 500 });
  expect(out.length).toBe(500);
  if (process.env.TH_COLLIDING_DUMP) writeFileSync(process.env.TH_COLLIDING_DUMP, JSON.stringify(out));
});
