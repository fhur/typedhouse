import type { ClickHouseClient } from '@clickhouse/client';
import { parseCHType, type CHType } from '@chql/core';

export interface SchemaColumn { name: string; type: CHType; position: number; defaultKind: string; comment: string }
export interface SchemaTable { name: string; columns: SchemaColumn[]; engine: string; sortingKey: string[]; partitionKey: string[]; primaryKey: string[] }
export interface KnownFunction { name: string; isAggregate: boolean; deterministic: boolean | null; aliasTo: string }
export interface DatabaseSchema { tables: SchemaTable[]; functions: KnownFunction[] }

/** Server key expressions, not DDL: commas inside calls/quoted identifiers are not separators. */
export function splitKey(text: string): string[] {
  if (!text.trim()) return [];
  const parts: string[] = [];
  let depth = 0, start = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) { if (text[i + 1] === quote) i++; else quote = ''; }
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts;
}
interface ColumnRecord { table: string; name: string; type: string; position: number; default_kind: string; comment: string; engine: string; sorting_key: string; partition_key: string; primary_key: string }
export async function introspect(client: ClickHouseClient, database: string, options: { skipAlias?: boolean } = {}): Promise<DatabaseSchema> {
  const rows = await (await client.query({ query: `SELECT c.table, c.name, c.type, c.position, c.default_kind, c.comment,
       t.engine, t.sorting_key, t.partition_key, t.primary_key
FROM system.columns AS c
JOIN system.tables AS t ON t.database = c.database AND t.name = c.table
WHERE c.database = {db:String}
ORDER BY c.table, c.position`, query_params: { db: database }, format: 'JSONEachRow' })).json<ColumnRecord>();
  const tables = new Map<string, SchemaTable>();
  for (const row of rows) {
    let table = tables.get(row.table);
    if (!table) { table = { name: row.table, columns: [], engine: row.engine, sortingKey: splitKey(row.sorting_key), partitionKey: splitKey(row.partition_key), primaryKey: splitKey(row.primary_key) }; tables.set(row.table, table); }
    if (options.skipAlias && row.default_kind === 'ALIAS') continue;
    table.columns.push({ name: row.name, type: parseCHType(row.type), position: Number(row.position), defaultKind: row.default_kind, comment: row.comment });
  }
  const probe = await (await client.query({ query: "SELECT name FROM system.columns WHERE database = 'system' AND table = 'functions' AND name = 'deterministic'", format: 'JSONEachRow' })).json<{ name: string }>();
  const functions = await (await client.query({ query: `SELECT name, is_aggregate, ${probe.length ? 'deterministic' : 'NULL AS deterministic'}, alias_to FROM system.functions ORDER BY name`, format: 'JSONEachRow' })).json<{ name: string; is_aggregate: number; deterministic: number | null; alias_to: string }>();
  return { tables: [...tables.values()], functions: functions.map(f => ({ name: f.name, isAggregate: Boolean(f.is_aggregate), deterministic: f.deterministic === null ? null : Boolean(f.deterministic), aliasTo: f.alias_to })) };
}
