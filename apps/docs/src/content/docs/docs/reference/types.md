---
title: ClickHouse data types in TypeScript
description: How each ClickHouse type maps to a TypeScript type, what ClickHouse sends over JSON, and the JavaScript precision and time-zone pitfalls to avoid.
---

**API context:** current workspace preview. The JSON behaviour below was checked against ClickHouse 24.8.14.39 with `FORMAT JSONEachRow`; it applies to any HTTP client, including the official `@clickhouse/client`.

Every column descriptor (`col.UInt64`, `col.Nullable(col.String)`, …) carries a ClickHouse type, and TypedHouse derives the TypeScript type of each result row from it. `typedhouse generate` writes the same descriptors from `system.columns`. `@typedhouse/client` then decodes each JSON value into that TypeScript type.

## Type mapping

| ClickHouse | TypeScript | Decoded by `@typedhouse/client` |
| --- | --- | --- |
| `UInt8`–`UInt32`, `Int8`–`Int32` | `number` | Yes; rejects values outside the type's range |
| `UInt64`, `Int64`, `(U)Int128`, `(U)Int256` | `bigint` | Yes, from the quoted string, without precision loss |
| `Float32`, `Float64` | `number` | Yes, including `NaN`, `Infinity` and `-Infinity` |
| `Bool` | `boolean` | Yes |
| `String`, `FixedString(n)` | `string` | Yes |
| `Date` | `Date` | Yes, as UTC midnight |
| `DateTime`, `DateTime('tz')` | `Date` | Yes, from an ISO 8601 UTC string |
| `DateTime64(p)`, p ≤ 3 | `Date` | Yes, with millisecond precision |
| `DateTime64(p)`, p > 3 | `string` | Not yet |
| `Date32` | `Date` | Not yet |
| `Decimal(p, s)` | `Decimal<p, s>` (a branded `string`) | Not yet |
| `Enum8`, `Enum16` | union of the value names | Not yet |
| `UUID`, `IPv4`, `IPv6` | branded `string` | Not yet |
| `Nullable(T)` | `T \| null` | When `T` is |
| `LowCardinality(T)` | same as `T` | When `T` is |
| `Array(T)` | `T[]` | When `T` is |
| `Tuple(T1, T2)` | `readonly [T1, T2]` | When each item is |
| `Tuple(a T1, b T2)` | `{ a: T1; b: T2 }` | When each item is |
| `Map(K, V)` | `Record<K, V>` for string-like keys, else `Array<[K, V]>` | Not yet |
| `SimpleAggregateFunction(f, T)` | same as `T` | Not yet |
| `AggregateFunction(f, …)` | `AggregateState<'f'>` (opaque) | Not selectable raw; use the `-Merge` function |
| `JSON`, `Variant`, `Dynamic` | `unknown` | Not yet |

A query whose **output** contains a type the client cannot decode yet fails before anything is sent to the server, with `decode_unsupported: <type>`. It is not a `QueryError`. Columns you do not return are not decoded, so leave such a column out of the final `map` to query the rest of the table.

## What ClickHouse sends over JSON

Most bugs come from the wire, not from the type mapping. With default settings, `JSONEachRow` sends:

| Value | ClickHouse default output | What goes wrong in JavaScript | Setting that fixes it |
| --- | --- | --- | --- |
| `UInt64` `18446744073709551615` | `"18446744073709551615"` (a string) | Code that expects a `number` gets a `string`. Unquoted, `JSON.parse` would round it to `18446744073709552000` | Keep `output_format_json_quote_64bit_integers = 1` (the default) and convert with `BigInt()` |
| `0/0`, `1/0` in a `Float64` | `null` | A non-`Nullable` column arrives as `null`, indistinguishable from a missing value | `output_format_json_quote_denormals = 1` sends `"nan"` (or `"-nan"`), `"inf"`, `"-inf"` |
| `DateTime('Europe/Berlin')` `2026-10-27 12:00:00` | `"2026-10-27 12:00:00"` (wall-clock time in the column's time zone, no offset) | `new Date(…)` parses it as the **process's** local time; in a New York process the instant is 5 hours off | `date_time_output_format = 'iso'` sends `"2026-10-27T11:00:00Z"` |
| `DateTime64(6)` `12:00:00.123456` | `"2026-10-27 12:00:00.123456"` | A `Date` keeps only milliseconds | Keep the string, or reduce precision in SQL |
| `Decimal64(4)` `12345678901234.5678` | `12345678901234.5678` (an unquoted number) | `JSON.parse` rounds it to `12345678901234.568` | `output_format_json_quote_decimals = 1` sends `"12345678901234.5678"` |
| `Tuple(name String, n UInt8)` | `{"name":"x","n":1}` | Fine; an unnamed tuple arrives as an array | `output_format_json_named_tuples_as_objects = 1` (the default) |

`@typedhouse/client` sends `date_time_output_format = 'iso'`, `output_format_json_quote_64bit_integers = 1`, `output_format_json_quote_denormals = 1` and `output_format_json_quote_decimals = 1` with every query, so the 64-bit, NaN, time-zone and Decimal problems above cannot happen there. If you use `@clickhouse/client` directly, pass the same values in `clickhouse_settings`.

## Nullable columns and outer joins

ClickHouse does not return `NULL` for the unmatched side of a `LEFT`, `RIGHT` or `FULL` join unless `join_use_nulls = 1`; by default it fills type defaults (`0`, `''`, `1970-01-01`). TypedHouse appends `SETTINGS join_use_nulls = 1` to any query with an outer join and makes the null-extended side's columns `T | null`. `Array`, `Map`, `Tuple` and `JSON` columns cannot be `Nullable` in ClickHouse, so they still arrive as empty defaults on unmatched rows. See [Joins](/docs/query-builder/joins/) for the full rules.

## Values you pass in

JavaScript values in expressions become typed server-side parameters (`{p0:String}`), never inlined SQL; the parameter type follows the column the value is compared with. See [Parameters and compiler outputs](/docs/reference/parameters/).
