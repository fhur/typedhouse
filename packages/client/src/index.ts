import { createClient as createDriver, type ClickHouseClientConfigOptions } from '@clickhouse/client';
import { compile } from '@chql/compiler';
import { unwrap, type Caps, type CompiledQuery, type Query, type Rel } from '@chql/core';
import { rowDecoder } from './decode.js';
import { QueryError } from './errors.js';
export { decoder, rowDecoder } from './decode.js';
export { QueryError } from './errors.js';
export function createClient(options: ClickHouseClientConfigOptions = {}) {
  const driver = createDriver(options);
  const plans = new WeakMap<Rel, { compiled: CompiledQuery; decode: ReturnType<typeof rowDecoder> }>();
  function prepare(ir: Rel) {
    let plan = plans.get(ir);
    if (!plan) {
      const compiled = compile(ir);
      plan = { compiled, decode: rowDecoder(compiled.columns, compiled.columnPaths) };
      plans.set(ir, plan);
    }
    return plan;
  }
  function execute(compiled: CompiledQuery) {
    // Already serialized Arrays must bypass the driver's string escaping.
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
    async run<R, C extends Caps>(query: Pick<Query<R, C>, 'ir' | '_rowType' | 'caps'>): Promise<R[]> {
      const { compiled, decode } = prepare(query.ir);
      try {
        const result = await execute(compiled);
        try { return (await result.json<unknown>()).map(decode) as R[]; }
        finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    async *stream<R, C extends Caps>(query: Pick<Query<R, C>, 'ir' | '_rowType' | 'caps'>): AsyncGenerator<R, void> {
      // Generator bodies are lazy, including compilation and decoder construction.
      const { compiled, decode } = prepare(query.ir);
      try {
        const result = await execute(compiled);
        try {
          const stream = result.stream<unknown>();
          try {
            for await (const rows of stream) {
              for (const row of rows) yield decode(row.json()) as R;
            }
          } finally { stream.destroy(); }
        } finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    close: () => driver.close(),
  };
}
