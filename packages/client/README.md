# @typedhouse/client — typed ClickHouse client for Node.js

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
