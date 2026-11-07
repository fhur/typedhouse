import { describe, it, expect, vi } from 'vitest';
import { boundedValue, createAgentCapabilities, RESULT_LIMITS } from '../server/agent-results.js';
import { createAgentDocs } from '../server/agent-docs.js';
import { AGENT_SETTINGS, type Connection } from '../server/clickhouse.js';

function fixture(rows: unknown[] = []) {
  const close = vi.fn();
  const query = vi.fn(async () => ({ json: async () => [{ sampledRows: '3', nulls: '1', approximateDistinct: '2', commonValues: ['a', 'b'] }], close }));
  const connection = {
    database: 'test', tables: () => [{ name: 'events', binding: 'events', engine: 'Memory', columns: [{ name: 'category', type: 'Nullable(String)' }] }],
    runAgentQuery: vi.fn(async () => ({ rows, sql: 'SELECT x', columns: [], truncated: false, elapsedMs: 0 })),
    driver: { query } as unknown as Connection['driver'],
  };
  return { connection, query, close };
}
describe('agent results', () => {
  it('owns snapshots, binds opaque cursors to results, and expires without revealing existence', async () => {
    let time = 0;
    const { connection } = fixture(Array.from({ length: 45 }, (_, n) => ({ n })));
    const a = createAgentCapabilities(connection, () => time);
    const first = await a.queryRun('query', 'conversation');
    expect(first.rows).toHaveLength(20);
    expect(first.nextCursor).toMatch(/^[\da-f-]+$/);
    expect(() => a.queryResultsGet(first.resultId, null, 'other')).toThrow('unavailable');
    expect(() => a.queryResultsGet(first.resultId, '20', 'conversation')).toThrow('cursor');
    const second = a.queryResultsGet(first.resultId, first.nextCursor, 'conversation');
    expect(second.rows).toHaveLength(20);
    const other = await a.queryRun('query', 'conversation');
    expect(() => a.queryResultsGet(other.resultId, first.nextCursor, 'conversation')).toThrow('cursor');
    expect(() => createAgentCapabilities(connection).queryResultsGet(first.resultId, null, 'conversation')).toThrow('unavailable');
    time += RESULT_LIMITS.ttlMs;
    expect(() => a.queryResultsGet(first.resultId, null, 'conversation')).toThrow('unavailable');
  });
  it('bounds display cells, pages and retained rows with explicit truncation', async () => {
    const { connection } = fixture(Array.from({ length: 500 }, () => ({ x: '💡'.repeat(10_000), n: 123n })));
    const a = createAgentCapabilities(connection);
    let page = await a.queryRun('query', 'owner');
    expect(page.truncated).toBe(true);
    expect(page.retainedRows).toBeLessThan(500);
    expect(JSON.stringify(page)).toContain('123');
    let cursor: string | null = page.nextCursor;
    while (cursor) {
      const next = a.queryResultsGet(page.resultId, cursor, 'owner');
      expect(Buffer.byteLength(JSON.stringify(next.rows))).toBeLessThanOrEqual(RESULT_LIMITS.pageBytes);
      cursor = next.nextCursor;
    }
    a.releaseOwner('owner');
    expect(() => a.queryResultsGet(page.resultId, null, 'owner')).toThrow();
  });
  it('has a global snapshot-count quota across factories', async () => {
    const { connection } = fixture([{ n: 1 }]);
    const a = createAgentCapabilities(connection);
    const first = await a.queryRun('', 'owner');
    for (let n = 0; n < RESULT_LIMITS.snapshots; n++) await createAgentCapabilities(connection).queryRun('', 'other');
    expect(() => a.queryResultsGet(first.resultId, null, 'owner')).toThrow('unavailable');
  });
  it('filters before pagination and reaches wide schemas with scoped cursors', () => {
    const { connection } = fixture();
    connection.tables = () => Array.from({ length: 150 }, (_, n) => ({ name: `table_${n}`, binding: `table_${n}`, engine: 'Memory', columns: Array.from({ length: 120 }, (_, c) => ({ name: `column_${c}`, type: 'String' })) }));
    const api = createAgentCapabilities(connection);
    const first = api.tablesList();
    expect(first.tables).toHaveLength(50);
    expect(api.tablesList('', first.nextCursor).tables[0]?.name).toBe('table_50');
    expect(api.tablesList('table_149').tables[0]?.name).toBe('table_149');
    expect(() => api.tablesList('other', first.nextCursor)).toThrow('cursor');
    const wide = api.tableDescribe('table_149');
    expect(wide.columns).toHaveLength(30);
    expect(api.tableDescribe('table_149', wide.nextCursor).columns[0]?.name).toBe('column_30');
    expect(() => api.tableDescribe('table_148', wide.nextCursor)).toThrow('cursor');
    const failed = createAgentCapabilities({ ...connection, schemaError: () => 'offline' });
    expect(() => failed.tablesList()).toThrow('Schema unavailable: offline');
  });
  it('omits oversized keys without colliding and preserves metadata truncation on later pages', async () => {
    const prefix = 'x'.repeat(128);
    const bounded = boundedValue({ [prefix]: 'kept', [prefix + 'a']: 'a', [prefix + 'b']: 'b' });
    expect(bounded).toEqual({ value: { [prefix]: 'kept' }, truncated: true });
    const { connection } = fixture(Array.from({ length: 25 }, () => ({ x: 1 })));
    const api = createAgentCapabilities({ ...connection, runAgentQuery: async () => ({ rows: Array.from({ length: 25 }, () => ({ x: 1 })), sql: 'SELECT x', elapsedMs: 0, truncated: false, columns: Array.from({ length: 21 }, (_, n) => ({ name: `c${n}`, path: [`c${n}`], type: 'String' })) }) });
    // 21 columns fit (#10): metadata has its own limit, and only a cut row marks the rows truncated.
    const first = await api.queryRun('', 'owner');
    expect(first).toMatchObject({ truncated: false, columnsTruncated: false });
    expect(api.queryResultsGet(first.resultId, first.nextCursor, 'owner').truncated).toBe(false);
    // Past the limit the rows are cut too, and that stays true on later pages.
    const names = Array.from({ length: RESULT_LIMITS.columns + 1 }, (_, n) => `c${n}`);
    const cutRows = createAgentCapabilities({ ...connection, runAgentQuery: async () => ({ rows: Array.from({ length: 25 }, () => Object.fromEntries(names.map(name => [name, 1]))), sql: 'SELECT x', elapsedMs: 0, truncated: false, columns: names.map(name => ({ name, path: [name], type: 'String' })) }) });
    const cut = await cutRows.queryRun('', 'owner');
    expect(cut).toMatchObject({ truncated: true, columnsTruncated: true });
    expect(cutRows.queryResultsGet(cut.resultId, cut.nextCursor, 'owner').truncated).toBe(true);
  });
  it('bounds nested/circular display values', () => {
    const x: unknown[] = []; x.push(x);
    expect(boundedValue(x).truncated).toBe(true);
    expect(boundedValue({ x: new Date('2024-01-01'), y: Infinity }).value).toEqual({ x: '2024-01-01T00:00:00.000Z', y: 'Infinity' });
  });
  it('uses only introspected identifiers and bounded statistics templates', async () => {
    const { connection, query, close } = fixture();
    const a = createAgentCapabilities(connection);
    await expect(a.columnsDescribe('events; DROP TABLE x', ['category'])).rejects.toThrow('Unknown table');
    await expect(a.columnsDescribe('events', ['category` FROM x'])).rejects.toThrow('Unknown column');
    expect(query).not.toHaveBeenCalled();
    const result = await a.columnsDescribe('events', ['category']);
    expect(result.columns[0]?.statistics).toMatchObject({ nulls: '1', approximateDistinct: '2', commonValues: ['a', 'b'] });
    expect(query.mock.calls[0]).toBeDefined();
    const args = (query.mock.calls as unknown as [{ query: string; clickhouse_settings: unknown }][])[0]![0];
    expect(args.query).toContain('LIMIT 10000');
    expect(args.query).toContain('uniqCombined64(`category`)');
    expect(args.clickhouse_settings).toEqual(AGENT_SETTINGS);
    expect(close).toHaveBeenCalled();
    expect(result.sampleScope.method).toContain('not random');
  });
});
describe('agent docs', () => {
  it('reads all local allowlisted docs and bounds search output', () => {
    const docs = createAgentDocs();
    expect(docs.read('query-builder/overview').version).toMatch(/^\d+\.\d+\.\d+/);
    const first = docs.search('');
    expect(first.nextCursor).toBeTruthy();
    expect(docs.search('', first.nextCursor).matches[0]?.id).not.toBe(first.matches[0]?.id);
    expect(() => docs.search('other', first.nextCursor)).toThrow('cursor');
    expect(docs.search('argMax').matches.length).toBeGreaterThan(0);
    let cursor: string | null = null;
    let longest = '';
    do {
      const page = docs.search('', cursor);
      for (const match of page.matches) if (docs.read(match.id).nextCursor) longest = match.id;
      cursor = page.nextCursor;
    } while (cursor);
    expect(longest).not.toBe('');
    const doc = docs.read(longest);
    expect(docs.read(longest, doc.nextCursor).text).not.toBe(doc.text);
    expect(docs.search('aggregate').matches.length).toBeGreaterThan(0);
    expect(docs.search('').matches.length).toBeLessThanOrEqual(8);
    expect(() => docs.read('../../package.json')).toThrow('Unknown');
    expect(() => docs.read('https://example.com')).toThrow('Unknown');
    expect(() => docs.search('a'.repeat(257))).toThrow();
  });
});
