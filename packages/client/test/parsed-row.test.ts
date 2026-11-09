import { beforeEach, describe, expect, it, vi } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { createClient, QueryError } from '../src/index.js';

const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(async () => {}) }));

vi.mock('@clickhouse/client', async original => ({
  ...(await original<typeof import('@clickhouse/client')>()),
  createClient: () => driver,
}));

/** Tester, SETTINGS rework. What the client makes of each line of a real driver row, through run and stream. */
const q = from(
  table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
);

function line(text: string) {
  return { text, json: () => JSON.parse(text) as unknown };
}

function serve(lines: readonly string[]) {
  const close = vi.fn();
  const destroy = vi.fn();

  driver.query.mockResolvedValueOnce({
    close,
    stream: () => {
      const iterator = (async function* () {
        yield lines.map(line);
      })();

      return Object.assign(iterator, { destroy });
    },
  });

  return { close };
}

const paths = [
  ['run', (client: ReturnType<typeof createClient>) => client.run(q)],
  [
    'stream',
    async (client: ReturnType<typeof createClient>) => {
      const rows: unknown[] = [];
      for await (const row of client.stream(q)) rows.push(row);
      return rows;
    },
  ],
] as const;

beforeEach(() => vi.clearAllMocks());

const REAL =
  'Code: 396. DB::Exception: Limit for result exceeded. (TOO_MANY_ROWS_OR_BYTES) (version 24.8.14.39 (official build))';

describe.each(paths)('%s', (_name, read) => {
  it.each([
    ['the server form', REAL, '396'],
    [
      'braces and quotes',
      `Code: 395. DB::Exception: b {"x":1} 'q': while executing. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 24.8.14.39 (official build))`,
      '395',
    ],
    ['JSON-looking end', 'Code: 6. {"exception": "x"}', '6'],
    ['a form parseError does not know', 'Code: 999. no exception word here', '999'],
  ])('a text error line after rows keeps its code: %s', async (_case, text, code) => {
    const client = createClient();
    const { close } = serve(['{"id":"1"}', text, '{"id":"2"}']);
    const error = await read(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).cause).toMatchObject({ code });
    expect((error as QueryError).sql).toBe(compile(q.ir).sql);
    expect((error as QueryError).params).toEqual(compile(q.ir).params);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTML from a gateway', '<html>502</html>'],
    ['an unrelated word', 'Error: boom'],
    ['lower case', 'code: 396. DB::Exception: x'],
    ['no number', 'Code: x. DB::Exception: y'],
    ['no period', 'Code: 396 DB::Exception: y'],
    ['no space after the period', 'Code: 396.DB::Exception: y'],
    ['a leading space', ' Code: 396. DB::Exception: y'],
    ['the 25.11 marker alone', '__exception__'],
    ['a partial row', '{"id":'],
    ['an empty line', ''],
  ])('a non-JSON line that is not the error text still fails: %s', async (_case, text) => {
    const client = createClient();
    const { close } = serve(['{"id":"1"}', text]);
    const error = await read(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).cause).toBeInstanceOf(SyntaxError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a JSON row holding error text is data', async () => {
    const client = createClient();

    const text = table(
      't',
      { id: col.String },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    );

    serve([JSON.stringify({ id: REAL }), JSON.stringify({ id: `a\n${REAL}` })]);

    expect(await client.run(from(text))).toEqual([{ id: REAL }, { id: `a\n${REAL}` }]);
  });

  it('a decode failure is a QueryError, and the result closes once', async () => {
    const client = createClient();
    const { close } = serve(['{"id":"not a number"}']);
    await expect(read(client)).rejects.toBeInstanceOf(QueryError);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
