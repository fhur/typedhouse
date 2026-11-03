import type { CompiledQuery, Rel } from '@typedhouse/core';
export class UnsupportedOperationError extends Error {
  constructor(readonly operation: string, readonly backend: string) {
    super(`Backend does not support ${operation}`);
    this.name = 'UnsupportedOperationError';
  }
}

export class InsertError extends Error {
  constructor(readonly table: string, cause: unknown) {
    super('ClickHouse insert failed; write outcome may be unknown. Retrying may duplicate rows.', { cause });
    this.name = 'InsertError';
  }
}

export class QueryError extends Error {
  readonly sql: string;
  readonly params: CompiledQuery['params'];
  readonly node: Rel | undefined;
  constructor(query: CompiledQuery, cause: unknown) {
    super('ClickHouse query failed', { cause }); this.name = 'QueryError';
    this.sql = query.sql; this.params = query.params; this.node = query.nodes['root'];
  }
}
