import { expect, it } from 'vitest';
import { col, count, from, max, table } from '@typedhouse/core';
import { compile } from '../src/index.js';

// Slice 4f Tester probes (native evidence: packages/client/test/slice4f-adversarial.integration.ts).
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const XM = from(
  table(
    'xm',
    { id: col.UInt32, v: col.String, arr: col.Array(col.UInt32) },
    { ...meta, hiddenColumns: ['hidden', 'mat'] },
  ),
);

const selects = (sql: string) => sql.match(/SELECT /g)!.length;

it('D1, flipped in 4f fix round 1: an identity selection under the Aggregate no longer hides hiddenColumns', () => {
  // 4f fix round 1: sourceNames come from the folded block's scan (full output + hiddenColumns), so the guard fires.
  const q = XM.map(r => ({ id: r.id, v: r.v }))
    .groupBy(r => ({ id: r.id }))
    .aggregate(g => ({ hidden: count(), top: max(g.v) }))
    .where(r => r.hidden.gt(1n));

  const direct = XM.groupBy(r => ({ id: r.id }))
    .aggregate(g => ({ hidden: count(), top: max(g.v) }))
    .where(r => r.hidden.gt(1n));

  expect(compile(q.ir).sql).not.toContain('HAVING `hidden`'); // was: folded onto `xm` with HAVING `hidden` (E215 natively)
  expect(selects(compile(q.ir).sql)).toBe(selects(compile(direct.ir).sql));

  const expanded = XM.map(r => ({ id: r.id, arr: r.arr }))
    .arrayJoin(r => r.arr, 'e')
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ hidden: count() }))
    .where(r => r.hidden.gt(1n));

  expect(compile(expanded.ir).sql).not.toContain('HAVING `hidden`'); // was: one SELECT `FROM xm ARRAY JOIN … HAVING hidden`

  const filteredAbove = XM.map(r => ({ id: r.id, v: r.v }))
    .where(r => r.v.ne('z'))
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ mat: count() }))
    .orderBy(r => r.mat);

  expect(selects(compile(filteredAbove.ir).sql)).toBeGreaterThan(1); // was: 1
});

it('D2 (pre-4f twin, declared column), flipped in 4f fix round 1: the narrowed identity selection keeps `arr` in sourceNames', () => {
  const q = XM.map(r => ({ id: r.id, v: r.v }))
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ arr: count() }))
    .where(r => r.arr.gt(1n));

  expect(compile(q.ir).sql).not.toContain('HAVING `arr`'); // was: folded with HAVING `arr` (E43 natively)
});

it('no finding: the guards see hidden names through a transparent selection on the selection and join paths', () => {
  // Slice 1/3 selection guard over an identity selection: the child block is the scan block, hidden names included.
  const sel = XM.where(r => r.v.ne('z'))
    .map(r => ({ id: r.id, v: r.v }))
    .map(r => ({ hidden: r.id.plus(1), x: r.v }));

  expect(compile(sel.ir).sql).toContain('FROM `xm`');

  // Case-only difference is a different identifier in ClickHouse: no fence needed, and none taken.
  const caseOnly = XM.groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ Hidden: count() }))
    .where(r => r.Hidden.gt(1n));

  expect(selects(compile(caseOnly.ir).sql)).toBe(1);
});
