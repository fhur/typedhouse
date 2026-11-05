import { describe, expect, it } from 'vitest';
import { col, count, from, join, Query, table, TableQuery, type Rel } from '../src/index.js';

const t = table(
  't',
  { id: col.UInt32, cat: col.String, n: col.Nullable(col.UInt32) },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const q = from(t);

describe('prewhere builder', () => {
  it('builds a node directly over the scan and returns a plain Query', () => {
    const filtered = q.prewhere(r => r.id.gt(1));
    expect(filtered).toBeInstanceOf(Query);
    expect(filtered).not.toBeInstanceOf(TableQuery);
    if (filtered.ir.kind !== 'Prewhere') throw new Error('wrong node');
    expect(filtered.ir.input).toBe(q.ir);
    expect(filtered.ir.output).toBe(q.ir.output);

    for (const name of ['prewhere', 'final', 'sample', 'insertMany'])
      expect((filtered as unknown as Record<string, unknown>)[name]).toBeUndefined();
  });

  it('keeps final and sample on its scan, in either order', () => {
    for (const source of [q.final().sample(0.5), q.sample(0.5).final()]) {
      const ir = source.prewhere(r => r.id.gt(1)).ir;
      if (ir.kind !== 'Prewhere') throw new Error('wrong node');
      expect(ir.input).toBe(source.ir);
      expect([ir.input.final, ir.input.sample]).toEqual([true, 0.5]);
    }
  });

  it('accepts Nullable boolean predicates', () => {
    expect(q.prewhere(r => r.n.gt(1)).ir.kind).toBe('Prewhere');
  });

  it('binds later operators to its own output and works as a join input', () => {
    const filtered = q.prewhere(r => r.id.gt(1));
    expect(filtered.where(r => r.cat.eq('x')).ir.kind).toBe('Filter');
    expect(filtered.row.id.ir).toMatchObject({ kind: 'ColumnRef', rel: filtered.ir.id });
    const joined = join({ a: filtered, b: q }).on(r => r.a.id.eq(r.b.id));
    expect((joined.ir as Extract<Rel, { kind: 'Join' }>).inputs[0]![1]).toBe(filtered.ir);
  });

  it('is not live', () => {
    const live = from(
      table(
        's',
        { id: col.UInt32 },
        { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], source: {} as never },
      ),
    );

    expect(live.caps.live).toBe(true);
    expect(live.prewhere(r => r.id.gt(1)).caps.live).toBe(false);
  });

  it('rejects a source that is not a scan, for JavaScript callers', () => {
    const fake = new TableQuery(q.where(r => r.id.gt(1)).ir, { live: false });

    expect(() =>
      fake.prewhere(() => {
        throw new Error('predicate ran');
      }),
    ).toThrow(/invalid_prewhere_source/);
  });

  it('rejects what is not a row predicate', () => {
    const js = q as unknown as { prewhere(f: (row: typeof q.row) => unknown): unknown };
    expect(() => js.prewhere(() => true)).toThrow(/invalid_predicate/);
    expect(() => js.prewhere(() => undefined)).toThrow(/invalid_predicate/);
    expect(() => js.prewhere(() => count())).toThrow(/invalid_predicate/);
    expect(() => js.prewhere(r => r.id.asc())).toThrow(/invalid_predicate/);
  });
});
