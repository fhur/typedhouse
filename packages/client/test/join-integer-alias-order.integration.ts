import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { col, from, fullJoin, leftJoin, rightJoin, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { connect, startServer, type Connection } from './asof-support.js';

/** `leftJoin`, `rightJoin` and `fullJoin` build their inputs by merging two records, `{...left, ...right}`.
 * An integer-like alias reorders keys in JavaScript, so `leftJoin({ 2: a }, { 1: b })` may swap the sides.
 * Separate from ASOF, whose builder keeps argument order (asof-adversarial.test.ts). */
const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const a = table('alias_a', { id: col.UInt32, k: col.UInt8 }, opts);

const b = table('alias_b', { id: col.UInt32, k: col.UInt8 }, opts);

let stop: () => Promise<void>;

let c: Connection;

beforeAll(async () => {
  const server = await startServer('24.8');
  stop = server.stop;
  c = connect(server.url);

  for (const query of [
    'CREATE OR REPLACE TABLE alias_a (id UInt32, k UInt8) ENGINE = MergeTree ORDER BY id',
    'CREATE OR REPLACE TABLE alias_b (id UInt32, k UInt8) ENGINE = MergeTree ORDER BY id',
    'INSERT INTO alias_a VALUES (1, 1), (2, 2)',
    'INSERT INTO alias_b VALUES (10, 1), (30, 3)',
  ])
    await c.admin.command({ query });
});

afterAll(async () => {
  await c?.close();
  await stop();
});

const sorted = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).sort();

describe('integer-like aliases keep the sides the caller wrote', () => {
  it('leftJoin({ 2: a }, { 1: b }) keeps every row of a', async () => {
    const q = (leftJoin as any)({ 2: from(a) }, { 1: from(b) })
      .on((r: any) => r[2].k.eq(r[1].k))
      .map((r: any) => ({ left: r[2].id, right: r[1].id }));

    expect(compile(q.ir).sql).toMatch(/FROM `alias_a` AS `2`\s+LEFT ALL JOIN/);

    expect(sorted(await c.optimized.run(q as never))).toEqual(
      sorted([
        { left: 1, right: 10 },
        { left: 2, right: null },
      ]),
    );
  });

  it('rightJoin({ 2: a }, { 1: b }) keeps every row of b', async () => {
    const q = (rightJoin as any)({ 2: from(a) }, { 1: from(b) })
      .on((r: any) => r[2].k.eq(r[1].k))
      .map((r: any) => ({ left: r[2].id, right: r[1].id }));

    expect(compile(q.ir).sql).toMatch(/FROM `alias_a` AS `2`\s+RIGHT ALL JOIN/);

    expect(sorted(await c.optimized.run(q as never))).toEqual(
      sorted([
        { left: 1, right: 10 },
        { left: null, right: 30 },
      ]),
    );
  });

  it('fullJoin({ 2: a }, { 1: b }) keeps its text order, with the same rows', async () => {
    const q = (fullJoin as any)({ 2: from(a) }, { 1: from(b) })
      .on((r: any) => r[2].k.eq(r[1].k))
      .map((r: any) => ({ left: r[2].id, right: r[1].id }));

    expect(compile(q.ir).sql).toMatch(/FROM `alias_a` AS `2`\s+FULL ALL JOIN/);

    expect(sorted(await c.optimized.run(q as never))).toEqual(
      sorted([
        { left: 1, right: 10 },
        { left: 2, right: null },
        { left: null, right: 30 },
      ]),
    );
  });
});
