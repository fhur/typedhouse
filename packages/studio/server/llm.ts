import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, Harness, MemoryStorage, type Storage } from '@earendil-works/pi-durable';
import type { MutableModels } from '@earendil-works/pi-ai';
import { chatExtension, createChats, endLeftoverRuns, unavailableChats, type ChatService, type CheckResult } from './chat.js';
import type { ModelRef } from './pi.js';
import type { ExplorationCapabilities } from './tools.js';
export type { ExplorationCapabilities, ExplorationArgs } from './tools.js';

/** The same compile path as a run, without ClickHouse: what `query_validate` answers. */
export type { CheckResult };
export type ModelStatus = ({ available: true } & ModelRef) | { available: false; reason: string };

export interface ModelInfo { provider: string; modelId: string; name: string }
export type ModelList = { models: ModelInfo[]; reason?: string };

export interface Llm {
  /** The current model; `selectModel` changes it for this server session only. */
  readonly status: ModelStatus;
  listModels(): Promise<ModelList>;
  selectModel(ref: ModelRef): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Conversations that persist and continue (R13). */
  readonly chat: ChatService;
  close(): Promise<void>;
}

const MAX_TURNS = 16;
const TIMEOUT_MS = 180_000;
/** After a timeout, how long to wait for the abort to settle before giving up on it (F1). */
const ABORT_GRACE_MS = 5_000;
const context = BACKGROUND_CONTEXT;

/** The SQLite store of a data dir. Loaded only when needed: node:sqlite prints an ExperimentalWarning on import. */
export async function openStorage(dataDir: string): Promise<Storage> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  return openNodeSqliteStorage(join(dataDir, 'pi.sqlite'));
}

export function unavailableLlm(reason: string): Llm {
  return {
    status: { available: false, reason },
    listModels: async () => ({ models: [], reason }),
    selectModel: async () => ({ ok: false, error: `LLM unavailable: ${reason}` }),
    chat: unavailableChats(reason),
    close: async () => {},
  };
}

/**
 * The cheat sheet's example tables and snippets. Every snippet type-checks and compiles against these
 * tables (test/cheatsheet.test.ts runs each through the same check as query_validate).
 */
export const CHEAT_SHEET_TABLES: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  ['events', [['id', 'UInt64'], ['ts', 'DateTime64(3)'], ['country', 'LowCardinality(String)'], ['status', 'String'], ['amount', 'Float64'], ['price', 'Float64'], ['qty', 'UInt32'], ['user_id', 'String'], ['account_id', 'UInt64']]],
  ['accounts', [['id', 'UInt64'], ['name', 'String']]],
  ['orders_2023', [['amount', 'Float64']]],
  ['orders_2024', [['amount', 'Float64']]],
];
export const CHEAT_SHEET: readonly { label: string; source: string; note?: string }[] = [
  { label: 'Filter', source: "export default from(events).where(r => r.country.eq('DE').and(r.amount.gt(10)))" },
  { label: 'Compare', source: "export default from(events).where(r => r.account_id.gt(10n).and(r.status.in(['paid', 'open'])).and(r.amount.between(1, 100)))",
    note: 'eq ne gt ge lt le, in([...]), notIn([...]), between(a, b), isNull(), isNotNull(), ifNull(x); combine with and/or/not. UInt64/Int64 columns compare with bigint literals (10n).' },
  { label: 'Project', source: 'export default from(events).map(r => ({ id: r.id, total: r.price.multiply(r.qty) }))', note: 'plus minus multiply divide' },
  { label: 'Group, filter groups, order, limit', source: "export default from(events).groupBy(r => ({ country: r.country })).aggregate(g => ({ orders: count(), revenue: sum(g.amount), avgAmount: avg(g.amount), last: max(g.ts), users: uniq(g.user_id) })).where(r => r.orders.gt(10n)).orderBy(r => r.revenue.desc()).thenBy(r => r.country).limit(20)",
    note: 'Keys come first in the output; .where(...) after .aggregate(...) filters groups (HAVING); ordering on outputs comes after map/aggregate. uniq() takes String columns; use count() or uniqExact() as the types allow.' },
  { label: 'Join', source: 'export default join({ e: from(events), a: from(accounts) }).on(r => r.e.account_id.eq(r.a.id)).map(r => ({ id: r.e.id, name: r.a.name }))' },
  { label: 'Left join (right side nullable)', source: 'export default leftJoin({ e: from(events) }, { a: from(accounts) }).on(r => r.e.account_id.eq(r.a.id)).map(r => ({ id: r.e.id, name: r.a.name }))' },
  { label: 'Union with a label per table', source: "export default unionAll(from(orders_2023).map(o => ({ source: val('orders_2023'), amount: o.amount })), from(orders_2024).map(o => ({ source: val('orders_2024'), amount: o.amount }))).groupBy(r => ({ source: r.source })).aggregate(g => ({ rows: count(), total: sum(g.amount) }))" },
];
function cheatSheet(): string {
  const tables = CHEAT_SHEET_TABLES.map(([name, columns]) => `${name}(${columns.map(([c, t]) => `${c} ${t}`).join(', ')})`).join(', ');
  return [`(examples use these tables: ${tables})`, ...CHEAT_SHEET.map(e => `- ${e.label}: ${e.source.replace(/^export default /, '')}${e.note ? `\n  ${e.note}` : ''}`),
    "- Columns whose names are not identifiers: r['odd-name'].", '- Every JS value becomes a typed parameter; never build SQL strings.'].join('\n');
}

