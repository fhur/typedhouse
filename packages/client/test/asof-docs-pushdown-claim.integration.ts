import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, startServer, type Connection } from './asof-support.js';

/** DEFECT in D11 wording. select-blocks.md and the plan-selects.ts comment say the server pushes
 * NEITHER input's conjunct below ASOF. EXPLAIN on all three versions shows a left conjunct as a
 * PREWHERE on the left read, below the join. Right-side conjuncts stay above, which is the claim that
 * carries the fold; the left one commutes, so no row changes, but the sentence is false as written.
 * Stays failing until the wording says "the right input's". */
const root = new URL('../../../', import.meta.url);

const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe.each(['24.3', '24.8', '26.10'] as const)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    c = connect(server.url);

    for (const query of [
      `CREATE OR REPLACE TABLE asof_c_l (id UInt32, k String, ts UInt32) ENGINE = MergeTree ORDER BY id`,
      `CREATE OR REPLACE TABLE asof_c_r (k String, ts UInt32, v UInt32) ENGINE = MergeTree ORDER BY (k, ts)`,
      `INSERT INTO asof_c_l VALUES (1, 'a', 10), (2, 'b', 10)`,
      `INSERT INTO asof_c_r VALUES ('a', 5, 1)`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  it('the left conjunct is below the join step, so "neither" is not a claim to keep', async () => {
    const result = await c.admin.query({
      query: `EXPLAIN actions = 1 SELECT t.id FROM asof_c_l AS t ASOF INNER JOIN asof_c_r AS q
              ON t.k = q.k AND t.ts >= q.ts WHERE t.k = 'a' AND q.v > 0`,
      format: 'TabSeparatedRaw',
    });

    const plan = await result.text();
    const below = plan.slice(plan.search(/\bJoin \(/));
    expect(below).toMatch(/Prewhere filter column.*k/);

    expect(read('apps/docs/src/content/docs/docs/compiler/select-blocks.md')).not.toMatch(
      /push neither input's conjunct/,
    );

    expect(read('packages/compiler/src/plan-selects.ts')).not.toMatch(
      /push neither input's WHERE conjunct/,
    );
  });
});
