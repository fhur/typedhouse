import { createClient as createDriver, type ClickHouseClientConfigOptions } from '@clickhouse/client';
import { compile, emitNaive, quoteIdentifier } from '@typedhouse/compiler';
import { unwrap, type CompiledQuery, type Rel } from '@typedhouse/core';
import { rowDecoder } from './decode.js';
import { QueryError } from './errors.js';
import type { EncodedInsert } from './encode-insert.js';

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
  /** Optional bulk write capability. The facade validates the complete batch first. */
  insert?(batch: EncodedInsert): Promise<void>;
}

/**
 * JSON output settings sent with every query so values arrive exactly. Without
 * them a DateTime is wall-clock time with no offset, NaN/Inf become null, and a
 * Decimal is an unquoted number that JSON.parse rounds past ~17 digits.
 */
export const outputSettings = {
  date_time_output_format: 'iso',
  output_format_json_quote_64bit_integers: 1,
  output_format_json_quote_denormals: 1,
  output_format_json_quote_decimals: 1,
} as const;

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
    return driver.query({ query: compiled.sql, query_params: params, format: 'JSONEachRow', clickhouse_settings: { ...containers, ...outputSettings } });
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
    async insert(batch: EncodedInsert): Promise<void> {
      if (batch.rows.length === 0) return;
      const [first, ...rest] = batch.columns;
      if (first === undefined) throw new Error('insert_requires_columns');
      const firstKeys = Object.keys(batch.rows[0]!);
      const mixedPresence = batch.rows.some(row => Object.keys(row).length !== firstKeys.length || firstKeys.some(key => !Object.hasOwn(row, key)));
      await driver.insert({
        table: quoteIdentifier(batch.table),
        columns: [quoteIdentifier(first), ...rest.map(quoteIdentifier)],
        values: [...batch.rows],
        format: 'JSONEachRow',
        clickhouse_settings: {
          // ClickHouse 24.8 evaluates dependent DEFAULTs against other columns'
          // defaults across a mixed-presence block, ignoring supplied values.
          // Homogeneous key sets (including columns omitted by every row) are
          // safe at normal block sizes. Only mixed presence needs one-row parser
          // blocks to preserve per-row dependencies, still in one request.
          ...(mixedPresence ? { max_insert_block_size: '1' } : {}),
          input_format_defaults_for_omitted_fields: 1,
          input_format_null_as_default: 0,
          input_format_skip_unknown_fields: 0,
          input_format_allow_errors_num: '0',
          input_format_allow_errors_ratio: 0,
          input_format_import_nested_json: 0,
          input_format_json_named_tuples_as_objects: 1,
          input_format_json_defaults_for_missing_elements_in_named_tuple: 0,
          input_format_json_ignore_unknown_keys_in_named_tuple: 0,
          date_time_input_format: 'best_effort',
          async_insert: 0,
        },
      });
    },
    close: () => driver.close(),
  } satisfies Backend & { runBuffered(plan: Plan): Promise<unknown[]>; close(): Promise<void> };
}
