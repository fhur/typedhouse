# @typedhouse/compiler — TypedHouse queries to ClickHouse SQL

Compiles queries built with [`@typedhouse/core`](https://www.npmjs.com/package/@typedhouse/core) into **flat, parameterized ClickHouse SQL**. Inspect the SQL and parameters before you run anything — no database connection needed.

```sh
npm install @typedhouse/core @typedhouse/compiler
```

```ts
import { compile } from '@typedhouse/compiler';

const { sql, params } = compile(query.ir);
```

- **Safe by construction:** every JavaScript value becomes a typed `{pN:Type}` placeholder; identifiers are always quoted.
- **Readable output:** nested query steps are flattened into as few `SELECT` blocks as possible.
- **Optimizing rewrites:** merged filters and projections, filter push-down through projections, joins, `ARRAY JOIN`, aggregates and unions, column pruning, and shared subqueries emitted once as CTEs. Optimized SQL is differentially tested against a naive reference emitter on a real ClickHouse server.

Each rewrite is explained with before/after SQL in the [simplifying compiler docs](https://fhur.github.io/typedhouse/docs/compiler/overview/).

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
