# @typedhouse/core — type-safe ClickHouse query builder for TypeScript

Build reusable **ClickHouse queries in TypeScript** with inferred result types. Table descriptors give your callbacks typed columns; projections and aggregates decide the row type; every query is an immutable value you can extend for a dashboard, a report or an export without copying SQL strings.

TypedHouse is a query builder, not an ORM: it does not create tables, run migrations or insert data.

```sh
npm install @typedhouse/core @typedhouse/compiler
```

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  { tenant: col.String, category: col.String, id: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const tenantEvents = from(events).where(e => e.tenant.eq('acme'));

const query = tenantEvents
  .where(e => e.category.eq('purchase'))
  .map(e => ({ id: e.id }))
  .orderBy(e => e.id)
  .limit(10);

const { sql, params } = compile(query.ir); // values become {p0:String} parameters
```

- **Typed columns and expressions** for ClickHouse types, including `Nullable`, `LowCardinality`, `Array`, `Tuple`, `Map` and dates.
- **Joins** (`join`, `leftJoin(left, right).on(...)` with nullable right side, `asofJoin(left, right).on(...).asof(...)`), **aggregation**, `ARRAY JOIN`, `DISTINCT`, **unions**, scalar and set **subqueries**, `FINAL`/`SAMPLE`.
- **Typed ClickHouse functions** such as `countIf`, `uniqExact`, `quantile`, `argMax` and `toStartOfWeek`, plus bounded user-defined functions.

Read the [query builder guide](https://fhur.github.io/typedhouse/docs/query-builder/overview/) or try queries in the [browser playground](https://fhur.github.io/typedhouse/playground/).

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
