---
title: Inserts
description: Build typed bulk insert commands and execute them explicitly on a server.
---

`from(table).insertMany(rows)` builds an inert `InsertCommand`. `client.execute(command)` writes it using the official ClickHouse driver's bulk insert API. This is a bounded write API, not support for every ClickHouse type or an ORM.

## Complete server-side example

Install `@typedhouse/core` and `@typedhouse/client`. Provision the following table separately in ClickHouse; TypedHouse does not execute DDL:

```sql
CREATE TABLE events (
  id UInt32,
  category String DEFAULT 'uncategorized',
  note Nullable(String)
) ENGINE = MergeTree ORDER BY id;
```

The descriptor below describes that existing table, including its `DEFAULT` metadata; `table()` does not create it. Keep the descriptor synchronized with the live schema. Run it only in a server application, never a browser bundle or the playground.

```ts typecheck-only
import {
  col,
  from,
  table,
  type InsertRow,
} from '@typedhouse/core';
import { createClient } from '@typedhouse/client';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
    note: col.Nullable(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
    columnMetadata: {
      category: { defaultKind: 'DEFAULT' },
    },
  },
);

const rows: readonly InsertRow<typeof events>[] = [
  { id: 1, note: null },
  { id: 2, note: 'imported' },
];
const command = from(events).insertMany(rows);

const client = createClient({
  url:
    process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
});
try {
  await client.execute(command);
} finally {
  await client.close();
}
```

Both rows omit `category`, so ClickHouse evaluates its default. The nullable `note` is still required.

## Commands versus queries

- `insertMany` is available only directly on `from(table)`, not after `where`, `map`, `final`, `sample`, joins, or other read operations.
- A command has no read operators, relational IR, or `toSQL()`. Do not pass it to the SELECT compiler.
- `run` and `stream` remain read-only and reject commands at compile time; `execute` rejects SELECT queries. `execute` returns `Promise<void>`, not rows or an affected-row count.
- Construction performs no I/O and snapshots the descriptor and values, including nested arrays, records, and `Date` objects. Later mutation of your inputs does not change the command.
- `insertMany([])` followed by `execute` is a successful no-op, with no network request, even on a backend without insert support.

The standard backend sends safely quoted identifiers and a `JSONEachRow` data payload, not interpolated values or SELECT `{p:Type}` parameters. Streaming inputs, insert-from-select, conflict handling, updates, deletes, and DDL are not supported.

## Writable columns and defaults

`InsertRow<typeof events>` describes the writable input, not the SELECT result. Columns without a definite `defaultKind: 'DEFAULT'` are required. Preserve literal metadata through `table()` or codegen; widened metadata does not make fields optional.

`ALIAS`, `MATERIALIZED`, hidden, and unknown columns cannot be supplied, including as extra properties on inferred row variables. Generated descriptors retain column metadata; generated **columns** are not writable merely because they appear in a read result.

| Input | Meaning |
| --- | --- |
| Omitted property | Allowed only for a declared `DEFAULT`; the server evaluates it. |
| Explicit `null` | Allowed only by `Nullable`; stays null, never replaced by a default. |
| Explicit `undefined` | Invalid, even for a defaulted or nullable column. |
| Supplied value | Validated and preserved rather than replaced by a default. |

Rows may omit different defaulted columns. **ClickHouse 24.8 performance caveat:** the standard backend sets `max_insert_block_size=1` for mixed column-presence batches to preserve dependent defaults and supplied sibling values. This keeps one request but forces one-row parser blocks and can substantially reduce bulk throughput. Batches with the same supplied column set use normal block sizes, including when every row omits the same columns; object key order does not matter.

## Supported input types

Read support does not imply insert support. Validation does not silently coerce values.

| ClickHouse descriptor | Accepted input and policy |
| --- | --- |
| Int/UInt8, 16, 32 | Integral `number` within the declared signed/unsigned range. |
| Int/UInt64, 128, 256 | `bigint` within the declared range; encoded as decimal strings. |
| Float32 / Float64 | Finite `number`; Float32 also requires magnitude at most `3.4028234663852886e38`. |
| Bool / String | `boolean` / `string`, respectively. |
| UUID | Canonical hyphenated hexadecimal string, case-insensitive. |
| Enum8 / Enum16 | Only declared string labels, not numeric codes. Labels and codes must be unique, with codes in the enum's signed integer range. |
| Date | Valid `Date` at exactly UTC midnight, epoch day 0 through 65535 inclusive; encoded as `YYYY-MM-DD`. |
| Date32 | Valid `Date` at exactly UTC midnight, 1900-01-01 through 2299-12-31 inclusive; encoded as `YYYY-MM-DD`. |
| DateTime, including timezone descriptors | Valid whole-second `Date`, epoch second 0 through 4294967295 inclusive; encoded as epoch seconds. |
| DateTime64(p), p = 0..3 | Valid `Date` in [1900-01-01, 2300-01-01), exactly aligned to the declared precision; encoded as UTC ISO text. No rounding, truncation, local-time reinterpretation, or high-precision string input. |
| Decimal(p,s) | Existing branded decimal string type; precision 1..76, scale 0..p. Plain decimal notation with optional minus, no plus or exponent; at most s fractional digits and p−s significant integer digits. Preserved without floating-point conversion or rounding. |
| Nullable / LowCardinality | Recurse through supported descriptors; Nullable additionally accepts `null`. |
| Array | Dense arrays of supported values. |
| Positional Tuple | Exact-length arrays of supported values. |
| Fully named Tuple | Exact-key plain records of supported values; names must be unique. Mixed named/unnamed tuples are unsupported. |

**Unsupported:** FixedString, IPv4, IPv6, JSON, Nothing, Map, Nested, Variant, Dynamic, aggregate-function descriptors, Unknown, and DateTime64 precision above 3. These remain unsupported inside wrappers and containers, even for `null` or empty arrays. Erased/widened descriptors fail closed for supplied values. An unsupported column with a definite `DEFAULT` may be omitted; a required unsupported column prevents non-empty inserts.

Use plain records, dense arrays, and ordinary `Date` objects. Cycles, accessors, symbols, functions, decorated dates, and arbitrary class instances are not supported; serialization hooks are not invoked to coerce them.

## Validation, backends, and failures

Structural checks happen during command construction in core: invalid row shapes, missing or non-writable columns, unsupported supplied descriptors, and unsafe snapshot values throw ordinary `Error`s (for example, `missing_insert_column` or `invalid_insert_value`). Do not expect every invalid input to reach client validation.

At execution, the client validates and encodes the **entire batch before sending any rows**. Client-side `InsertValidationError` exposes `code`, `table`, and, when available, zero-based `row` and `path`; its message does not include input values. Numeric ranges, date alignment, and enum membership are checked here.

The `Backend.insert` capability is optional. `createClientFromBackend(backend)` exposes `execute`, but a valid non-empty batch on a read-only backend throws `UnsupportedOperationError`. The standard ClickHouse backend supports inserts independently of its SELECT compilation mode. Injected backends remain caller-owned; that facade has no `close()` method.

Backend write failures become `InsertError`, retaining the target `table` and original `cause`, not a SELECT `QueryError`. **The write outcome may be unknown.** There are no library-managed retries, transactions, exactly-once guarantees, or automatic deduplication. Re-executing a command issues another insert and may duplicate rows; do not blindly retry a failed write.

Related: [Getting started](/docs/getting-started/) and [Query API index](/docs/reference/queries/).
