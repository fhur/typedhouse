import { createClient as createDriver, type ClickHouseClientConfigOptions } from '@clickhouse/client';
import { compile } from '@chql/compiler';
import type { Caps, CompiledQuery, Query, Rel } from '@chql/core';
import { rowDecoder } from './decode.js';
import { QueryError } from './errors.js';
export { decoder, rowDecoder } from './decode.js';
export { QueryError } from './errors.js';
export function createClient(options: ClickHouseClientConfigOptions = {}) {
  const driver = createDriver(options);
  const plans = new WeakMap<Rel, { compiled: CompiledQuery; decode: ReturnType<typeof rowDecoder> }>();
  return {
    async run<R, C extends Caps>(query: Query<R, C>): Promise<R[]> {
      let plan = plans.get(query.ir);
      if (!plan) { const compiled = compile(query.ir); plan = { compiled, decode: rowDecoder(compiled.columns) }; plans.set(query.ir, plan); }
      const { compiled, decode } = plan;
      try {
        const result = await driver.query({ query: compiled.sql, query_params: compiled.params, format: 'JSONEachRow', clickhouse_settings: {
          date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1,
        } });
        try { return (await result.json<unknown>()).map(decode) as R[]; }
        finally { result.close(); }
      } catch (cause) { throw new QueryError(compiled, cause); }
    },
    close: () => driver.close(),
  };
}
