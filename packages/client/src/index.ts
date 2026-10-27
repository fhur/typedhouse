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
  return {
    async run<R, C extends Caps>(query: Pick<Query<R, C>, 'ir' | '_rowType' | 'caps'>): Promise<R[]> {
      let plan = plans.get(query.ir);
      if (!plan) { const compiled = compile(query.ir); plan = { compiled, decode: rowDecoder(compiled.columns, compiled.columnPaths) }; plans.set(query.ir, plan); }
      const { compiled, decode } = plan;
      try {
        // Driver string formatting would escape the quotes in an already serialized Array.
        // param_* HTTP fields use the same server-side bindings, but the settings transport
        // forwards their library-owned text verbatim rather than formatting it twice.
        const params: Record<string, string> = {};
        const containers: Record<string, string> = {};
        for (const [name, value] of Object.entries(compiled.params)) {
          const type = compiled.parameterTypes?.[name];
          if (type && unwrap(type).kind === 'Array') containers[`param_${name}`] = value;
          else params[name] = value;
        }
        const result = await driver.query({ query: compiled.sql, query_params: params, format: 'JSONEachRow', clickhouse_settings: {
          ...containers,
          date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1,
        } });
        try { return (await result.json<unknown>()).map(decode) as R[]; }
        finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    close: () => driver.close(),
  };
}
