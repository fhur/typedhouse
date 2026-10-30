import type { Rel } from '@typedhouse/core';
import type { Tree, Recipe } from './fixture-differential-arbitrary.js';
export function size(t: Tree): number { return t.op === 'metric' ? 1 : t.op === 'union' ? 1 + size(t.left) + size(t.repeat ? t.left : t.right) : 1 + size(t.input); }
export function coverage(r: Recipe): string[] {
  const result = [`end:${r.end}`, `tenant:${r.scope.tenant}`];
  function walk(t: Tree) {
    result.push(`op:${t.op}`);
    if (t.op === 'union') { result.push(t.repeat ? 'identity:union' : 'union:independent'); walk(t.left); if (!t.repeat) walk(t.right); }
    else if (t.op !== 'metric') { if (t.op === 'in') result.push('identity:in'); walk(t.input); }
    else {
      result.push(`metric:${t.metric}`, t.latest ? 'identity:latest' : 'history:between', 'final');
      if (t.cross) result.push('source:component', 'source:part', 'join:cross-family', `cross:${t.metric}`, 'arrayJoin');
      else if (t.attached) result.push('join:entity', t.metric === 'availability' || t.metric === 'componentIndices' ? 'source:component' : 'source:part');
    }
  }
  walk(r.tree);
  if (size(r.tree) >= 4) result.push('composition:depth');
  return result;
}
// Independent evidence from the built graph and executed SQL, not recipe tags.
export function observedOperators(rel: Rel, seen = new Set<Rel>()): Set<string> {
  if (seen.has(rel)) return new Set();
  seen.add(rel);
  const kinds = new Set<string>([rel.kind]);
  const children = 'input' in rel ? [rel.input] : rel.kind === 'Join' ? rel.inputs.map(([, input]) => input) : rel.kind === 'Union' ? rel.inputs : [];
  for (const child of children) for (const kind of observedOperators(child, seen)) kinds.add(kind);
  return kinds;
}
export const actualTables = [
  'entity_ots_component', 'entity_off_the_shelf_part',
  'metric_group_ots_component_market_availability', 'metric_group_ots_component_indices',
  'metric_group_off_the_shelf_part_indices', 'metric_group_off_the_shelf_part_market_price',
];
export const requiredOperators = ['Scan', 'Filter', 'Project', 'Aggregate', 'Join', 'ArrayJoin', 'Sort', 'Limit', 'Distinct', 'Union', 'Materialize'];
export const requiredCoverage = [
  'end:bag', 'end:limit', 'end:rollup', 'end:share', 'tenant:acme', 'tenant:other',
  'op:filter', 'op:project', 'op:distinct', 'op:in', 'op:cte', 'op:union',
  'metric:availability', 'metric:componentIndices', 'metric:partIndices', 'metric:price',
  'identity:latest', 'history:between', 'identity:union', 'identity:in', 'union:independent',
  'source:component', 'source:part', 'join:entity', 'join:cross-family', 'arrayJoin', 'final',
  'cross:availability', 'cross:componentIndices', 'cross:partIndices', 'cross:price', 'composition:depth',
];
