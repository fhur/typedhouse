import type { ClickHouseClientConfigOptions } from '@clickhouse/client';
import {
  getInsertCommandData,
  type InsertCommand,
  type Caps,
  type Query,
  type Rel,
} from '@typedhouse/core';
import { encodeInsert } from './encode-insert.js';
import { InsertError, UnsupportedOperationError } from './errors.js';
export { type EncodedInsert, InsertValidationError } from './encode-insert.js';
import { createClickHouseBackend, type Backend, type Plan } from './backend.js';
export { createClickHouseBackend, type Backend, type Plan } from './backend.js';
export { decoder, rowDecoder } from './decode.js';
export { QueryError, InsertError, UnsupportedOperationError } from './errors.js';

type Executable<R, C extends Caps> = Pick<Query<R, C>, 'ir' | '_rowType' | 'caps'>;

function facade(backend: Backend, buffered?: (plan: Plan) => Promise<unknown[]>) {
  const plans = new WeakMap<Rel, Plan>();

  function prepare(ir: Rel): Plan {
    let plan = plans.get(ir);

    if (!plan) {
      plan = backend.compile(ir);
      plans.set(ir, plan);
    }

    return plan;
  }

  async function* stream<R, C extends Caps>(query: Executable<R, C>): AsyncGenerator<R, void> {
    // Everything, including preparation, is lazy. The only row assertion is at
    // the plugin boundary: Backend promises the decoded schema of this Rel.
    const plan = prepare(query.ir);
    for await (const batch of backend.run(plan)) for (const row of batch) yield row as R;
  }

  return {
    async run<R, C extends Caps>(query: Executable<R, C>): Promise<R[]> {
      if (buffered) return (await buffered(prepare(query.ir))) as R[];
      const rows: R[] = [];
      for await (const row of stream(query)) rows.push(row);
      return rows;
    },
    stream,
    async execute(command: InsertCommand): Promise<void> {
      const batch = encodeInsert(getInsertCommandData(command));
      if (batch.rows.length === 0) return;
      if (!backend.insert) throw new UnsupportedOperationError('insert', backend.name);

      try {
        await backend.insert(batch);
      } catch (cause) {
        throw new InsertError(batch.table, cause);
      }
    },
  };
}

/** A non-owning facade: no close method, no ClickHouse-specific dispatch.
 * Plans are cached by Rel identity only within this facade. Read errors pass
 * through unchanged; write failures carry target and unknown-outcome context.
 * The caller must keep its backend alive for all executions.
 */
export function createClientFromBackend(backend: Backend) {
  return facade(backend);
}

/** Owns the default planned backend and retains buffered run() compatibility.
 * Finish/return active iterators before close(); close releases its driver.
 */
export function createClient(options: ClickHouseClientConfigOptions = {}) {
  const backend = createClickHouseBackend(options, 'clickhouse');
  return { ...facade(backend, backend.runBuffered), close: backend.close };
}
