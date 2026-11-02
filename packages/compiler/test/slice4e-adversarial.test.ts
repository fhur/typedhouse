import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { col, from, invoke, leftJoin, methodCatalog, print, table, val, type CHType, type Column, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { nullRejecting, safePredicate, totalPredicate } from '../src/rewrite-expressions.js';
import { rewriteRel } from '../src/rewrite-rel.js';

/** Slice 4e Tester probes. Catalog sweep: every method-catalog function x receiver kind x JS operand, recording the
 * builder's IR type, the planned/naive column types and SQL (or the error). `SLICE4E_SWEEP=<file>` dumps the table so a
 * flipped `resolveReturn` can be diffed against the shipped one. */
const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };
const lcn = <T, D extends CHType>(c: Column<T, boolean, D>) => col.LowCardinality(col.Nullable(c));
const cols = {
  s: col.String, ns: col.Nullable(col.String), lc: col.LowCardinality(col.String), lcn: lcn(col.String),
  u32: col.UInt32, nu32: col.Nullable(col.UInt32), lu32: col.LowCardinality(col.UInt32), lnu32: lcn(col.UInt32),
  u64: col.UInt64, lnu64: lcn(col.UInt64), f64: col.Float64, lnf: lcn(col.Float64), i32: col.Int32, lni: lcn(col.Int32),
  e8: col.Enum8({ a: 1, b: 2 }), ne8: col.Nullable(col.Enum8({ a: 1, b: 2 })), le8: col.LowCardinality(col.Enum8({ a: 1, b: 2 })),
  dec: col.Decimal(10, 2), ndec: col.Nullable(col.Decimal(10, 2)),
  d: col.Date, ld: col.LowCardinality(col.Date), lnd: lcn(col.Date),
  dt64: col.DateTime64(3, 'UTC'), ndt64: col.Nullable(col.DateTime64(3, 'UTC')),
  fs: col.FixedString(2), lfs: col.LowCardinality(col.FixedString(2)), lnfs: lcn(col.FixedString(2)),
  saf: col.SimpleAggregateFunction('max', col.UInt32), saflc: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
  saflcn: col.SimpleAggregateFunction('max', lcn(col.String)),
  as: col.Array(col.String), alc: col.Array(col.LowCardinality(col.String)), alcn: col.Array(lcn(col.String)), anu: col.Array(col.Nullable(col.UInt32)),
  ip: col.IPv4, lip: col.Nullable(col.IPv4), uuid: col.UUID, nuuid: col.Nullable(col.UUID), b: col.Bool, nb: col.Nullable(col.Bool),
};
const t = from(table('t', cols, meta));
const values: [string, unknown][] = [['str', 'ab'], ['int', 1], ['big', 1n], ['flt', 1.5], ['bool', true], ['date', new Date(Date.UTC(2020, 0, 2))], ['arrS', ['ab']], ['arrN', [1]], ['null', null], ['typedS', 'TS'], ['typedU', 'TU']];
const show = (f: () => string) => { try { return f(); } catch (e) { return `!${(e as Error).message}`; } };

