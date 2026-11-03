---
title: ClickHouse data types in TypeScript
description: How each ClickHouse type maps to a TypeScript type, what ClickHouse sends over JSON, and the JavaScript precision and time-zone pitfalls to avoid.
---

This page shows which TypeScript type each ClickHouse type becomes, and how JSON wire settings and JavaScript conversions affect precision, non-finite floats and date-times.

Every column descriptor (`col.UInt64`, `col.Nullable(col.String)`, …) carries a ClickHouse type, and TypedHouse derives the TypeScript type of each result row from it. `typedhouse generate` writes the same descriptors from `system.columns`. `@typedhouse/client` trusts ClickHouse and the official driver's JSON parser, applying only the representation conversions below. It does not exhaustively validate numeric ranges, strings, brands or enum membership.

## Type mapping

| ClickHouse | TypeScript | Result adapter behavior |
| --- | --- | --- |
| `UInt8`–`UInt32`, `Int8`–`Int32` | `number` | Pass-through; no range validation |
| `UInt64`, `Int64`, `(U)Int128`, `(U)Int256` | `bigint` | Converts quoted integer strings, checking the declared range |
| `Float32`, `Float64` | `number` | Accepts finite numbers; converts `nan`/`-nan`, `inf`, `-inf` to `NaN`, `Infinity`, `-Infinity` |
| `Bool` | `boolean` | Accepts booleans and converts `0`/`1` |
| `String`, `FixedString(n)` | `string` | Pass-through |
| `Date`, `Date32` | `Date` | Validates the calendar date and converts to UTC midnight |
| `DateTime`, `DateTime('tz')` | `Date` | Converts an ISO 8601 string with an explicit offset or `Z` |
| `DateTime64(p)`, p ≤ 3 | `Date` | Same conversion, up to millisecond precision |
| `DateTime64(p)`, p > 3 | `string` | Pass-through, preserving sub-millisecond precision |
| `Decimal(p, s)` | `Decimal<p, s>` (a branded `string`) | Pass-through; execution requests quoted decimals, with no Decimal class |
| `Enum8`, `Enum16` | union of the value names | Pass-through; no membership validation |
| `UUID`, `IPv4`, `IPv6` | branded `string` | Pass-through; no format validation |
| `Nullable(T)` | `T \| null` | Preserves `null`; otherwise adapts `T` |
| `LowCardinality(T)` | same as `T` | Adapts `T` |
| `Array(T)` | `T[]` | Requires an array and adapts each item |
| `Tuple(T1, T2)` | `readonly [T1, T2]` | Requires an array of the declared length and adapts each item |
| `Tuple(a T1, b T2)` | `{ a: T1; b: T2 }` | Requires an object with exactly the declared keys and adapts each item |
| `Map(K, V)` | `Record<string, unknown>` | Passes through the same object; stringified keys and nested wire values are not converted |
| `SimpleAggregateFunction(f, T)` | same as `T` | Adapts `T` |
| `AggregateFunction(f, …)` | `AggregateState<'f'>` (opaque) | Unsupported raw; use the `-Merge` function |
| `Nothing` | `never` | Unsupported |
| `JSON`, `Variant`, `Dynamic`, unknown types | `unknown` | Pass-through |

Adapter preparation rejects raw `AggregateFunction` states and `Nothing` with `decode_unsupported: <type>`, including inside wrappers, arrays and tuples. This happens before execution and is not a `QueryError`. Maps are not traversed: even Int64 and Date values inside a Map remain wire values, not `bigint` or `Date`. Columns omitted from the output are not decoded.

Malformed rows, missing output columns, invalid container shapes and invalid inputs to the conversions above still fail; execution/conversion failures carry `QueryError` context. Pass-through types are supported results, not promises of runtime validation.

These are **query result** mappings. Inserts intentionally support a narrower type subset; see the [insert guide](/docs/reference/inserts/) before building write commands.

## What ClickHouse sends over JSON

This section applies to any HTTP client, including the official `@clickhouse/client`. With default settings, `JSONEachRow` sends:

