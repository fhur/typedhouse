import { expect, it } from 'vitest';
import { buildTree, type Recipe, type Tree } from './fixture-differential-arbitrary.js';
import { coverage } from './fixture-differential-support.js';
import { decodeCell, decodeNative, independentKeys, native } from './fixture-differential-native.js';
import { multiplicityDiff } from './backend-harness.js';

const scope = { tenant: 'acme', start: 0, week: 0 };
const leaf: Tree = { op: 'metric', metric: 'availability', latest: false, attached: false, cross: false };
const row = { tenant: 'acme', id: 'cmp_0', at: new Date('2026-04-27T00:00:00Z'), version: 1, value: 1674.29 };

it('oracle comparison detects equal-count value corruption, duplicate loss and reordered limits', () => {
  const keys = (rows: readonly unknown[], ordered = false) => independentKeys(rows, 'bag', ordered);
  expect(multiplicityDiff(keys([row, row]), keys([row]))).toHaveLength(1);
  expect(multiplicityDiff(keys([row]), keys([{ ...row, value: 674.29 }]))).toHaveLength(2);
  const next = { ...row, id: 'cmp_1' };
  expect(keys([row, next])).toEqual(keys([next, row]));
  expect(keys([row, next], true)).not.toEqual(keys([next, row], true));
  expect(() => keys([{ ...row, extra: 1 }])).toThrow('paths/order');
  expect(() => keys([{ id: row.id, tenant: row.tenant, at: row.at, version: row.version, value: row.value }])).toThrow('paths/order');
});

it('independent decoding distinguishes null, non-finites, dates and bigint without numeric coercion', () => {
  const wire = { ...row, at: row.at.toISOString(), value: 'nan' };
  expect(decodeNative(wire, 'bag')).toEqual({ ...row, value: NaN });
  expect(decodeNative({ ...wire, value: '-inf', share: null }, 'share')).toEqual({ ...row, value: -Infinity, share: null });
  expect(() => decodeNative({ ...wire, value: null }, 'bag')).toThrow('expected float');
  expect(() => decodeNative({ ...wire, version: '1' }, 'bag')).toThrow('expected float');
  expect(decodeCell('9007199254740993', { kind: 'scalar', name: 'UInt64' })).toBe(9007199254740993n);
  expect(() => decodeCell(9007199254740992, { kind: 'scalar', name: 'UInt64' })).toThrow('expected string');
  expect(() => decodeCell('invalid', { kind: 'DateTime64', precision: 3 })).toThrow('invalid date');
});

it('native oracle keeps hostile tenant text out of SQL and uses distinct nested CTE names', () => {
  const recipe: Recipe = { scope: { ...scope, tenant: "x' OR 1=1 --" }, tree: { op: 'cte', input: { op: 'cte', input: leaf } }, end: 'share' };
  const result = native(recipe);
  expect(result.sql).not.toContain(recipe.scope.tenant);
  expect(result.params).toEqual({ tenant: recipe.scope.tenant, since: '2026-04-27 00:00:00.000', until: '2026-05-04 00:00:00.000' });
  expect(result.sql).toContain('explicit_0');
  expect(result.sql).toContain('explicit_1');
  expect(result.sql).toContain('sum(value)');
});

it('rebuilding repeated unions retains internal identity but never shares across builds', () => {
  const ignored: Tree = { ...leaf, metric: 'price', cross: true };
  const tree: Tree = { op: 'union', left: leaf, right: ignored, repeat: true };
  const a = buildTree(tree, scope).ir, b = buildTree(tree, scope).ir;
  if (a.kind !== 'Project' || b.kind !== 'Project' || a.input.kind !== 'Union' || b.input.kind !== 'Union') throw new Error('expected projected unions');
  expect(a.input.inputs[0]).toBe(a.input.inputs[1]);
  expect(b.input.inputs[0]).toBe(b.input.inputs[1]);
  expect(a.input.inputs[0]).not.toBe(b.input.inputs[0]);
  const tags = coverage({ scope, tree, end: 'bag' });
  expect(tags).not.toContain('metric:price');
  expect(tags).not.toContain('source:part');
  const independent = buildTree({ ...tree, repeat: false }, scope).ir;
  if (independent.kind !== 'Project' || independent.input.kind !== 'Union') throw new Error('expected projected union');
  expect(independent.input.inputs[0]).not.toBe(independent.input.inputs[1]);
});