it('catalog sweep: builder type = resolver type wherever the call compiles, and a dump for the flip diff', () => {
  const rows: string[] = [];
  let compiled = 0;
  for (const def of methodCatalog) {
    if (def.args.length < 1 || def.args.length > 3) continue;
    for (const key of Object.keys(cols)) {
      for (const [vname, v] of values) {
        const js = vname === 'typedS' ? val('ab') : vname === 'typedU' ? val(1, col.UInt32) : v;
        const args = (r: any) => [r[key], ...Array.from({ length: def.args.length - 1 }, () => js)];
        let builder = '';
        let q: { ir: any } | undefined;
        try { const built = t.map(r => ({ x: invoke(def, args(r)) as never })); q = built; builder = print((built.ir as any).exprs.x.type); } catch (e) { builder = `!${(e as Error).message}`; }
        if (!q) { rows.push(`${def.name}|${key}|${vname}|${builder}`); continue; }
        const p = show(() => { const c = compile(q!.ir); return `${Object.values(c.columns).map(print).join()} ¦ ${c.sql} ¦ ${JSON.stringify(c.params, (_, x) => typeof x === 'bigint' ? `${x}n` : x)}`; });
        const n = show(() => { const c = emitNaive(q!.ir); return `${Object.values(c.columns).map(print).join()} ¦ ${c.sql}`; });
        if (!p.startsWith('!')) {
          compiled++;
          // Agreement: the compiled column type is the builder's IR type (the resolver throws otherwise).
          expect(p.split(' ¦ ')[0], `${def.name}/${key}/${vname}`).toBe(builder);
          expect(n.startsWith('!'), `${def.name}/${key}/${vname} naive`).toBe(false);
        }
        rows.push(`${def.name}|${key}|${vname}|${builder}|${p}|${n}`);
      }
    }
  }
  expect(compiled).toBeGreaterThan(500);
  if (process.env.SLICE4E_SWEEP) writeFileSync(process.env.SLICE4E_SWEEP, rows.join('\n') + '\n');
});

