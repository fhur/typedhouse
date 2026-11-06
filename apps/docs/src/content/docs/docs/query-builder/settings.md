---
title: settings
description: Set resource limits and a query comment with a typed allowlist of ClickHouse settings.
sidebar:
  order: 15.5
---

`settings({ ... })` appends a ClickHouse `SETTINGS` clause to the query. It is always the last step: it applies to the whole query, so its result has no `where`, `limit`, `map` or any other builder method. You can only pass it to `client.run`, `client.stream`, `toSQL()` or `compile(query.ir)`, and it cannot be an input to a join, a union or a subquery.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
    category: col.String,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(events)
  .where((e) => e.tenant.eq('acme'))
  .limit(100)
  .settings({
    max_threads: 2,
    max_execution_time: 1.5,
    log_comment: "acme's report",
  });

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`,
  `category`
FROM
  `events`
WHERE
  `tenant` = {p0:String}
LIMIT
  100
SETTINGS
  max_threads = 2,
  max_execution_time = 1.5,
  log_comment = 'acme\'s report'
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

A query with deterministic results returns the same rows as without `settings`, with the same type. `quantile`, float `sum` and `avg`, `any` and `argMax` ties are not deterministic: their results can vary with `max_threads`, and `quantile`, float `sum` and `any` also vary between repeat runs with no settings at all. That variation comes from those functions, not from `settings`. The clause covers the whole statement in the forms the compiler emits, including CTEs, subqueries and every `UNION ALL` branch.

## Allowed settings

These 12 keys are the only ones accepted.

| Key | Value | What it does |
| --- | --- | --- |
| `max_threads` | integer | Threads used to run the query. `0` lets the server choose. |
| `max_execution_time` | seconds | Time limit for the query. `0` means no limit. |
| `max_memory_usage` | integer | Memory limit in bytes. `0` means no limit. |
| `max_rows_to_read` | integer | Limit on rows read from tables. `0` means no limit. |
| `max_bytes_to_read` | integer | Limit on bytes read from tables. `0` means no limit. |
| `max_result_rows` | integer | Limit on result rows. `0` means no limit. |
| `max_result_bytes` | integer | Limit on uncompressed result bytes. `0` means no limit. |
| `max_block_size` | integer | Rows per block when reading. `0` keeps the server's value. |
| `max_bytes_before_external_group_by` | integer | Memory before `GROUP BY` spills to disk. `0` means never. |
| `max_bytes_before_external_sort` | integer | Memory before `ORDER BY` spills to disk. `0` means never. |
| `priority` | integer | Query priority. A lower number runs first, and `0` means no priority. |
| `log_comment` | string | Text recorded with the query in `system.query_log`. |

Values are checked when you call `settings`, and again when the query compiles:

- **Integer** means a non-negative safe integer or a `bigint` up to `2^64 - 1`. Other numbers are refused because the server would misread them: on 24.8 `1.5` reads back as `1`, `2^64` reads back as `2^63`, and `-1` and `1e21` raise code 70.
- **Seconds** means `0`, or a number from `0.000001` to `9223372036854`. A smaller positive value is refused because the server reads it as `0`, which turns the limit off. Fractions take effect, but the server truncates to whole microseconds through binary floating point, so a value can read back slightly lower: `1.5` reads back as `1.5`, `1.001` as `1.000999`, `2.002` as `2.001999`, and `1.0000001` as `1`.
- **String** means well-formed Unicode. It goes through the same escaper as other SQL string literals, so quotes, backslashes, `*/` and `--` read back unchanged. A very long `log_comment` can exceed the server's `max_query_size` and raise code 62.
- **`undefined`** is refused: leave the key out instead. TypeScript catches this only under `exactOptionalPropertyTypes`, and the runtime check catches it everywhere.

ClickHouse has no query parameters in `SETTINGS`, so these values are literals in the SQL text, like `LIMIT`. They do not appear in `params`.

The server may still adjust a value it accepted. On 24.8 `max_threads` is capped at 4096 and `max_block_size` at 4294967296.

## Why other settings are refused

Many settings change the rows a query returns, or their types, so the row type would stop being true. All of these were measured on 24.8:

| Setting | Effect |
| --- | --- |
| `limit`, `offset` | Rows are dropped. |
| `final` | A count changes from 4 to 2. |
| `aggregate_functions_null_for_empty` | `sum` becomes `Nullable`. |
| `group_by_use_nulls` | A key's type changes. |
| `result_overflow_mode`, `read_overflow_mode`, `timeout_overflow_mode` | `break` returns partial results with no error. |
| `date_time_output_format`, `output_format_json_quote_64bit_integers` | Values stop decoding. These win over the client's own settings. |

An unknown key raises `unknown_setting`. `join_algorithm` is also refused, because which algorithm works depends on the join shape and the server version, and the compiler does not check that. On 24.8 `direct` raises code 48 on joins between ordinary tables, and `partial_merge` and `grace_hash` raise code 48 on an `ASOF` join but work on `INNER`, `LEFT`, `RIGHT` and `FULL`.

Settings the compiler or the client already controls raise `compiler_owned_setting`: `join_use_nulls`, `transform_null_in`, `enable_extended_results_for_datetime_functions`, `date_time_output_format`, `output_format_json_quote_64bit_integers`, `output_format_json_quote_decimals`, `output_format_json_quote_denormals` and `http_write_exception_in_output_format`. The compiler's own settings stay in force and are added after yours.

## Limits raise errors

A limit that is exceeded fails the query with a `QueryError`, whose `cause.code` is the server's code as a string. This holds when the limit is hit after the server has started sending rows. `settings` cannot set the overflow modes, so with the server's default modes a limit never returns partial results. A client or profile that sets `result_overflow_mode` to `break` overrides this: the query then returns a partial result with no error, and its row count is unpredictable.

| Setting | Code |
| --- | --- |
| `max_rows_to_read` | 158 |
| `max_execution_time` | 159 |
| `max_memory_usage` | 241 |
| `max_bytes_to_read` | 307 |
| `max_result_rows`, `max_result_bytes` | 396 |

`client.run` buffers the whole result in memory, so use `client.stream` for large results. `client.run` returns no rows when a limit fails. `client.stream` can yield rows before it throws, because they arrive first. Treat rows you already received as incomplete when it throws.

Server errors, `KILL QUERY` and a server `SIGTERM` (both code 394), a server `SIGKILL` and a dropped connection (`ECONNRESET`) all surface as errors on both. The exception is a proxy that forwards part of the body and then ends the HTTP response cleanly: the client cannot detect that, so `run` and `stream` both end normally with short rows and no error.

Three things to expect:

- **`count()` over a table ignores read limits.** The server answers it from table metadata, so `max_rows_to_read` and `max_bytes_to_read` of 1 do not fail it.
- **The client's `request_timeout` can end a query first.** That is a `QueryError` from the client with no server code, so keep it above `max_execution_time`.
- **`compression: { response: true }` can lose the code.** On 24.3 and 24.8 a failing query can give a damaged gzip body, and the `QueryError` has `cause.code` `Z_DATA_ERROR`: 14 of 140 and 29 of 280 cases in sweeps on those servers, at limits as high as 999,999 rows. On 26.10 a limit can give `ECONNRESET` through the client: 17 of 140 cases, repeatable, cause unknown. In these sweeps the query always failed or returned every row, never a short result.

:::caution[A limit depends on the plan]
The optimizing and naive emissions can read and allocate different amounts, so a limit can fail one and not the other. This is the one named exception to the compiler's [results-only contract](/docs/compiler/select-blocks/): these five codes under a limit you set are not a compiler bug. When the query succeeds, its rows and types are still the same.
:::

## Read-only users

- **`readonly = 1`** refuses every setting change with code 164. The client sends its output settings with every query, so `client.run` and `client.stream` fail for such a user with or without `settings`. SQL from `toSQL()` that you run yourself fails only if it has a `SETTINGS` clause, which includes the `join_use_nulls` the compiler adds to an outer join.
- **`readonly = 2`** accepts the change.

## Rules

- **Where it attaches.** On any query: after `from`, `where`, `map`, `aggregate`, `orderBy`, `limit`, a join or a union. It is a type error on a `groupBy` with no `aggregate` and on the result of `settings`. A hand-built `Settings` node below the root raises `invalid_settings_placement`.
- **Checks still apply.** `from(rollup).settings({ ... })` over a column holding aggregate states raises `aggregate_state_selection`, as it does without `settings`.
- **Order and empties.** Keys print in the order you wrote them. `settings({})` emits no clause.
- **Plans.** The client caches a plan by the query node, so run the same `settings` result again to reuse its plan.
- **Live queries.** A query with `settings` is not live.
