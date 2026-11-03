import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, defineExtension, defineTool, Harness, MemoryStorage, section, type Storage } from '@earendil-works/pi-durable';
import type { Message, MutableModels } from '@earendil-works/pi-ai';
import { obj, str } from '@earendil-works/pi-schema';
import { checkChartSpec, type ChartColumn } from './chart.js';
import type { Stage } from './eval.js';
import type { ModelRef } from './pi.js';

/** The same compile path as a run, without ClickHouse: what `check_query` answers. */
export type CheckResult = { ok: true; sql: string; rowType: string } | { ok: false; stage: Stage; message: string };
export type ModelStatus = ({ available: true } & ModelRef) | { available: false; reason: string };

export type GenerateResult =
  | { ok: true; source: string; sql: string; rowType: string; attempts: number }
  | { ok: false; error: string; source: string | null; attempts: number };

export type ChartResult =
  | { ok: true; spec: Record<string, unknown>; attempts: number }
  | { ok: false; error: string; spec: Record<string, unknown> | null; attempts: number };
export interface ChartInput { prompt: string; columns: ChartColumn[]; sample: unknown[] }

export interface ModelInfo { provider: string; modelId: string; name: string }
export type ModelList = { models: ModelInfo[]; reason?: string };

export interface Llm {
  /** The current model; `selectModel` changes it for this server session only. */
  readonly status: ModelStatus;
  listModels(): Promise<ModelList>;
  selectModel(ref: ModelRef): Promise<{ ok: true } | { ok: false; error: string }>;
  generateQuery(input: { prompt: string; source?: string | undefined }): Promise<GenerateResult>;
  generateChart(input: ChartInput): Promise<ChartResult>;
  close(): Promise<void>;
}

export const MAX_TURNS = 6;
const TIMEOUT_MS = 180_000;
/** After a timeout, how long to wait for the abort to settle before giving up on it (F1). */
const ABORT_GRACE_MS = 5_000;
export const MAX_SAMPLE_ROWS = 20;
const context = BACKGROUND_CONTEXT;

export function unavailableLlm(reason: string): Llm {
  return {
    status: { available: false, reason },
    listModels: async () => ({ models: [], reason }),
    selectModel: async () => ({ ok: false, error: `LLM unavailable: ${reason}` }),
    generateQuery: async () => ({ ok: false, error: `LLM unavailable: ${reason}`, source: null, attempts: 0 }),
    generateChart: async () => ({ ok: false, error: `LLM unavailable: ${reason}`, spec: null, attempts: 0 }),
    close: async () => {},
  };
}

/**
 * The cheat sheet's example tables and snippets. Every snippet type-checks and compiles against these
 * tables (test/cheatsheet.test.ts runs each through the same check as check_query).
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

const GUIDE = `You write TypedHouse queries: TypeScript that builds a ClickHouse query with the @typedhouse/core builder.

Editor contract
- The tables below and every @typedhouse/core export (from, join, leftJoin, count, sum, avg, max, uniq, ...) are already in scope by name. Do not import anything and do not redefine tables.
- End with \`export default query\` (or define \`const query = ...\`).
- Build the query synchronously: no async, await, Promise or timers.
- Write one chained call per line (start each \`.where\`, \`.map\`, \`.groupBy\`, ... on its own line).
- When combining several tables with unionAll, give every branch a literal label column such as \`source: val('<table>')\`, so the result says which table each row came from.
- check_query type-checks the source like a TypeScript editor and compiles it; every type error (reported as line:col) must be fixed, not only runtime errors.
- Always call the check_query tool with the complete source. If it reports an error, fix the source and call check_query again. Once it passes, stop; do not repeat the code in prose.

Builder cheat sheet
${cheatSheet()}

Example
const query = from(events)
  .where(o => o.status.eq('paid'))
  .groupBy(o => ({ country: o.country }))
  .aggregate(g => ({ orders: count(), revenue: sum(g.amount) }))
  .orderBy(r => r.revenue.desc())

export default query`;

const CHART_GUIDE = `You write Vega-Lite specs that chart a ClickHouse query result.

- The result rows are bound by the studio. Never set "data" (no values, no url); never invent rows.
- Every "field" must be one of the result columns listed in the message, or a name created earlier with "as" in a transform.
- Prefer simple marks (bar, line, point, area, arc) with clear axis titles; use "sort" for ranked bars and a temporal x axis for dates.
- Keep the spec small: no "width"/"height", no "config" or colors (the studio applies its theme).
- Always call check_chart with the complete spec as a JSON object. If it reports an error, fix the spec and call check_chart again. Once it passes, stop; do not repeat the spec in prose.`;

type Outcome<T> = { attempts: number; last?: { value: T; passed: boolean; output: string } };

/** The last call of `tool` in the transcript decides the result: its argument `key`, and whether it passed. */
export function readOutcome<T = string>(messages: readonly Message[], tool = 'check_query', key = 'source'): Outcome<T> {
  const calls = new Map<string, T>();
  let attempts = 0;
  let last: { value: T; passed: boolean; output: string } | undefined;
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'toolCall' && block.name === tool) calls.set(block.id, (block.arguments as Record<string, T>)[key] as T);
      }
    } else if (message.role === 'toolResult' && message.toolName === tool) {
      attempts++;
      const output = message.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
      last = { value: calls.get(message.toolCallId) as T, passed: !message.isError, output };
    }
  }
  return last ? { attempts, last } : { attempts };
}