it('ifNull rule: every fallback kind over LC(Nullable) receivers, incl. Enum8, Decimal, DateTime64(3,UTC), IPv4, UUID', () => {
  const x = from(table('x', {
    le: lcn(col.String), s: col.String, ns: col.Nullable(col.String), lc: col.LowCardinality(col.String), other: lcn(col.String),
  }, meta));
  const cases: [string, (r: any) => unknown, string, boolean][] = [
    ['param', r => r.le.ifNull('z'), 'LowCardinality(String)', false],
    ['typed param', r => r.le.ifNull(val('z')), 'LowCardinality(String)', false],
    ['null param', r => r.le.ifNull(null), 'LowCardinality(Nullable(String))', false],
    ['nullable typed param', r => r.le.ifNull(val(null, col.Nullable(col.String))), 'LowCardinality(Nullable(String))', false],
    ['column', r => r.le.ifNull(r.s), 'LowCardinality(String)', true],
    ['lc column', r => r.le.ifNull(r.lc), 'LowCardinality(String)', true],
    ['other lcn column', r => r.le.ifNull(r.other), 'LowCardinality(Nullable(String))', true],
    ['nullable column', r => r.le.ifNull(r.ns), 'LowCardinality(Nullable(String))', true],
    ['nested', r => r.le.ifNull(r.other.ifNull('q')), 'LowCardinality(String)', true],
    ['ifNull over ifNull (inner wrapped, outer Param)', r => r.le.ifNull(r.other).ifNull('q'), 'LowCardinality(String)', true],
  ];
  for (const [name, f, type, wrapped] of cases) {
    const q = x.map(r => ({ v: f(r) as never }));
    expect(print((q.ir as any).exprs.v.type), name).toBe(type);
    for (const c of [compile(q.ir), emitNaive(q.ir)]) {
      expect(print(c.columns.v!), name).toBe(type);
      expect(/toLowCardinality\(ifNull/.test(c.sql), `${name}: ${c.sql}`).toBe(wrapped);
    }
  }
  // Other receivers: ifNull(LC(Nullable(T)) for T outside the Worker's probe is not expressible as a ClickHouse
  // column for Enum/Decimal/DateTime64/IPv4/UUID? Record what the builder/compiler say.
  const y = from(table('y', {
    le8: lcn(col.Enum8({ a: 1, b: 2 })), ldec: lcn(col.Decimal(10, 2)), ldt64: lcn(col.DateTime64(3, 'UTC')), lip: lcn(col.IPv4), luuid: lcn(col.UUID),
  }, meta));
  const out: Record<string, string> = {};
  for (const [k, v] of [['le8', 'a'], ['ldec', '1.5'], ['ldt64', new Date(0)], ['lip', '1.2.3.4'], ['luuid', '00000000-0000-0000-0000-000000000001']] as const) {
    out[k] = show(() => { const q = y.map(r => ({ v: (r as any)[k].ifNull(v) as never })); const c = compile(q.ir); const n = emitNaive(q.ir); return `${print((q.ir as any).exprs.v.type)} | ${print(c.columns.v!)} | ${print(n.columns.v!)} | ${c.sql}`; });
  }
  // Enum8/Decimal/IPv4/UUID JS fallbacks are param_incompatible exactly as for their Nullable twins (pre-existing; and
  // 24.8 rejects LC(Nullable) DDL for Enum8, Decimal and DateTime64 anyway, see the native probe).
  for (const k of ['le8', 'ldec', 'lip', 'luuid']) expect(out[k], k).toMatch(/^!param_incompatible/);
  expect(out.ldt64).toBe("LowCardinality(DateTime64(3, 'UTC')) | LowCardinality(DateTime64(3, 'UTC')) | LowCardinality(DateTime64(3, 'UTC')) | SELECT ifNull(`ldt64`, {p0:DateTime64(3, 'UTC')}) AS `v` FROM `y`");
});

it('total fragment: LC(Nullable) ifNull is total but never safe, and a WHERE over it never converts a LEFT join', () => {
  const A = from(table('a', { id: col.UInt32, s: col.String }, meta));
  const B = from(table('b', { id: col.UInt32, lc: col.LowCardinality(col.String), s: col.String }, meta));
  const lj = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  const kinds = (root: Rel): string[] => { const out: string[] = []; const seen = new Set<Rel>(); const visit = (r: Rel): void => { if (seen.has(r)) return; seen.add(r); if (r.kind === 'Join') out.push(r.joinKind); for (const v of Object.values(r)) { if (v && typeof v === 'object' && 'kind' in v && 'id' in v) visit(v as Rel); } }; visit(root); return out; };
  const no = [
    lj().where(r => r.b.lc.ifNull('x').eq('x')), lj().where(r => r.b.lc.ifNull('x').ne('y')), lj().where(r => r.b.lc.ifNull(r.b.s).eq('x')),
    lj().where(r => r.b.lc.ifNull(r.a.s).eq('x')), lj().where(r => r.b.lc.ifNull('x').eq('x').and(r.a.id.gt(0))),
    lj().where(r => r.b.lc.ifNull('x').eq('x').or(r.b.lc.eq('y'))), lj().where(r => r.b.lc.ifNull('x').eq(r.b.lc.ifNull('y'))),
    lj().where(r => r.b.lc.ifNull('x').isNotNull()), lj().where(r => r.b.lc.ifNull(null).isNotNull().not()),
  ];
  for (const q of no) {
    expect(kinds(rewriteRel(q.ir).root), compile(q.ir).sql).toEqual(['left']);
    expect(compile(q.ir).sql).toMatch(/LEFT/);
  }
  // Positive control: a null-rejecting conjunct alongside still converts.
  expect(kinds(rewriteRel(lj().where(r => r.b.lc.eq('x').and(r.b.lc.ifNull('x').eq('x'))).ir).root)).toEqual(['inner']);
  const f = lj().where(r => r.b.lc.ifNull('x').eq('x')).ir;
  if (f.kind !== 'Filter') throw new Error('filter');
  expect([nullRejecting(f.pred, f.input.id, 'b'), nullRejecting(f.pred, f.input.id, 'a')]).toEqual([false, false]);
  expect(totalPredicate(f.pred)).toBe(true);
  expect(safePredicate(f.pred)).toBe(false);
});

it('aggregates through resolveReturn: a JS argMax value beside an LC/LC(Nullable) version types as the compiler does', async () => {
  const { argMax, max, sum } = await import('@typedhouse/core');
  const out: Record<string, string> = {};
  for (const k of ['lc', 'lcn', 'lu32', 'lnu32', 'u32', 'nu32'] as const) {
    for (const [name, f] of [['argMax(js, k)', (r: any) => (argMax as any)('ab', r[k])], ['argMax(k, js)', (r: any) => (argMax as any)(r[k], 1)], ['max(k)', (r: any) => (max as any)(r[k])], ['sum(k)', (r: any) => (sum as any)(r[k])]] as const) {
      out[`${name}/${k}`] = show(() => { const q = (t as any).aggregate((r: any) => ({ v: f(r) })); const c = compile(q.ir); return `${print((q.ir as any).aggs?.v?.type ?? (q.ir as any).exprs?.v?.type)} | ${print(c.columns.v!)} | ${print(emitNaive(q.ir).columns.v!)}`; });
    }
  }
  if (process.env.SLICE4E_SWEEP) writeFileSync(`${process.env.SLICE4E_SWEEP}.agg`, JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out)) if (!v.startsWith('!')) { const [b, p, n] = v.split(' | '); expect(p, k).toBe(b); expect(n, k).toBe(b); }
});

