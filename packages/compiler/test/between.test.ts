import { expect, it } from 'vitest';
import { col, countIf, from, quantile, table, val } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
const q = from(table('ranges', { n: col.UInt64, lo: col.UInt64, hi: col.Nullable(col.UInt64), at: col.DateTime64(3, 'Europe/Amsterdam'), text: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('resolves both bounds from the receiver, uses UTC wire types and never inlines values', () => {
  for (const emit of [compile, emitNaive]) {
    const compiled = emit(q.where(r => r.at.between(new Date('2026-03-29T00:59:59.123Z'), new Date('2026-03-29T01:00:00.456Z'))).ir);
    expect(compiled.sql).toContain("BETWEEN (CAST({p0:DateTime64(3, 'UTC')} AS DateTime64(3, 'Europe/Amsterdam'))) AND (CAST({p1:DateTime64(3, 'UTC')} AS DateTime64(3, 'Europe/Amsterdam')))");
    expect(compiled.params).toEqual({ p0: '2026-03-29 00:59:59.123', p1: '2026-03-29 01:00:00.456' });
    expect(compiled.sql).not.toContain('2026-03-29');
    expect(emit(q.where(r => r.text.between("a' OR 1=1", 'z')).ir).params).toEqual({ p0: "a' OR 1=1", p1: 'z' });
  }
});
it('retains separate equal-valued Params, shared constants, root names and nullable Bool', () => {
  const shared = val(3n, col.UInt64);
  for (const emit of [compile, emitNaive]) {
    expect(emit(q.map(r => r.n.between(3n, 3n)).ir).params).toEqual({ p0: '3', p1: '3' });
    const compiled = emit(q.map(r => r.n.between(shared, shared)).ir);
    expect(compiled.params).toEqual({ p0: '3' });
    expect(compiled.sql.match(/\{p0:UInt64\}/g)).toHaveLength(2);
    expect(compiled.columns).toEqual({ n: col.Bool.type });
    expect(emit(q.map(r => r.n.between(r.lo, r.hi)).ir).columns).toEqual({ n: col.Nullable(col.Bool).type });
    expect(emit(q.map(r => r.n.between(null, 3n)).ir).sql).toContain('CAST(NULL AS Nullable(UInt64))');
    expect(emit(q.aggregate(g => ({ tally: countIf(g.n.between(g.lo, g.hi)) })).ir).columns).toEqual({ tally: col.UInt64.type });
  }
});
it('rejects volatile receiver lowering and preserves precision on both wire bounds', () => {
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(q.aggregate(g => ({ flag: quantile(0.5)(g.n).between(0, 1) })).ir)).toThrow('unsupported_between_receiver');
    for (const precision of [0, 1, 2, 3] as const) {
      const dates = from(table('dates', { at: col.DateTime64(precision, 'Europe/Amsterdam') }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
      const compiled = emit(dates.where(r => r.at.between(new Date('2026-03-29T01:00:00.123Z'), new Date('2026-03-29T01:00:00.123Z'))).ir);
      expect(compiled.parameterTypes).toEqual({ p0: col.DateTime64(precision, 'UTC').type, p1: col.DateTime64(precision, 'UTC').type });
      const value = precision === 0 ? '2026-03-29 01:00:00' : '2026-03-29 01:00:00.' + '123'.slice(0, precision);
      expect(compiled.params).toEqual({ p0: value, p1: value });
    }
  }
});
it('validates unsupported runtime operands instead of widening numeric families', () => {
  for (const emit of [compile, emitNaive]) {
    // Deliberately invalid JavaScript; separate exact diagnostics cover the API.
    // @ts-expect-error number cannot bound bigint
    expect(() => emit(q.where(r => r.n.between(val(1), 3n)).ir)).toThrow('incompatible_operands');
    // @ts-expect-error wrong primitive
    expect(() => emit(q.where(r => r.n.between(1, 3n)).ir)).toThrow('param_incompatible');
  }
});
