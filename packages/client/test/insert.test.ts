import { beforeEach, expect, it, vi } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { quoteIdentifier } from '@typedhouse/compiler';
import {
  createClient,
  createClientFromBackend,
  createClickHouseBackend,
  InsertError,
  InsertValidationError,
  UnsupportedOperationError,
  type Backend,
  type EncodedInsert,
} from '../src/index.js';

const driver = vi.hoisted(() => ({
  insert: vi.fn(async (_: unknown) => {}),
  query: vi.fn(),
  close: vi.fn(async () => {}),
}));

vi.mock('@clickhouse/client', () => ({ createClient: () => driver }));
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;

const source = from(table('writes', { id: col.UInt8 }, meta));
beforeEach(() => vi.clearAllMocks());

function plugin(): Backend {
  return {
    name: 'read-only',
    compile: vi.fn(() => {
      throw new Error('must not compile');
    }),
    run: vi.fn(async function* () {}),
  };
}

it('keeps read-only plugins compatible, including empty commands, and validates before capability checks', async () => {
  const backend = plugin();
  const client = createClientFromBackend(backend);
  await expect(client.execute(source.insertMany([]))).resolves.toBeUndefined();

  await expect(client.execute(source.insertMany([{ id: 1 }]))).rejects.toBeInstanceOf(
    UnsupportedOperationError,
  );

  await expect(client.execute(source.insertMany([{ id: 999 }]))).rejects.toBeInstanceOf(
    InsertValidationError,
  );

  expect(backend.compile).not.toHaveBeenCalled();
  expect(backend.run).not.toHaveBeenCalled();
});

it('preserves the plugin receiver and command snapshots across executions', async () => {
  const rows = [{ id: 1 }];
  const command = source.insertMany(rows);
  rows[0]!.id = 99;
  const seen: EncodedInsert[] = [];

  const backend: Backend = {
    ...plugin(),
    async insert(batch) {
      expect(this).toBe(backend);
      seen.push(batch);
    },
  };

  const client = createClientFromBackend(backend);
  await client.execute(command);
  (seen[0]!.rows[0] as Record<string, unknown>).id = 8;
  await client.execute(command);
  expect(seen[1]!.rows).toEqual([{ id: 1 }]);
  expect(backend.compile).not.toHaveBeenCalled();
});

it('validates the entire batch before dispatch and skips empty writes', async () => {
  const insert = vi.fn(async () => {});
  const client = createClientFromBackend({ ...plugin(), insert });
  await client.execute(source.insertMany([]));

  await expect(client.execute(source.insertMany([{ id: 1 }, { id: 256 }]))).rejects.toBeInstanceOf(
    InsertValidationError,
  );

  expect(insert).not.toHaveBeenCalled();
});

it('wraps backend failure with target and cause, no payload or fake read IR, and never retries', async () => {
  const cause = new Error('transport lost');

  const insert = vi.fn(async () => {
    throw cause;
  });

  const client = createClientFromBackend({ ...plugin(), insert });
  const error = await client.execute(source.insertMany([{ id: 1 }])).catch(e => e);
  expect(error).toBeInstanceOf(InsertError);
  expect(error).toMatchObject({ table: 'writes', cause });
  expect(error.message).toMatch(/outcome may be unknown.*Retrying/);
  for (const key of ['rows', 'params', 'sql', 'node']) expect(error).not.toHaveProperty(key);
  expect(insert).toHaveBeenCalledTimes(1);
});