/** emitNaive / compile fingerprint over the fixture corpus and every seeded client arbitrary (700 samples each). Under the
 * shipped tree no generated query emits toLowCardinality (none uses an LC(Nullable) receiver with an expression fallback);
 * `SLICE4E_FINGERPRINT=<file>` dumps sql + params + rule hits so HEAD sources and flips can be diffed byte-for-byte. */
it('fingerprint: corpus + seeded arbitraries compile; no toLowCardinality anywhere', async () => {
  const fc = (await import('fast-check')).default;
  const out: string[] = [];
  const record = (label: string, ir: any) => {
    const p = show(() => { const c = compile(ir); return `${c.sql} ${JSON.stringify(c.params, (_, x) => typeof x === 'bigint' ? `${x}n` : x)} ${Object.values(c.columns).map(print).join()} ${JSON.stringify(rewriteRel(ir).hits)}`; });
    const n = show(() => emitNaive(ir).sql);
    expect(p + n, label).not.toContain('toLowCardinality');
    out.push(`${label}\n  P ${p}\n  N ${n}`);
  };
  const corpus = (import.meta as any).glob('./fixtures/corpus/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
  for (const [file, mod] of Object.entries(corpus)) {
    for (const [name, value] of Object.entries(mod)) {
      if (value && typeof value === 'object' && 'ir' in value) record(`${file}:${name}`, (value as any).ir);
      if (Array.isArray(value)) value.forEach((e: any, i) => { if (e?.query?.ir) record(`${file}:${name}[${i}]`, e.query.ir); });
    }
  }
  const arbitraries = (import.meta as any).glob('../../client/test/*-arbitrary.ts', { eager: true }) as Record<string, Record<string, any>>;
  for (const [file, mod] of Object.entries(arbitraries)) {
    const pairs: [string, any, (r: any) => any][] = [];
    const arb = mod.recipeArbitrary ?? mod.recipes;
    if (arb && mod.build) pairs.push(['recipe', arb, mod.build]);
    if (mod.colliding && mod.buildColliding) pairs.push(['colliding', mod.colliding, mod.buildColliding]);
    for (const [kind, a, build] of pairs) {
      fc.sample(a, { seed: mod.seed, numRuns: process.env.SLICE4E_FINGERPRINT ? 700 : 40 }).forEach((r: any, i: number) => {
        let ir: any;
        try { ir = build(r).ir; } catch (e) { out.push(`${file}:${kind}:${i} build !${(e as Error).message}`); return; }
        record(`${file}:${kind}:${i}`, ir);
      });
    }
  }
  expect(out.length).toBeGreaterThan(400);
  if (process.env.SLICE4E_FINGERPRINT) writeFileSync(process.env.SLICE4E_FINGERPRINT, out.join('\n') + '\n');
}, 120000);
