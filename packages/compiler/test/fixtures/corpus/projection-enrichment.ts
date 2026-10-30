import { dateDiff, multiIf, now, val } from '@chql/core';
import { components } from './low-stock.js';

export const projectionEnrichment = components.map(c => ({
  ...c,
  category: c.category.ifNull('uncategorised'),
  matched: c.matched_part_ids.length(),
  mpns: c.part_specifications.element('mpn'),
  firstDesc: c.part_specifications.arrayElement(1).element('description'),
  age: dateDiff('day', c.updatedAt, now()),
  tier: multiIf([c.countOfParts.eq(0n), 'none'], [c.countOfParts.lt(3n), 'few'], 'many'),
  source: val('clickhouse'),
}));
