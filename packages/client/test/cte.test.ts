import { expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import { crossJoin } from '@typedhouse/core';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { build, recipeArbitrary, seed, shape } from './cte-arbitrary.js';
import { source } from './pruning-arbitrary.js';
const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@clickhouse/client', () => ({ createClient: () => driver }));
it('500 variable shared DAGs preserve metadata, input graph, Param numbering and deterministic compilation', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const shapes = new Set<string>();
    fc.assert(fc.property(recipeArbitrary, r => {
      const q = build(r), original = JSON.stringify(q.ir), a = compile(q.ir), b = emitNaive(q.ir);
      expect(a.columns).toEqual(b.columns); expect(a.columnPaths).toEqual(b.columnPaths); expect(a.nodes).toEqual(b.nodes);
      expect(compile(q.ir)).toEqual(a); expect(JSON.stringify(q.ir)).toBe(original);
      expect(a.sql).not.toContain('*');
      expect([...new Set([...a.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(a.params));
      shapes.add(shape(r));
    }), { seed, numRuns: 500 });
    expect(shapes.size).toBeGreaterThan(100);
  } finally { warning.mockRestore(); }
});
it('rejects captured references and invalid discarded expressions before official driver IO in both backends', async () => {
  const foreign = source.limit(1);
  const shared = source.map(() => ({ id: foreign.row.id, amount: source.row.amount }));
  const q = crossJoin({ a: shared, b: shared }).map(r => r.a.amount);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) {
    const backend = createClickHouseBackend({}, mode), client = createClientFromBackend(backend);
    expect(() => backend.compile(q.ir)).toThrow(ValidationError);
    await expect(client.run(q)).rejects.toMatchObject({ code: 'unbound_column', node: shared.ir.kind === 'Project' ? shared.ir.exprs.id : null });
    expect(driver.query).not.toHaveBeenCalled();
    await backend.close();
  }
});
