import { expect, it } from 'vitest';
import { col, table, exprNode, relNode, flatOutput } from '../src/index.js';
const t = table('source', { x: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const output = flatOutput([['x', col.String.type]]);
const scan = () => relNode({ kind: 'Scan', table: t, columns: t.columns, output });
it('allocates fresh monotonically increasing ids, without structural interning', () => {
  const a = scan(), b = scan();
  const p = exprNode({ kind: 'Param', type: null, value: 'x' });
  expect(a.id).toBeLessThan(b.id); expect(b.id).toBeLessThan(p.id);
  expect(a).not.toBe(b); expect(p.kind).toBe('Param'); expect(p.type).toBeNull();
});
it('preserves shared parent identity and snapshots containers without freezing caller objects', () => {
  const a = scan(); const inputs = [a, a];
  const union = relNode({ kind: 'Union', inputs, all: true, output });
  inputs.pop();
  expect(union.inputs).toEqual([a, a]); expect(union.inputs[0]).toBe(a);
  expect(Object.isFrozen(inputs)).toBe(false); expect(Object.isFrozen(union.inputs)).toBe(true);
  expect(Object.isFrozen(union)).toBe(true);
});
it('retains ordered numeric/prototype aliases and dotted path segments', () => {
  const entries = [['42', col.String.type], ['0', col.UInt64.type], ['__proto__', col.String.type], ['a.b', col.String.type]] as const;
  const flat = flatOutput(entries);
  expect(flat.order).toEqual(['42', '0', '__proto__', 'a.b']);
  expect(Object.hasOwn(flat.columns, '__proto__')).toBe(true);
  const a = scan(); const inputs = [['42', a], ['0', a], ['__proto__', a]] as const;
  const join = relNode({ kind: 'Join', joinKind: 'left', inputs, on: [], output: { shape: 'nested', inputs: inputs.map(([name, input]) => [name, input.output]) } });
  expect(join.inputs.map(([name]) => name)).toEqual(['42', '0', '__proto__']);
  expect(join.inputs[0]![1]).toBe(a); expect(join.output.shape).toBe('nested');
  const path = ['__proto__', 'a.b'];
  const ref = exprNode({ kind: 'ColumnRef', rel: join.id, path, type: col.String.type });
  path.push('oops'); expect(ref.path).toEqual(['__proto__', 'a.b']); expect(ref.rel).toBe(join.id);
  expect(() => flatOutput([['x', col.String.type], ['x', col.String.type]])).toThrow('duplicate_column');
});
it('retains opaque provenance and explicitly deferred raw types', () => {
  const param = exprNode({ kind: 'Param', type: null, value: 'tenant' });
  const args = [param]; const parts = ['SELECT ', ''];
  const raw = relNode({ kind: 'RawRel', opaque: true, provenance: { origin: 'sql.relation', label: 'caller' }, parts, args, output: { shape: 'deferred', reason: 'raw', declaredNames: [] } });
  parts[0] = 'mutated'; args.pop();
  expect(raw.parts).toEqual(['SELECT ', '']); expect(raw.args[0]).toBe(param);
  expect(raw.opaque).toBe(true); expect(raw.output.shape).toBe('deferred');
  const expr = exprNode({ kind: 'Raw', opaque: true, provenance: { origin: 'sql' }, parts: ['raw'], args: [], resolution: 'deferred', type: null });
  expect(expr.type).toBeNull(); expect(expr.resolution).toBe('deferred');
});
it('copies nested parameter values, including mutable Date internals', () => {
  const date = new Date('2026-01-01Z'); const value = { dates: [date], ['__proto__']: 'safe' };
  const p = exprNode({ kind: 'Param', value, type: null });
  date.setUTCFullYear(2000); value.dates.push(date);
  const frozen = p.value as typeof value;
  expect(frozen.dates).toHaveLength(1); expect(frozen.dates[0]!.getUTCFullYear()).toBe(2026);
  frozen.dates[0]!.setUTCFullYear(1999);
  expect(frozen.dates[0]!.getUTCFullYear()).toBe(2026);
  expect(frozen.__proto__).toBe('safe'); expect(Object.isFrozen(value)).toBe(false);
});
it.each(['Param', 'Literal'] as const)('%s snapshots hidden nested data, dates and genuine edges', kind => {
  const date = new Date(0);
  const edge = exprNode({ kind: 'Param', value: 1n, type: null });
  const nested = { date, edge };
  const value = Object.defineProperty({}, '__proto__', { value: nested });
  const node = exprNode({ kind, value, type: col.Map(col.String, col.DateTime64(3)).type });
  const owned = node.value as { __proto__: typeof nested };
  expect(Object.hasOwn(owned, '__proto__')).toBe(true);
  expect(Object.getOwnPropertyDescriptor(owned, '__proto__')?.enumerable).toBe(false);
  expect(owned.__proto__).not.toBe(nested);
  expect(owned.__proto__.edge).toBe(edge);
  expect(Object.isFrozen(owned)).toBe(true);
  expect(Object.isFrozen(owned.__proto__)).toBe(true);
  expect(Object.isFrozen(nested)).toBe(false);
  date.setTime(10);
  owned.__proto__.date.setTime(20);
  expect(owned.__proto__.date.getTime()).toBe(0);
});
it('rejects cyclic and exotic owned objects rather than silently dropping values', () => {
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const value of [cycle, new Map([['x', 1]]), new Set([1])]) {
    expect(() => exprNode({ kind: 'Param', value, type: null })).toThrow(/IR:/);
  }
});
it('only preserves finalized node identities, including inside owned containers', () => {
  const genuine = exprNode({ kind: 'Param', value: 1n, type: null });
  const values = { nested: [genuine] };
  const holder = exprNode({ kind: 'Param', value: values, type: null });
  expect((holder.value as typeof values).nested[0]).toBe(genuine);
  expect(holder.value).not.toBe(values);
  const copied = Object.defineProperties({}, Object.getOwnPropertyDescriptors(genuine));
  for (const impostor of [copied, new Proxy(genuine, {})]) {
    expect(() => exprNode({ kind: 'Param', value: { nested: [impostor] }, type: null })).toThrow(/IR:/);
  }
});
it('snapshots function metadata, with no v1 JS evaluator', () => {
  const fn = { name: 'rand', origin: 'typed' as const, deterministic: false };
  const call = exprNode({ kind: 'Call', type: col.UInt32.type, fn, args: [] });
  fn.deterministic = true;
  expect(call.fn.deterministic).toBe(false); expect(Object.hasOwn(call.fn, 'js')).toBe(false);
});
it('builds each remaining operator and expression without cloning graph edges', () => {
  const a = scan();
  const ref = exprNode({ kind: 'ColumnRef', type: col.String.type, rel: a.id, path: ['x'] });
  const literal = exprNode({ kind: 'Literal', type: col.Bool.type, value: true });
  const agg = exprNode({ kind: 'Agg', type: col.String.type, fn: { name: 'any', deterministic: true, origin: 'typed', linear: false }, args: [ref], params: [], combinators: ['If'] });
  const cast = exprNode({ kind: 'Cast', type: col.String.type, expr: ref, to: col.String.type });
  const branch = exprNode({ kind: 'Case', type: col.String.type, branches: [{ when: literal, then: cast }], otherwise: ref });
  expect(branch.branches[0]!.then).toBe(cast); expect(agg.args[0]).toBe(ref);
  const subquery = exprNode({ kind: 'Subquery', type: col.String.type, rel: a, usage: 'scalar' });
  expect(subquery.rel).toBe(a);
  const fields = { input: a, output, columns: output.columns };
  const nodes = [
    relNode({ kind: 'Filter', ...fields, pred: literal }),
    relNode({ kind: 'Project', ...fields, exprs: { x: branch } }),
    relNode({ kind: 'Aggregate', ...fields, keys: {}, aggs: { x: agg } }),
    relNode({ kind: 'ArrayJoin', ...fields, expr: ref, alias: 'x', left: true }),
    relNode({ kind: 'Sort', ...fields, keys: [{ expr: ref, dir: 'asc', nulls: 'last' }] }),
    relNode({ kind: 'Limit', ...fields, n: 5, offset: 2 }),
    relNode({ kind: 'Distinct', ...fields }),
    relNode({ kind: 'Materialize', ...fields }),
  ];
  for (const node of nodes) { expect(node.input).toBe(a); expect(Object.isFrozen(node)).toBe(true); }
  // Semantic validity (e.g. ArrayJoin's array type) belongs to later validation.
});
