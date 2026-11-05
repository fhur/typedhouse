import { ClickHouseLogLevel, createClient as createDriver } from '@clickhouse/client';
import { createClient } from '@typedhouse/client';
import { introspect, type DatabaseSchema } from '@typedhouse/codegen';
import { print } from '@typedhouse/core';
import { editorSchema, editorScope, messageOf, prepare, schemaScope, StudioError, type Column } from './eval.js';
import type { CheckResult } from './llm.js';
import { createTypeService, type CoreMode, type TypeDiagnostic, type TypeService } from './types.js';
import { createTypeWorker } from './types-client.js';

export interface ConnectionConfig { url: string; username: string; password: string; database: string }
/** `binding` is the identifier the table has in the editor (see `editorSchema`: never a core export name). */
export interface TableSummary { name: string; binding: string; engine: string; columns: { name: string; type: string }[] }

export type RunResult =
  | { ok: true; sql: string; params: Record<string, string>; rowType: string; columns: Column[]; rows: unknown[]; rowCount: number; limited: boolean; elapsedMs: number }
  | { ok: false; error: { stage: StudioError['stage']; message: string } };

// superjson refuses these keys (prototype-pollution guard), and column names and Map keys can be any string.
// Rows are display data, so such keys travel bracketed: `__proto__` → `[__proto__]`; column paths match.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const transportKey = (key: string) => UNSAFE_KEYS.has(key) ? `[${key}]` : key;
function transportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transportValue);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [transportKey(key), transportValue(item)]));
}

/**
 * One ClickHouse connection for the studio. Both the raw driver (introspection) and the TypedHouse
 * client send readonly=2 with every request: reads only, while still allowing the per-query output
 * settings the client sends (readonly=1 would reject those).
 */
export function connect(config: ConnectionConfig, typeOptions: { core?: CoreMode | 'auto' } = {}) {
  // Driver logging is off: every failure is reported through the stage/message result or the startup warning.
  const options = { url: config.url, username: config.username, password: config.password, database: config.database, clickhouse_settings: { readonly: '2' as const }, log: { level: ClickHouseLogLevel.OFF } };
  const driver = createDriver(options);
  const client = createClient(options);
  let schema: DatabaseSchema = { tables: [], functions: [] };
  let scope: Record<string, unknown> = editorScope({});
  let schemaError: string | undefined;
  let names = new Map<string, string>();
  let source = '';
  /** Editor language intelligence over the same schema and bindings (R12). */
  // Editor intelligence runs in a worker thread so runs and generation never wait on type checks.
  const types = createTypeWorker(typeOptions);
  // An in-process service only for the synchronous `check` (tests, embedding); created on first use.
  let local: TypeService | undefined;
  const host = (() => { try { return new URL(config.url).host; } catch { return config.url; } })();

  async function refresh() {
    try {
      schema = await introspect(driver, config.database);
      scope = editorScope(schemaScope(schema));
      const rendered = editorSchema(schema);
      names = rendered.bindings;
      source = rendered.source;
      types.setSchema(schema);
      local?.setSchema(schema);
      schemaError = undefined;
    } catch (error) {
      schemaError = messageOf(error);
    }
  }

  async function runQuery(input: { source: string; autoLimit: boolean }): Promise<RunResult> {
    try {
      const prepared = prepare(input.source, scope, { autoLimit: input.autoLimit });
      const started = performance.now();
      let rows: unknown[];
      try { rows = await client.run(prepared.execute); }
      catch (error) { throw new StudioError('clickhouse', messageOf((error as { cause?: unknown }).cause ?? error)); }
      const elapsedMs = Math.round(performance.now() - started);
      const limited = prepared.limit !== undefined && rows.length > prepared.limit;
      if (limited) rows = rows.slice(0, prepared.limit);
      const columns = prepared.columns.map(c => ({ ...c, path: c.path.map(transportKey) }));
      return { ok: true, sql: prepared.compiled.sql, params: { ...prepared.compiled.params }, rowType: prepared.rowType, columns, rows: rows.map(transportValue), rowCount: rows.length, limited, elapsedMs };
    } catch (error) {
      if (error instanceof StudioError) return { ok: false, error: { stage: error.stage, message: error.message } };
      return { ok: false, error: { stage: 'evaluate', message: messageOf(error) } };
    }
  }

  /**
   * The LLM's `check_query`: 0 type errors (same globals as the editor) and a compile exactly as a run
   * would (no ClickHouse). Type errors come back with line:col so the model can fix them.
   */
  function check(source: string): CheckResult {
    if (!local) { local = createTypeService(typeOptions); local.setSchema(schema); }
    return finishCheck(source, local.check(source));
  }
  /** `check` with the type check in the worker: what the server's LLM uses, so the event loop stays free. */
  async function checkAsync(source: string): Promise<CheckResult> {
    return finishCheck(source, await types.checkExact(source));
  }
  function finishCheck(source: string, diagnostics: TypeDiagnostic[]): CheckResult {
    const errors = diagnostics.filter(d => d.severity === 'error');
    if (errors.length) {
      return { ok: false, stage: 'types', message: `${errors.length} type error${errors.length === 1 ? '' : 's'}:\n${errors.slice(0, 8).map(d => `${d.line}:${d.column} ${d.message}`).join('\n')}` };
    }
    try {
      const prepared = prepare(source, scope, { autoLimit: false });
      return { ok: true, sql: prepared.compiled.sql, rowType: prepared.rowType, columns: prepared.columns.map(c => ({ name: c.name, type: c.type })) };
    } catch (error) {
      if (error instanceof StudioError) return { ok: false, stage: error.stage, message: error.message };
      return { ok: false, stage: 'evaluate', message: messageOf(error) };
    }
  }

  return {
    label: `${host} · ${config.database}`,
    database: config.database,
    refresh,
    runQuery,
    check,
    /** The introspected tables as TypeScript, minus the generated-file header: what the LLM is told is in scope. */
    schemaSource: () => source,
    types,
    checkAsync,
    driver,
    tables: (): TableSummary[] => schema.tables.map(t => ({ name: t.name, binding: names.get(t.name) ?? t.name, engine: t.engine, columns: t.columns.map(c => ({ name: c.name, type: print(c.type) })) })),
    schemaError: () => schemaError,
    async close() { await Promise.all([driver.close(), client.close(), types.close()]); },
  };
}
export type Connection = ReturnType<typeof connect>;
