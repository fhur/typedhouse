import { randomUUID } from 'node:crypto';
import { quoteIdentifier } from '@typedhouse/compiler';
import { AGENT_SETTINGS, type Connection } from './clickhouse.js';
import { cut } from './text.js';

export const RESULT_LIMITS = Object.freeze({ ttlMs: 300_000, globalBytes: 8_000_000, snapshots: 64, snapshotBytes: 256_000, pageBytes: 16_000, pageRows: 20, cellChars: 512, columns: 32 });
/** Tool-facing JSON: bigint/date/non-finite values are strings. Complex cells are bounded too. */
export function boundedValue(value: unknown): { value: unknown; truncated: boolean } {
  let truncated = false, nodes = 0;
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 200 || depth > 5) { truncated = true; return '[truncated]'; }
    if (typeof v === 'bigint') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (typeof v === 'string') { if (v.length > 512) { truncated = true; return cut(v, 512) + '…'; } return v; }
    if (Array.isArray(v)) { if (v.length > 20) truncated = true; return v.slice(0, 20).map(x => visit(x, depth + 1)); }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      if (entries.length > RESULT_LIMITS.columns) truncated = true;
      return Object.fromEntries(entries.slice(0, RESULT_LIMITS.columns).filter(([k]) => {
        if (k.length > 128) { truncated = true; return false; }
        return true;
      }).map(([k, x]) => [k, visit(x, depth + 1)]));
    }
    return v ?? null;
  }
  return { value: visit(value, 0), truncated };
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
interface Snapshot { owner: string; scope: string; expires: number; bytes: number; pages: unknown[][]; cursors: string[]; truncated: boolean; }
// Process-wide quota, not one quota per conversation/connection.
const snapshots = new Map<string, Snapshot>();
function sweep(now: number) { for (const [id, s] of snapshots) if (s.expires <= now) snapshots.delete(id); }
function ownerCheck(owner: string) { if (!owner || owner.length > 256) throw new Error('Invalid conversation owner'); }

