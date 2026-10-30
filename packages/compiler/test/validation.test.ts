import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { col, count, crossJoin, join, scalar, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import * as structural from '../src/validate-structure.js';
import { categories, mutation, recipes, seed, source, type Recipe } from './validation-arbitrary.js';

function check(recipe: Recipe) {
  const { root, code, path, offending } = mutation(recipe);
  for (const emit of [compile, emitNaive]) {
    let caught: unknown;
    try { emit(root); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught).toMatchObject({ code, path });
    expect((caught as ValidationError).node).toBe(offending);
  }
}
for (const category of categories) it(`fixed structural anchor: ${category}`, () => check({ category, wrappers: [], value: 3 }));
it('500 meaningful mutation recipes, with exact diagnostics for both emitters', () => {
  const coverage = new Set<string>();
  const start = performance.now();
  fc.assert(fc.property(recipes, recipe => { check(recipe); coverage.add(recipe.category); }), { seed, numRuns: 500 });
  expect([...coverage].sort()).toEqual([...categories].sort());
  console.info(`structural mutations: runs=500 seed=${seed} categories=${coverage.size} durationMs=${Math.round(performance.now() - start)}`);
});
it('a missing-child guard bypass really fails, shrinks and replays the minimized diagnostic mismatch', () => {
  const validate = structural.validateStructure;
  // Fault injection bypasses precisely the missing relation input check. The
  // emitter still sees the malformed graph, and must not count invalid_ir as success.
  const spy = vi.spyOn(structural, 'validateStructure').mockImplementation(root => {
    const patched = structuredClone(root);
    let cursor = patched;
    while ('input' in cursor && cursor.input !== undefined) cursor = cursor.input;
    Object.assign(cursor, { input: source.ir });
    validate(patched);
  });
  try {
    const arbitrary = fc.record({ category: fc.constant('input' as const), wrappers: fc.array(fc.constantFrom('distinct' as const, 'limit' as const), { maxLength: 6 }), value: fc.integer({ min: 0, max: 10000 }) });
    expect(fc.sample(arbitrary, { seed, numRuns: 1 })[0]!.wrappers.length).toBeGreaterThan(0);
    const property = fc.property(arbitrary, check);
    const result = fc.check(property, { seed, numRuns: 100 });
    expect(result.failed).toBe(true);
    expect(result.numShrinks).toBeGreaterThan(0);
    expect(result.counterexample).toEqual([{ category: 'input', wrappers: [], value: 0 }]);
    if (result.counterexamplePath === null) throw new Error('missing failure replay path');
    const replay = fc.check(property, { seed: result.seed, path: result.counterexamplePath, endOnFailure: true });
    expect(replay.failed).toBe(true);
    expect(replay.counterexample).toEqual(result.counterexample);
    console.info(`guard bypass: seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks}`);
  } finally { spy.mockRestore(); }
});
it('shared DAGs, operators, subqueries and manual IR retain SQL/schema/params/warnings without mutation', () => {
  const shared = val(7n, col.UInt64);
  const filtered = source.where(r => r.id.gt(2n));
  const rollup = filtered.aggregate(() => ({ n: count() }));
  const joined = join({ a: filtered, b: filtered }).on(r => r.a.id.eq(r.b.id));
  const controls = [source, filtered, filtered.map(r => ({ id: r.id, a: shared, b: shared, c: val(7n, col.UInt64) })), rollup,
    joined, crossJoin({ a: joined, b: joined }), source.arrayJoin(r => r.tags, 'tag'), unionAll(filtered, filtered),
    filtered.orderBy(r => r.id).limit(4, 1).distinct(), filtered.cte(),
    filtered.map(() => ({ n: scalar(rollup) })), source.where(r => r.id.in(filtered.map(r => r.id))),
  ];
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    for (const query of controls) {
      const before = structuredClone(query.ir);
      for (const emit of [compile, emitNaive]) {
        warning.mockClear();
        const bypass = vi.spyOn(structural, 'validateStructure').mockImplementation(() => {});
        let expected;
        try { expected = emit(query.ir); } finally { bypass.mockRestore(); }
        const count = warning.mock.calls.length;
        warning.mockClear();
        // A cloned graph is low-level IR without private constructor membership.
        const actual = emit(before);
        expect(actual).toEqual(expected);
        expect(warning).toHaveBeenCalledTimes(count);
        expect(count).toBe(0);
      }
      expect(query.ir).toEqual(before);
    }
    expect(Object.values(compile(controls[2]!.ir).params).filter(v => v === '7')).toHaveLength(2);
  } finally { warning.mockRestore(); }
});
it('parameter values remain data, and serializer failures keep their semantic diagnostic', () => {
  const root = structuredClone(source.map(() => ({ p: val('ok') })).ir);
  if (root.kind !== 'Project') throw new Error('fixture');
  const value: unknown[] = []; value.push(value);
  const expr = { ...root.exprs.p!, value };
  const forged = { ...root, exprs: { p: expr } } as Rel;
  expect(() => structural.validateStructure(forged)).not.toThrow();
  for (const emit of [compile, emitNaive]) expect(() => emit(forged)).toThrowError(expect.objectContaining({ code: 'param_incompatible', path: 'root.exprs.p' }));
});
it('all recursive descriptor edges detect cycles while shared descriptor DAGs pass', () => {
  const s = col.String.type;
  const descriptors: [Record<string, unknown>, string][] = [
    [{ kind: 'Nullable', inner: s }, 'inner'], [{ kind: 'LowCardinality', inner: s }, 'inner'],
    [{ kind: 'Array', inner: s }, 'inner'], [{ kind: 'Map', key: s, value: s }, 'value'],
    [{ kind: 'Tuple', items: [{ type: s }, { type: s }] }, 'items[1].type'],
    [{ kind: 'Variant', items: [s, s] }, 'items[1]'],
    [{ kind: 'AggregateFunction', fn: 'sum', args: [s, s] }, 'args[1]'],
    [{ kind: 'SimpleAggregateFunction', fn: 'sum', inner: s }, 'inner'],
  ];
  for (const [descriptor, edge] of descriptors) {
    // Intentional malformed descriptor boundary; no production inference casts.
    const root = { ...source.ir, output: { shape: 'flat', order: ['x'], columns: { x: descriptor } } } as unknown as Rel;
    expect(() => structural.validateStructure(root)).not.toThrow();
    const segments = edge.replaceAll('[', '.').replaceAll(']', '').split('.');
    let parent = descriptor;
    for (const key of segments.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[segments.at(-1)!] = descriptor;
    for (const emit of [compile, emitNaive]) expect(() => emit(root)).toThrowError(expect.objectContaining({ code: 'cyclic_ir', path: `root.output.columns.x.${edge}`, node: descriptor }));
  }
});
it('unsupported but well-shaped variants stay semantic errors, with no hidden graph edges', () => {
  const bool = val(true).ir;
  const expressions = [
    { ...bool, kind: 'Literal' },
    { ...bool, kind: 'Raw', opaque: true, resolution: 'declared', provenance: { origin: 'sql' }, parts: ['true'], args: [] },
    { ...bool, kind: 'Case', branches: [{ when: bool, then: bool }], otherwise: bool },
  ];
  for (const expr of expressions) {
    const root = { ...source.where(() => val(true)).ir, pred: expr } as unknown as Rel;
    expect(() => structural.validateStructure(root)).not.toThrow();
    for (const emit of [compile, emitNaive]) expect(() => emit(root)).toThrowError(expect.objectContaining({ code: 'unsupported_expression', path: 'root.pred' }));
  }
  const raw = { ...source.ir, kind: 'RawRel', opaque: true, provenance: { origin: 'sql.relation' }, parts: ['SELECT 1'], args: [] } as unknown as Rel;
  expect(() => structural.validateStructure(raw)).not.toThrow();
  for (const emit of [compile, emitNaive]) expect(() => emit(raw)).toThrowError(expect.objectContaining({ code: 'unsupported_node', path: 'root' }));
});
it('explicit stack identifies a long cycle without imposing a depth cutoff', () => {
  const root = structuredClone(source.distinct().ir);
  let cursor = root;
  for (let i = 0; i < 12000; i++) {
    const next = { ...root };
    if (cursor.kind !== 'Distinct') throw new Error('fixture');
    Object.assign(cursor, { input: next }); cursor = next;
  }
  Object.assign(cursor, { input: root });
  expect(() => structural.validateStructure(root)).toThrowError(expect.objectContaining({ code: 'cyclic_ir', path: 'root' + '.input'.repeat(12001) }));
});
