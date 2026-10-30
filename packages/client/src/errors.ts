import type { CompiledQuery, Rel } from '@typedhouse/core';
export class QueryError extends Error {
  readonly sql: string;
  readonly params: CompiledQuery['params'];
  readonly node: Rel | undefined;
  constructor(query: CompiledQuery, cause: unknown) {
    super('ClickHouse query failed', { cause }); this.name = 'QueryError';
    this.sql = query.sql; this.params = query.params; this.node = query.nodes['root'];
  }
}