type AgentConnection = Pick<Connection, 'runAgentQuery' | 'tables' | 'driver' | 'database'> & Partial<Pick<Connection, 'schemaMetadata' | 'schemaError'>>;
export function createAgentCapabilities(connection: AgentConnection, now: () => number = Date.now) {
  const scope = randomUUID();
  const schemaCursors = new Map<string, { key: string; offset: number; expires: number }>();
  function schemaOffset(key: string, cursor?: string | null) {
    if (cursor == null) return 0;
    const value = schemaCursors.get(cursor);
    if (!value || value.key !== key || value.expires <= now()) throw new Error('Invalid or expired schema cursor');
    return value.offset;
  }
  function schemaNext(key: string, offset: number, total: number) {
    if (offset >= total) return null;
    while (schemaCursors.size >= 256) schemaCursors.delete(schemaCursors.keys().next().value!);
    const token = randomUUID(); schemaCursors.set(token, { key, offset, expires: now() + RESULT_LIMITS.ttlMs }); return token;
  }
  function queryResultsGet(resultId: string, cursor: string | undefined | null, owner: string) {
    ownerCheck(owner); sweep(now());
    const s = snapshots.get(resultId);
    if (!s || s.owner !== owner || s.scope !== scope) throw new Error('Result unavailable or expired');
    const index = cursor == null ? 0 : s.cursors.indexOf(cursor);
    if (index < 0) throw new Error('Invalid result cursor');
    return { resultId, rows: s.pages[index]!, nextCursor: s.cursors[index + 1] ?? null, truncated: s.truncated, expiresAt: s.expires };
  }
  function requireSchema() {
    const error = connection.schemaError?.();
    if (error) throw new Error(`Schema unavailable: ${cut(error, 2000)}`);
  }
  function tableNamed(table: string) {
    requireSchema();
    const found = connection.tables().find(t => t.name === table);
    if (!found) throw new Error('Unknown table');
    if (table.length > 256) throw new Error('Table identifier too long');
    return found;
  }
  return {
    async queryRun(source: string, owner: string, signal?: AbortSignal) {
      ownerCheck(owner);
      const result = await connection.runAgentQuery(source, signal);
      let truncated = result.truncated, size = 0;
      const pages: unknown[][] = [[]]; let pageSize = 2;
      for (const row of result.rows) {
        const bounded = boundedValue(row); truncated ||= bounded.truncated;
        let value = bounded.value;
        if (bytes(value) > 8_000) { value = { omitted: 'Row exceeds display byte budget' }; truncated = true; }
        const length = bytes(value) + 1;
        if (size + length > RESULT_LIMITS.snapshotBytes) { truncated = true; break; }
        if (pageSize + length > RESULT_LIMITS.pageBytes || pages.at(-1)!.length >= RESULT_LIMITS.pageRows) { pages.push([]); pageSize = 2; }
        pages.at(-1)!.push(value); pageSize += length; size += length;
      }
      sweep(now());
      let total = [...snapshots.values()].reduce((n, s) => n + s.bytes, 0);
      while (snapshots.size >= RESULT_LIMITS.snapshots || total + size > RESULT_LIMITS.globalBytes) {
        const first = snapshots.entries().next().value;
        if (!first) break;
        total -= first[1].bytes; snapshots.delete(first[0]);
      }
      const resultId = randomUUID();
      // The same keys a row keeps, and reported apart: a cut column list says nothing about the rows.
      const columns = result.columns.slice(0, RESULT_LIMITS.columns).filter(c => c.name.length <= 128).map(c => boundedValue(c));
      const columnsTruncated = columns.length < result.columns.length || columns.some(c => c.truncated);
      snapshots.set(resultId, { scope, owner, expires: now() + RESULT_LIMITS.ttlMs, bytes: size, pages, cursors: pages.map(() => randomUUID()), truncated });
      return { ...queryResultsGet(resultId, null, owner),
        sql: cut(result.sql, 8000), sqlTruncated: result.sql.length > 8000, elapsedMs: result.elapsedMs, columns: columns.map(c => c.value), columnsTruncated, retainedRows: pages.reduce((n, p) => n + p.length, 0) };
    },
    queryResultsGet,
    releaseOwner(owner: string) { for (const [id, s] of snapshots) if (s.scope === scope && s.owner === owner) snapshots.delete(id); },
    tablesList(search = '', cursor?: string | null) {
      requireSchema();
      if (search.length > 256) throw new Error('Search exceeds 256 characters');
      const key = JSON.stringify(['tables', search]);
      const offset = schemaOffset(key, cursor);
      const tables = connection.tables().filter(t => `${t.name}\n${t.binding}`.toLowerCase().includes(search.toLowerCase()));
      const page = tables.slice(offset, offset + 50);
      return { tables: page.map(t => ({ name: cut(t.name, 256), binding: cut(t.binding, 256), engine: cut(t.engine, 128), columnCount: t.columns.length })), total: tables.length, nextCursor: schemaNext(key, offset + page.length, tables.length), truncated: page.some(t => t.name.length > 256 || t.binding.length > 256 || t.engine.length > 128) };
    },
    tableDescribe(table: string, cursor?: string | null) {
      const t = tableNamed(table);
      const key = JSON.stringify(['columns', table]);
      const offset = schemaOffset(key, cursor);
      const page = t.columns.slice(offset, offset + 30);
      const metadata = connection.schemaMetadata?.().tables.find(t => t.name === table);
      const keys = boundedValue({ sortingKey: metadata?.sortingKey ?? [], primaryKey: metadata?.primaryKey ?? [], partitionKey: metadata?.partitionKey ?? [] });
      let truncated = keys.truncated || t.binding.length > 256 || t.engine.length > 128;
      const columns = page.map(c => {
        const meta = metadata?.columns.find(m => m.name === c.name);
        const comment = meta?.comment ?? '';
        truncated ||= c.name.length > 256 || c.type.length > 512 || comment.length > 512;
        return { name: cut(c.name, 256), type: cut(c.type, 512), comment: cut(comment, 512), defaultKind: cut(meta?.defaultKind ?? '', 128), position: meta?.position ?? null };
      });
      return { name: t.name, binding: cut(t.binding, 256), engine: cut(t.engine, 128), keys: keys.value, sizeEstimates: { available: false, reason: 'Row and byte estimates are not collected by Studio introspection.' }, columns, totalColumns: t.columns.length, nextCursor: schemaNext(key, offset + page.length, t.columns.length), truncated };
    },
    async columnsDescribe(table: string, columns: string[], signal?: AbortSignal) {
      const t = tableNamed(table);
      if (!columns.length || columns.length > 8 || new Set(columns).size !== columns.length) throw new Error('Select 1–8 distinct columns');
      const selected = columns.map(name => {
        const column = t.columns.find(c => c.name === name);
        if (!column || name.length > 256) throw new Error('Unknown column');
        return column;
      });
      // Identifiers must come from introspection AND are quoted. No user SQL/settings accepted.
      const stats = [];
      for (const column of selected) {
        signal?.throwIfAborted();
        const id = quoteIdentifier(column.name);
        // ClickHouse resolves a name to a SELECT alias first, so an alias equal to the column would read itself.
        const collided = `${column.name}__stat`;
        const as = (name: string) => (name === column.name ? collided : name);
        const simple = /^(Nullable\(|LowCardinality\()*(U?Int\d+|Float\d+|Decimal|Date|String|FixedString|Enum|Bool|UUID)/.test(column.type);
        const range = /^(Nullable\(|LowCardinality\()*(U?Int\d+|Float\d+|Decimal|Date)/.test(column.type);
        const query = `SELECT count() AS ${as('sampledRows')}, countIf(isNull(${id})) AS ${as('nulls')}${simple ? `, uniqCombined64(${id}) AS ${as('approximateDistinct')}, topK(5)(substring(toString(${id}), 1, 128)) AS ${as('commonValues')}` : ''}${range ? `, toString(min(${id})) AS ${as('min')}, toString(max(${id})) AS ${as('max')}` : ''} FROM (SELECT ${id} FROM ${quoteIdentifier(connection.database)}.${quoteIdentifier(table)} LIMIT 10000)`;
        const result = await connection.driver.query({ query, format: 'JSONEachRow', abort_signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), clickhouse_settings: AGENT_SETTINGS });
        try {
          const [row] = await result.json<Record<string, unknown>>();
          if (row && collided in row) { row[column.name] = row[collided]; delete row[collided]; }
          const values = boundedValue(row);
          stats.push({ column: column.name, type: cut(column.type, 512), statistics: values.value, truncated: values.truncated, unsupportedStatistics: !simple });
        } finally { result.close(); }
      }
      return { table, sampleScope: { maxRows: 10000, method: 'First rows in storage order; not random or representative. Each column sampled independently.', commonValuesScope: 'Approximate topK of non-null values converted to strings and truncated to 128 bytes BEFORE counting; long values can collide. No frequencies reported.', nullsScope: 'nulls is the number of NULL rows among sampledRows; approximateDistinct excludes NULL', scanRowsBudget: 1000000, scanBytesBudget: 67108864 }, columns: stats };
    },
  };
}
export type AgentCapabilities = ReturnType<typeof createAgentCapabilities>;