const CHAT_GUIDE = `You write TypedHouse queries: TypeScript that builds a ClickHouse query with the @typedhouse/core builder.

Editor contract
- The tables below and every @typedhouse/core export (from, join, leftJoin, count, sum, avg, max, uniq, ...) are already in scope by name. Do not import anything and do not redefine tables.
- End with \`export default query\` (or define \`const query = ...\`).
- Build the query synchronously: no async, await, Promise or timers.
- Write one chained call per line (start each \`.where\`, \`.map\`, \`.groupBy\`, ... on its own line).
- When combining several tables with unionAll, give every branch a literal label column such as \`source: val('<table>')\`, so the result says which table each row came from.
- query_validate type-checks the source like a TypeScript editor and compiles it; every type error (reported as line:col) must be fixed, not only runtime errors.
- This is a conversation about one query. Each user message ends with what the editor currently contains, which may include the user's own edits: build on that, not on your earlier source.
- Explore with tables_list, table_describe and columns_describe before guessing schema. Use docs_search then docs_read to learn supported builder APIs; do not invent methods.
- Workflow: explore, query_validate, query_run when real data is needed, then query_apply (or chart_validate and chart_apply). Validation and execution never change the editor. query_results_get pages a query_run result in this conversation.
- To change the query, call query_apply with complete source and a one-line \`summary\`. Fix any errors and retry. Only query_apply/chart_apply apply editor versions and end the turn, and neither can share a message with other tools. Do not repeat accepted code in prose.
- Never invent data, counts or observations. Base data answers on actual tool results, and say when results are bounded or execution is unavailable.
- If the message needs no query change (a clarifying question, an answer about the data or the schema), reply in plain text; use exploration tools when evidence is needed, but do not apply.
- To chart the result, call chart_apply with a complete Vega-Lite spec as a JSON object and a one-line \`summary\`. The studio binds the rows: never set "data" (no values, no url) and never invent rows. Every "field" must be a result column of the query, or a name created earlier with "as" in a transform. Prefer simple marks, without "width", "height", "config" or colors. If the chart needs a query change, pass the complete new query as \`source\` in that same chart_apply call instead of calling query_apply. Unless the user asks for a query change, leave the query as it is.

Builder cheat sheet
${cheatSheet()}

Example
const query = from(events)
  .where(o => o.status.eq('paid'))
  .groupBy(o => ({ country: o.country }))
  .aggregate(g => ({ orders: count(), revenue: sum(g.amount) }))
  .orderBy(r => r.revenue.desc())

export default query`;

/**
 * The chat through pi-durable: one Harness over `storage`, and `query_apply` and `chart_apply` compiling through the same `prepare()`
 * as a run. Conversations old installs made under other extensions stay in the file, unlisted: a stored extension name that isn't
 * installed is simply not selected, and any of their runs a kill left unfinished is ended at open.
 */
export async function createLlm(options: {
  models: MutableModels; model: ModelRef; schema: () => string; check: (source: string) => CheckResult | Promise<CheckResult>;
  maxTurns?: number; storage?: Storage; timeoutMs?: number; abortGraceMs?: number;
  exploration?: ExplorationCapabilities;
}): Promise<Llm> {
  let model: ModelRef = { provider: options.model.provider, modelId: options.model.modelId };
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const registry = createRegistry();
  const chatTools = chatExtension({ guide: CHAT_GUIDE, schema: options.schema, check: options.check, ...(options.exploration ? { exploration: options.exploration } : {}) });
  registry.install(chatTools);
  const harness = await Harness.open(options.storage ?? new MemoryStorage(), { models: options.models, registry, settings: { retry: { maxRetries: 2 } } }, context);
  const abortGraceMs = options.abortGraceMs ?? ABORT_GRACE_MS;
  // Before anything can submit: a run a killed process left must not resume by itself.
  await endLeftoverRuns(harness, abortGraceMs);
  let busy = false;

  async function guarded<R extends { ok: boolean }>(busyResult: R, fail: (error: string) => R, work: () => Promise<R>): Promise<R> {
    if (busy) return busyResult;
    busy = true;
    try { return await work(); }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  }

  const chat = createChats(harness, { extension: chatTools, model: () => model, maxTurns, timeoutMs, abortGraceMs, check: options.check, exclusive: guarded });

  return {
    chat,
    get status(): ModelStatus { return { available: true, provider: model.provider, modelId: model.modelId }; },
    async listModels() {
      // Chat models of providers with complete auth (credentials checked, no OAuth refresh, no network).
      const available = await options.models.getAvailable();
      const models = available.map(m => ({ provider: m.provider, modelId: m.id, name: m.name ?? m.id }));
      return models.length ? { models } : { models, reason: 'No provider has credentials: log in with pi.' };
    },
    async selectModel(ref) {
      if (!options.models.getModel(ref.provider, ref.modelId)) return { ok: false, error: `Unknown model ${ref.provider}/${ref.modelId}.` };
      // Same rule as listModels: only models whose provider has credentials.
      const available = await options.models.getAvailable(ref.provider);
      if (!available.some(m => m.id === ref.modelId)) return { ok: false, error: `No credentials for ${ref.provider}: log in with pi to use ${ref.provider}/${ref.modelId}.` };
      model = { provider: ref.provider, modelId: ref.modelId };
      return { ok: true };
    },
    // Bounded: after an F1 timeout a provider that ignores aborts can keep a stream open, and closing waits on it.
    async close() {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([harness.close(context).catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, abortGraceMs); })]);
      clearTimeout(timer);
    },
  };
}