const text = (value: string) => [{ type: 'text' as const, text: value }];
const json = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v));

/**
 * Text → query and text → chart through pi-durable: one Harness over `storage`, a fresh conversation per
 * generation with `maxTurns` bounded, and one check tool per kind (`check_query` compiles through the same
 * `prepare()` as a run; `check_chart` validates the Vega-Lite spec against the result columns). A passing
 * check ends the run (`terminate`), so the model is not asked to repeat itself. Only output that the
 * server-side check accepted is returned as `ok`, and it is checked once more before it is returned.
 * Queries and charts share one busy guard: one generation at a time.
 */
export async function createLlm(options: {
  models: MutableModels; model: ModelRef; schema: () => string; check: (source: string) => CheckResult | Promise<CheckResult>;
  maxTurns?: number; storage?: Storage; timeoutMs?: number; abortGraceMs?: number;
}): Promise<Llm> {
  let model: ModelRef = { provider: options.model.provider, modelId: options.model.modelId };
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  /** Result columns of each chart conversation, for its `check_chart` calls. */
  const chartColumns = new Map<unknown, ChartColumn[]>();

  const checkQuery = defineTool({
    name: 'check_query',
    description: 'Compile the complete TypedHouse source. Returns the ClickHouse SQL and the row type, or the error to fix.',
    parameters: obj({ source: str({ description: 'The complete query.ts source' }) }),
    execute: async args => {
      const result = await options.check(args.source);
      if (result.ok) return { output: text(`OK. Row type: ${result.rowType}\nSQL:\n${result.sql}`), control: { terminate: true } };
      return { output: text(`${result.stage} error: ${result.message}`), isError: true };
    },
  });
  const checkChart = defineTool({
    name: 'check_chart',
    description: 'Validate a complete Vega-Lite spec (a JSON object) against the result columns. Returns OK or the error to fix.',
    parameters: { type: 'object', properties: { spec: { type: 'object', description: 'The complete Vega-Lite spec, without data' } }, required: ['spec'] } as { type: 'object'; properties: { spec: object }; required: ['spec'] },
    execute: async (args, api) => {
      const result = checkChartSpec((args as { spec?: unknown }).spec, chartColumns.get(api.conversationId) ?? []);
      if (result.ok) return { output: text('OK. The chart renders over the result rows.'), control: { terminate: true } };
      return { output: text(result.message), isError: true };
    },
  });
  const queries = defineExtension({
    name: 'typedhouse-query',
    tools: [checkQuery],
    sections: [
      section('guide', () => GUIDE, { tag: false }),
      section('schema', () => `Tables in scope (generated from the database):\n\`\`\`ts\n${options.schema()}\`\`\``),
    ],
  });
  const charts = defineExtension({ name: 'typedhouse-chart', tools: [checkChart], sections: [section('chart_guide', () => CHART_GUIDE, { tag: false })] });
  const registry = createRegistry();
  registry.install(queries);
  registry.install(charts);
  const harness = await Harness.open(options.storage ?? new MemoryStorage(), { models: options.models, registry, settings: { retry: { maxRetries: 2 } } }, context);
  let busy = false;

  /** One bounded conversation: submit, wait (with timeout), and hand back the transcript and how it ended. */
  async function converse(extension: typeof queries, content: string, before?: (conversationId: unknown) => void) {
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model, maxTurns, extensions: [extension] } }, context);
    before?.(conversation.id);
    const submission = await conversation.submit({ type: 'input', content }, context);
    let timer: NodeJS.Timeout | undefined;
    const after = (ms: number) => new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
    const settled = await Promise.race([submission.wait(context), after(timeoutMs)]);
    clearTimeout(timer);
    if (settled === 'timeout') {
      // A provider that ignores the abort signal must not hang us (F1): give the abort a grace period, then move on.
      await Promise.race([conversation.abort(context).catch(() => undefined), after(options.abortGraceMs ?? ABORT_GRACE_MS)]);
      clearTimeout(timer);
    }
    const why = settled === 'timeout' ? `timed out after ${Math.round(timeoutMs / 1000)} s`
      : settled.status === 'unanswered' ? describe(settled, maxTurns) : 'the model stopped checking';
    const answered = settled !== 'timeout' && settled.status === 'done';
    const messages = await Promise.race([conversation.context(context).then(c => c.messages), after(options.abortGraceMs ?? ABORT_GRACE_MS).then(() => [] as Message[])]);
    clearTimeout(timer);
    return { messages, why, answered, id: conversation.id };
  }

  async function guarded<R extends { ok: boolean }>(busyResult: R, fail: (error: string) => R, work: () => Promise<R>): Promise<R> {
    if (busy) return busyResult;
    busy = true;
    try { return await work(); }
    catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  }

  return {
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
    generateQuery(input) {
      const fail = (error: string): GenerateResult => ({ ok: false, error, source: null, attempts: 0 });
      return guarded(fail('A generation is already running.'), fail, async () => {
        const content = input.source?.trim()
          ? `${input.prompt}\n\nThe editor currently contains (edit it if it helps):\n\`\`\`ts\n${input.source}\n\`\`\``
          : input.prompt;
        const { messages, why, answered } = await converse(queries, content);
        const { attempts, last } = readOutcome<string>(messages);
        const source = typeof last?.value === 'string' ? last.value : '';
        if (last?.passed) {
          // Re-check against the current schema: what reaches the editor is what a run compiles.
          const result = await options.check(source);
          if (result.ok) return { ok: true, source, sql: result.sql, rowType: result.rowType, attempts };
          return { ok: false, error: `${result.stage} error: ${result.message}`, source, attempts };
        }
        if (last) return { ok: false, error: `No valid query after ${attempts} attempts (${why}). Last error: ${last.output}`, source, attempts };
        return { ok: false, error: answered ? 'The model answered without a query (it never called check_query).' : `The model stopped (${why}).`, source: null, attempts };
      });
    },
    generateChart(input) {
      const fail = (error: string): ChartResult => ({ ok: false, error, spec: null, attempts: 0 });
      return guarded(fail('A generation is already running.'), fail, async () => {
        const columns = input.columns.map(c => ({ name: c.name, type: c.type }));
        const content = `${input.prompt}\n\nResult columns (name: ClickHouse type):\n${columns.map(c => `- ${c.name}: ${c.type}`).join('\n')}\n\nSample rows (JSON):\n${input.sample.slice(0, MAX_SAMPLE_ROWS).map(json).join('\n')}`;
        let id: unknown;
        try {
          const { messages, why, answered } = await converse(charts, content, conversationId => { id = conversationId; chartColumns.set(conversationId, columns); });
          const { attempts, last } = readOutcome<unknown>(messages, 'check_chart', 'spec');
          const raw = last?.value;
          const spec = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
          if (last?.passed) {
            const result = checkChartSpec(raw, columns);
            if (result.ok) return { ok: true, spec: result.spec, attempts };
            return { ok: false, error: result.message, spec, attempts };
          }
          if (last) return { ok: false, error: `No valid chart after ${attempts} attempts (${why}). Last error: ${last.output}`, spec, attempts };
          return { ok: false, error: answered ? 'The model answered without a chart (it never called check_chart).' : `The model stopped (${why}).`, spec: null, attempts };
        } finally {
          chartColumns.delete(id);
        }
      });
    },
    // Bounded: after an F1 timeout a provider that ignores aborts can keep a stream open, and closing waits on it.
    async close() {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([harness.close(context).catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, options.abortGraceMs ?? ABORT_GRACE_MS); })]);
      clearTimeout(timer);
    },
  };
}

function describe(settled: { readonly reason?: string; readonly detail?: unknown }, maxTurns: number): string {
  if (settled.reason === 'turn_limit') return `turn limit of ${maxTurns} reached`;
  return [settled.reason, typeof settled.detail === 'string' ? settled.detail : settled.detail === undefined ? '' : JSON.stringify(settled.detail)].filter(Boolean).join(': ') || 'no answer';
}
