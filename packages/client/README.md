# @typedhouse/client — typed ClickHouse client for Node.js

`createClient` delegates transport, JSON parsing, streaming, backpressure and cancellation to `@clickhouse/client`. `run` collects rows; `stream` yields rows without collecting the whole result. Both are read-only. `execute` accepts typed bulk insert commands. Both backend modes use the same representation adapter and execution settings.

## Inserts

Build a command with `from(table).insertMany(rows)` from `@typedhouse/core`, then `await client.execute(command)`. Use `InsertRow<typeof table>` for reusable typed rows. Only direct `from(table)` supports inserts; commands have no `toSQL()` and cannot be passed to `run` or `stream`.

Declared `DEFAULT` columns may be omitted; nullable columns still require a value or `null`. Generated/hidden columns are excluded, and only the supported insert type subset is accepted. Inputs are snapshotted at construction and the entire batch is validated before sending. Empty batches are no-ops. Close an owned client in `finally`.

The standard backend uses the driver's bulk insert API. Custom backends may omit the optional insert capability. Writes are not automatically retried: a failure can leave the outcome unknown, and retrying may duplicate rows. Mixed column-presence batches preserve dependent defaults on ClickHouse 24.8 using one-row parser blocks, with a substantial throughput cost.

See the [insert reference](https://fhur.github.io/typedhouse/docs/reference/inserts/) for a complete server-side example, supported types, defaults, and error handling.

## Response policy

Trust the server and the official driver's parsed values rather than validating every ClickHouse value in JavaScript:

- Int64/UInt64 and wider integers become `bigint`.
- Date/Date32 and DateTime/DateTime64 up to millisecond precision become UTC `Date` objects. Higher-precision DateTime64 stays a string.
- Arrays and named/positional tuples recurse through those conversions. Nullable and LowCardinality wrappers are transparent.
- Decimal stays an exact branded string: execution forces `output_format_json_quote_decimals=1`, alongside quoted 64-bit integers, quoted denormals and ISO dates. No Decimal class is involved.
- Maps, JSON, Variant, Dynamic and Unknown values pass through unchanged. Maps retain the very same object, including nested wire values.
- Small integers, strings, UUID/IP strings and Enum strings are not exhaustively validated. Brands/unions describe the server result, not a runtime validation promise. Bool and `nan`/`-nan`/`inf`/`-inf` retain their small compatibility conversions.

Malformed rows, missing columns, invalid conversion inputs and unsupported raw aggregate states still fail. Nested output paths preserve literal keys such as `__proto__` without mutating prototypes. Execution/conversion failures retain `QueryError` SQL, params and best-effort node context; preparation errors occur before execution.

### Breaking Map migration

All Map output types are now `Record<string, unknown>`, independent of the ClickHouse key/value descriptors. Numeric keys are strings, not pair arrays; Int64, Date and nested values inside Maps are **not** converted to bigint/Date. Narrow values explicitly in application code. Codegen and descriptor-derived expression types use this same contract. `canonicalKey` compares Map object contents as wire values, without applying the Map's child descriptors.

## Streaming acceptance

Streaming relies on the official driver's resource management and retains the real 10M-row bounded-memory gate. A separate literal one-HTTP-chunk buffering proof is no longer an acceptance requirement. This does not bound server-side memory. Close iterators before closing an owned backend; injected backends remain caller-owned.

Input parameter serialization is a separate compiler concern and is unchanged by this response policy.

## Install and run queries

Run [TypedHouse](https://fhur.github.io/typedhouse/) queries against **ClickHouse** from a Node.js server and get back **typed, decoded rows** — as an array or as an async-iterator stream. Built on the official [`@clickhouse/client`](https://www.npmjs.com/package/@clickhouse/client).

```sh
npm install @typedhouse/core @typedhouse/compiler @typedhouse/client
```

```ts
import { createClient } from '@typedhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
});

const rows = await client.run(query); // { id: number }[]

for await (const row of client.stream(query)) {
  console.log(row.id); // number
}
```

Values are decoded to the TypeScript types the query builder inferred (for example 64-bit integers as `bigint`), and failures surface as structured `QueryError`s. Server-side only: do not ship ClickHouse credentials to a browser.

Start with the [getting started guide](https://fhur.github.io/typedhouse/docs/getting-started/).

## The TypedHouse packages

| Package | Purpose |
| --- | --- |
| [`@typedhouse/core`](https://www.npmjs.com/package/@typedhouse/core) | Type-safe query builder: table descriptors, expressions, joins, aggregation, unions |
| [`@typedhouse/compiler`](https://www.npmjs.com/package/@typedhouse/compiler) | Compiles queries to flat, parameterized ClickHouse SQL |
| [`@typedhouse/client`](https://www.npmjs.com/package/@typedhouse/client) | Runs and streams queries from Node.js with typed rows |
| [`@typedhouse/codegen`](https://www.npmjs.com/package/@typedhouse/codegen) | Generates table descriptors from a live ClickHouse schema |

[Documentation](https://fhur.github.io/typedhouse/) · [Getting started](https://fhur.github.io/typedhouse/docs/getting-started/) · [Playground](https://fhur.github.io/typedhouse/playground/) · [GitHub](https://github.com/fhur/typedhouse)

> **Status: preview (0.0.x).** Every 0.0.x release may contain breaking changes.

## License

MIT