| Value | ClickHouse default output | What goes wrong in JavaScript | Setting that fixes it |
| --- | --- | --- | --- |
| `UInt64` `18446744073709551615` | `"18446744073709551615"` (a string) | Code that expects a `number` gets a `string`. Unquoted, `JSON.parse` would round it to `18446744073709552000` | Keep `output_format_json_quote_64bit_integers = 1` (the default) and convert with `BigInt()` |
| `0/0`, `1/0` in a `Float64` | `null` | A non-`Nullable` column arrives as `null`, indistinguishable from a missing value | `output_format_json_quote_denormals = 1` sends `"nan"` (or `"-nan"`), `"inf"`, `"-inf"` |
| `DateTime('Europe/Berlin')` `2026-10-27 12:00:00` | `"2026-10-27 12:00:00"` (wall-clock time in the column's time zone, no offset) | `new Date(…)` parses it as the **process's** local time; in a New York process the instant is 5 hours off | `date_time_output_format = 'iso'` sends `"2026-10-27T11:00:00Z"` |
| `DateTime64(6)` `12:00:00.123456` | `"2026-10-27 12:00:00.123456"` | A `Date` keeps only milliseconds | Keep the string, or reduce precision in SQL |
| `Decimal64(4)` `12345678901234.5678` | `12345678901234.5678` (an unquoted number) | `JSON.parse` rounds it to `12345678901234.568` | `output_format_json_quote_decimals = 1` sends `"12345678901234.5678"` |
| `Tuple(name String, n UInt8)` | `{"name":"x","n":1}` | Fine; an unnamed tuple arrives as an array | `output_format_json_named_tuples_as_objects = 1` (the default) |

Checked against ClickHouse 24.8.14.39; defaults may differ in other versions.

`@typedhouse/client` sends `date_time_output_format = 'iso'`, `output_format_json_quote_64bit_integers = 1`, `output_format_json_quote_denormals = 1` and `output_format_json_quote_decimals = 1` with every query through its built-in backends. These settings preserve the wire representations needed by the adapter; they do not recursively convert Map values or validate pass-through types. Custom backends must honor the same wire contract. If you use `@clickhouse/client` directly, pass the same values in `clickhouse_settings` and apply the conversions you need; overriding these settings can reintroduce precision or representation problems.

## Nullable columns and outer joins

ClickHouse does not return `NULL` for the unmatched side of a `LEFT`, `RIGHT` or `FULL` join unless `join_use_nulls = 1`; by default it fills type defaults (`0`, `''`, `1970-01-01`). TypedHouse appends `SETTINGS join_use_nulls = 1` to any query with an outer join and makes the null-extended side's columns `T | null`. `Array`, `Map`, `Tuple` and `JSON` columns cannot be `Nullable` in ClickHouse, so they still arrive as empty defaults on unmatched rows. See [Joins](/docs/query-builder/joins/) for the full rules.

## Values you pass in

JavaScript values in expressions become typed server-side parameters (`{p0:String}`), never inlined SQL; the parameter type follows the column the value is compared with. See [Parameters and compiler outputs](/docs/reference/parameters/).

A JavaScript `Date` is an instant, and it is sent as UTC text, then cast to the column's declared type, so neither the server's nor the session's timezone can shift it:

| Column | Sent as | Notes |
| --- | --- | --- |
| `Date` | the UTC calendar day, `2026-11-01` | `1970-01-01` to `2149-06-06` |
| `DateTime`, `DateTime('tz')` | UTC seconds, `2026-11-01 12:34:56` | Milliseconds are floored; instants outside `1970-01-01 00:00:00` to `2106-02-07 06:28:15` UTC fail with `param_incompatible` before the query is sent |
| `DateTime64(p)`, p ≤ 3 | UTC up to milliseconds, `2026-11-01 12:34:56.789` | Truncated to the column's precision |

Pass a `Date`, not a date string: a string is a type error for these columns.

Float values round-trip exactly for everyday magnitudes. Two ClickHouse 24.8 behaviors apply at the edges:

- Its float text parser is not correctly rounded beyond about 10^±22 or for subnormals. Such a value can be stored, and compared in a filter, 1 ULP away from what you sent; `5e-324` becomes `0`. Values between `1e-6` and `1e15` in magnitude, and ordinary decimals such as prices, are exact.
- `MergeTree` tables store `-0` as `0`. TypedHouse inserts keep the sign of zero, and other engines such as `Memory` store it. Query parameters send `-0` as `0`, which compares equal anyway.

A `Float32` reads back as the shortest decimal that identifies it, so `0.1` stays `0.1` rather than `0.10000000149011612`. `Math.fround()` of the value you read is exactly the stored float.
