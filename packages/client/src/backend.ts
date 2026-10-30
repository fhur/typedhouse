import { createClient as createDriver, type ClickHouseClientConfigOptions } from '@clickhouse/client';
import { compile, emitNaive } from '@typedhouse/compiler';
import { unwrap, type CompiledQuery, type Rel } from '@typedhouse/core';
import { rowDecoder } from './decode.js';
import { QueryError } from './errors.js';

/** A reusable execution recipe, not a cursor. Treat compiled metadata as read-only.
 * Plans belong to the exact backend instance that compiled them; do not copy them
 * or pass them to another backend, even one with the same name/mode.
 */
export interface Plan { readonly compiled: CompiledQuery }
/** Each yielded array is a batch of decoded row objects (not positional cells).
 * Implementations must honor the Rel's output schema and close each execution's
 * cursor on exhaustion, failure or iterator return. Compilation is synchronous;
 * run is lazy and repeatable, with independent concurrent cursors. The caller
 * owns the backend lifetime; finish/return cursors before closing its resources.
 */
export interface Backend {
  readonly name: string;
  compile(rel: Rel): Plan;
  run(plan: Plan): AsyncIterable<unknown[]>;
}

/** Thin adapter over @clickhouse/client: options are passed through unchanged.
 * The driver owns HTTP, auth/TLS/compression, pooling, parsing, backpressure and
 * resource cancellation. This layer owns compilation, typed decoding and error
 * context only; parameter serialization is supplied by the compiler.
 * Owns one driver. close() closes that driver, not any other backend's driver.
 * Keep plans only for this instance's lifetime. Preparation/foreign-plan errors
 * are not QueryErrors; transport and decoding errors carry the compiled query.
 * runBuffered retains the legacy client's JSON buffering path; plugin consumers
 * need only the three Backend methods. run yields singleton batches so unread
 * driver rows are never eagerly decoded.
 */
export function createClickHouseBackend(options: ClickHouseClientConfigOptions = {}, mode: 'clickhouse' | 'clickhouse-naive' = 'clickhouse') {
  const driver = createDriver(options);
  const decoders = new WeakMap<Plan, ReturnType<typeof rowDecoder>>();
  function prepare(plan: Plan) {
    const decode = decoders.get(plan);
    if (!decode) throw new Error('backend_plan_owner: plan belongs to another backend');
    return decode;
  }
  function execute(compiled: CompiledQuery) {
    // The compiler has already serialized typed Arrays per the spec. Passing
    // that literal as a query_params string makes the driver escape its quotes
    // and backslashes again. Use the driver's settings API only for these Array
    // literals (covered by native-server regression), not a new transport path.
    const params: Record<string, string> = {};
    const containers: Record<string, string> = {};
    for (const [name, value] of Object.entries(compiled.params)) {
      const type = compiled.parameterTypes?.[name];
      if (type && unwrap(type).kind === 'Array') containers[`param_${name}`] = value;
      else params[name] = value;
    }
    return driver.query({ query: compiled.sql, query_params: params, format: 'JSONEachRow', clickhouse_settings: {
      ...containers,
      date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1,
    } });
  }
  return {
    name: mode,
    compile(rel: Rel): Plan {
      const compiled = mode === 'clickhouse' ? compile(rel) : emitNaive(rel);
      const decode = rowDecoder(compiled.columns, compiled.columnPaths);
      const plan: Plan = Object.freeze({ compiled });
      decoders.set(plan, decode);
      return plan;
    },
    async runBuffered(plan: Plan): Promise<unknown[]> {
      const decode = prepare(plan);
      const { compiled } = plan;
      try {
        const result = await execute(compiled);
        try { return (await result.json<unknown>()).map(decode); }
        finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    async *run(plan: Plan): AsyncGenerator<unknown[], void> {
      const decode = prepare(plan);
      const { compiled } = plan;
      try {
        const result = await execute(compiled);
        try {
          const stream = result.stream<unknown>();
          try {
            for await (const rows of stream) {
              for (const row of rows) yield [decode(row.json())];
            }
          } finally { stream.destroy(); }
        } finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    close: () => driver.close(),
  } satisfies Backend & { runBuffered(plan: Plan): Promise<unknown[]>; close(): Promise<void> };
}