for (const mode of ['clickhouse', 'clickhouse-naive'] as const)
  it(`${mode}: uses one JSONEachRow driver insert with literal quoted identifiers and mandatory settings`, async () => {
    const name = 'db.dot`\\;--';
    const column = 'x.dot`\\;--';

    const backend = createClickHouseBackend(
      { clickhouse_settings: { async_insert: 1, input_format_null_as_default: 1 } },
      mode,
    );

    const compile = vi.spyOn(backend, 'compile');

    await createClientFromBackend(backend).execute(
      from(table(name, { [column]: col.String }, meta)).insertMany([
        { [column]: 'secret\n"value' },
      ]),
    );

    expect(driver.insert).toHaveBeenCalledExactlyOnceWith({
      table: quoteIdentifier(name),
      columns: [quoteIdentifier(column)],
      values: [{ [column]: 'secret\n"value' }],
      format: 'JSONEachRow',
      clickhouse_settings: {
        input_format_defaults_for_omitted_fields: 1,
        input_format_null_as_default: 0,
        input_format_skip_unknown_fields: 0,
        input_format_allow_errors_num: '0',
        input_format_allow_errors_ratio: 0,
        input_format_import_nested_json: 0,
        input_format_json_named_tuples_as_objects: 1,
        input_format_json_defaults_for_missing_elements_in_named_tuple: 0,
        input_format_json_ignore_unknown_keys_in_named_tuple: 0,
        date_time_input_format: 'best_effort',
        async_insert: 0,
      },
    });

    expect(driver.query).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

it('uses one-row parser blocks for heterogeneous omissions without splitting the request', async () => {
  const source = from(
    table(
      'defaults',
      { id: col.UInt32, a: col.UInt32, b: col.UInt32 },
      {
        ...meta,
        columnMetadata: { a: { defaultKind: 'DEFAULT' }, b: { defaultKind: 'DEFAULT' } },
      },
    ),
  );

  await createClient({ clickhouse_settings: { max_insert_block_size: '100000' } }).execute(
    source.insertMany([{ id: 1 }, { id: 2, a: 30 }]),
  );

  expect(driver.insert).toHaveBeenCalledTimes(1);

  expect(driver.insert.mock.calls[0]![0]).toMatchObject({
    values: [{ id: 1 }, { id: 2, a: 30 }],
    clickhouse_settings: { max_insert_block_size: '1' },
  });
});

it.each([
  {
    name: 'fully supplied rows',
    rows: [
      { id: 1, a: 0, b: 2, n: null },
      { n: 0, b: 3, a: 4, id: 2 },
    ],
    mixed: false,
  },
  {
    name: 'homogeneous omissions in different key orders',
    rows: [
      { id: 1, a: 0, n: null },
      { n: 0, a: 30, id: 2 },
    ],
    mixed: false,
  },
  {
    name: 'transitively omitted defaults in every row',
    rows: [{ id: 1 }, { id: 2 }],
    mixed: false,
  },
  { name: 'single row with omissions', rows: [{ id: 1 }], mixed: false },
  {
    name: 'different equal-length key sets',
    rows: [
      { id: 1, a: 0 },
      { id: 2, b: 0 },
    ],
    mixed: true,
  },
  {
    name: 'late change in presence',
    rows: [{ id: 1 }, { id: 2 }, { id: 3, n: null }],
    mixed: true,
  },
])('selects parser block settings for $name', async ({ rows, mixed }) => {
  // Exercise the backend directly so object key order is not normalized by encoding.
  await createClickHouseBackend({ clickhouse_settings: { max_insert_block_size: '1024' } }).insert({
    table: 'defaults',
    columns: ['id', 'a', 'b', 'n'],
    rows,
  });

  expect(driver.insert).toHaveBeenCalledTimes(1);

  const request = driver.insert.mock.calls[0]![0] as {
    clickhouse_settings: Record<string, unknown>;
    values: unknown[];
    columns: string[];
  };

  expect(request.values).toEqual(rows);
  expect(request.columns).toEqual(['`id`', '`a`', '`b`', '`n`']);

  if (mixed) expect(request.clickhouse_settings.max_insert_block_size).toBe('1');
  else expect(request.clickhouse_settings).not.toHaveProperty('max_insert_block_size');
});

it('standard facade exposes execute and wraps driver failure without retrying', async () => {
  const cause = new Error('connection dropped');
  driver.insert.mockRejectedValueOnce(cause);

  await expect(createClient().execute(source.insertMany([{ id: 1 }]))).rejects.toMatchObject({
    name: 'InsertError',
    table: 'writes',
    cause,
  });

  expect(driver.insert).toHaveBeenCalledTimes(1);
});
