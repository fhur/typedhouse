import { defineTool } from '@earendil-works/pi-durable';
import { MAX_SOURCE } from '../web/rules.js';

/** Every result access is scoped to the current conversation, including forks. */
export interface ExplorationArgs {
  query_run: { source: string };
  query_results_get: { resultId: string; cursor?: string };
  tables_list: { search?: string; cursor?: string };
  table_describe: { table: string; cursor?: string };
  columns_describe: { table: string; columns: string[] };
  docs_search: { query: string; cursor?: string };
  docs_read: { id: string; cursor?: string };
}
export type ExplorationCapabilities = {
  [K in keyof ExplorationArgs]: (args: ExplorationArgs[K], owner: number) => unknown | Promise<unknown>;
};

const text = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v) ?? 'No result.';
const descriptions: Record<keyof ExplorationArgs, string> = {
  query_run: 'Run a complete TypedHouse query without changing the editor. Returns bounded real results and a resultId for paging.',
  query_results_get: 'Read a bounded page of a prior query result belonging to this conversation. Pass its opaque nextCursor as cursor; omit cursor for the first page.',
  tables_list: 'Discover available tables and their builder bindings, optionally filtering by search. Pass nextCursor as cursor for further pages, retaining the same search.',
  table_describe: 'Inspect a table and its columns before writing a query. Pass nextCursor as cursor for further columns of the same table.',
  columns_describe: 'Inspect sampled value statistics for 1–8 named columns: nulls, approximate distinct values, common values and supported ranges. Samples are not representative; do not treat them as exact full-table statistics.',
  docs_search: 'Search TypedHouse documentation for supported APIs and examples. Pass nextCursor as cursor for more matches with the same query.',
  docs_read: 'Read documentation by its fixed ID returned by docs_search, not a path or URL. Pass nextCursor as cursor to continue reading the same document.',
};
const string = { type: 'string' };
const schemas = {
  query_run: { properties: { source: string }, required: ['source'] },
  query_results_get: { properties: { resultId: string, cursor: string }, required: ['resultId'] },
  tables_list: { properties: { search: string, cursor: string }, required: [] },
  table_describe: { properties: { table: string, cursor: string }, required: ['table'] },
  columns_describe: { properties: { table: string, columns: { type: 'array', items: string, minItems: 1, maxItems: 8, uniqueItems: true } }, required: ['table', 'columns'] },
  docs_search: { properties: { query: string, cursor: string }, required: ['query'] },
  docs_read: { properties: { id: string, cursor: string }, required: ['id'] },
};

export function explorationTools(capabilities?: ExplorationCapabilities) {
  return (Object.keys(schemas) as (keyof ExplorationArgs)[]).map(name => defineTool({
    name,
    description: descriptions[name],
    parameters: { type: 'object' as const, ...schemas[name], additionalProperties: false },
    execute: async (raw, api) => {
      try {
        if (name === 'query_run') {
          const { source } = raw as ExplorationArgs['query_run'];
          if (source.length > MAX_SOURCE) throw new Error(`Source exceeds ${MAX_SOURCE} characters. Shorten the query before running it.`);
        }
        if (!capabilities) throw new Error('Exploration is unavailable on this server. Ask the user to configure the database/documentation capabilities.');
        const invoke = capabilities[name] as (args: unknown, owner: number) => unknown;
        const result = await invoke(raw, api.conversationId);
        return { output: [{ type: 'text' as const, text: text(result) }], ...(result && typeof result === 'object' && 'ok' in result && result.ok === false ? { isError: true } : {}) };
      } catch (error) {
        return { output: [{ type: 'text' as const, text: `${name} failed: ${error instanceof Error ? error.message : String(error)} Correct the arguments or try a narrower request.` }], isError: true };
      }
    },
  }));
}
