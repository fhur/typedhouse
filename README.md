# TypedHouse — Type-safe ClickHouse query builder for TypeScript

**Build reusable ClickHouse queries in TypeScript, infer result types, and inspect the SQL before you run it.** TypedHouse combines a typed query builder, a SQL compiler, schema code generation, and a server-side client for Node.js.

[Documentation](https://fhur.github.io/typedhouse/) · [Getting started](https://fhur.github.io/typedhouse/docs/getting-started/) · [Playground](https://fhur.github.io/typedhouse/playground/) · [API reference](https://fhur.github.io/typedhouse/docs/query-builder/overview/)

> **Status: workspace preview.** The supported API is evolving; this is not a claim of complete ClickHouse support or production readiness.

## Why TypedHouse?

SQL is good at describing a query. Application code often needs to reuse part of that query across a dashboard, a report, and an export—without copying SQL strings or losing track of the result shape.

TypedHouse makes those queries composable TypeScript values:

- **Type-safe query construction:** table descriptors give callbacks typed columns and expressions. Projections and aggregates determine the output row type.
- **Reusable queries:** extend an immutable base query with filters, joins, grouping, ordering, and limits without changing the original.
- **Parameterized ClickHouse SQL:** input values become typed placeholders and separate parameters, not interpolated SQL fragments.
- **Inspectable output:** compile a query without connecting to a database. Review its SQL and parameters before execution.
- **Schema code generation:** introspect ClickHouse tables and generate TypeScript descriptors. Regenerate and typecheck to catch schema changes earlier.
- **Typed execution and streaming:** run queries or consume decoded rows through an async iterator using the Node.js client.

TypedHouse is a **ClickHouse query builder**, not an object-relational mapper (ORM). Table descriptors describe existing tables; they do not create tables, manage migrations, or implement authorization.

## Quick example: TypeScript to ClickHouse SQL

Select the first ten purchase event IDs for one tenant. This complete example compiles locally without a database:

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    tenant: col.String,
    category: col.String,
    id: col.UInt32,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);

// Reuse this tenant-scoped base in other queries.
const tenantEvents = from(events)
  .where(e => e.tenant.eq('acme'));

const query = tenantEvents
  .where(e => e.category.eq('purchase'))
  .map(e => ({ id: e.id }))
  .orderBy(e => e.id)
  .limit(10);

const compiled = compile(query.ir);
console.log(compiled.sql, compiled.params);
export default compiled;
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`
FROM
  `events`
WHERE
  `tenant` = {p0:String}
  AND `category` = {p1:String}
ORDER BY
  `id` ASC
LIMIT
  10
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "purchase"
}
```

<!-- generated-sql:end -->

Executed with the TypedHouse client, this query returns `{ id: number }[]`. `tenantEvents` remains unchanged and can also become a grouped dashboard query or an export.

Callbacks build SQL expressions; they do not process fetched JavaScript rows. For example, `e.id.eq(42)` builds a SQL comparison, while `e.id === 42` is a JavaScript comparison. Operation order matters: filtering before a limit can produce different results from filtering afterward.

**Try it without installing:** open the [ClickHouse query playground](https://fhur.github.io/typedhouse/playground/), paste the example, remove the compiler import, and replace the final three lines with `export default query`. The playground compiles SQL but does not connect to ClickHouse or perform full TypeScript checking.

## Installation and local setup

Requirements: **Node.js 20+**, **pnpm**, ESM, and TypeScript with `strict: true`. Docker is required for integration tests, not for compiling queries.

The current development path is the source workspace:

```sh
git clone https://github.com/fhur/typedhouse.git
cd typedhouse
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @chql/core --filter @chql/compiler --filter @chql/client build
```

Workspace consumers use `workspace:*` dependencies. For releases available in your package registry, the package names are:

```sh
pnpm add @chql/core @chql/compiler
# Optional: execute queries from your Node.js server.
pnpm add @chql/client
```

Registry availability depends on the release you use.

## Execute or stream typed results

Append this to the quick example in a **server-side** TypeScript module. Your ClickHouse table must match the descriptor. This snippet is typechecked but never executed by documentation builds.

```ts typecheck-only
import { createClient } from '@chql/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
});

try {
  const rows = await client.run(query); // { id: number }[]
  console.log(rows);

  // Alternative to run(): consume rows incrementally.
  // This executes a separate query, not a cached copy of rows.
  for await (const row of client.stream(query)) {
    console.log(row.id); // number
  }
} finally {
  await client.close();
}
```

The client compiles queries independently; compiler registration is not required for `run` or `stream`. Streaming avoids collecting the entire result in an application array, but does not bound ClickHouse's server-side memory use.

Keep credentials on the server. Never paste them into the playground or include them in a browser bundle. Parameterization keeps values separate from SQL; your application must still enforce tenant and access rules.

## Generate TypeScript types from your ClickHouse schema

Use schema introspection instead of maintaining table descriptors by hand. From the source repository:

```sh
pnpm --filter @chql/codegen... build
node packages/codegen/dist/cli.js generate \
  --url http://localhost:8123 \
  --database analytics \
  --out-dir examples/generated
```

Credentials can come from `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`. Import the generated schema into your application, then run its TypeScript checks.

After a database column is renamed, regenerate the descriptors: queries using the old field can then fail at typecheck time. Stale descriptors cannot detect live database drift automatically.

[Schema generation reference →](packages/codegen/README.md)

## Supported query-building concepts

| Concept | What you can express | Reference |
| --- | --- | --- |
| Filters and projections | Typed predicates, selected columns, renamed output fields | [Filtering](https://fhur.github.io/typedhouse/docs/query-builder/filtering/) · [Projection](https://fhur.github.io/typedhouse/docs/query-builder/projection/) |
| Sorting and pagination | `orderBy`, `thenBy`, `limit`, and offsets | [Ordering](https://fhur.github.io/typedhouse/docs/query-builder/ordering/) · [Limits](https://fhur.github.io/typedhouse/docs/query-builder/limits/) |
| Aggregation | Grouped and global aggregates such as `count`, `sum`, `avg`, and `argMax` | [Aggregation](https://fhur.github.io/typedhouse/docs/query-builder/aggregation/) |
| Joins | Named inputs, inner ALL joins, and cross joins | [Joins](https://fhur.github.io/typedhouse/docs/query-builder/joins/) |
| Set operations | `unionAll` with compatible descriptors; `distinct` | [Unions](https://fhur.github.io/typedhouse/docs/query-builder/unions/) |
| Subqueries | Single-column membership queries and supported scalar aggregates | [Set subqueries](https://fhur.github.io/typedhouse/docs/query-builder/set-subqueries/) · [Scalar subqueries](https://fhur.github.io/typedhouse/docs/query-builder/scalar-subqueries/) |
| Array expansion | `arrayJoin` and `leftArrayJoin` | [Array expansion](https://fhur.github.io/typedhouse/docs/query-builder/array-expansion/) |
| ClickHouse-specific operations | `FINAL`, `SAMPLE`, and CTE hints with explicit semantics | [Scan modifiers](https://fhur.github.io/typedhouse/docs/query-builder/scan-modifiers/) · [CTEs](https://fhur.github.io/typedhouse/docs/query-builder/cte-hints/) |

These are supported building blocks, not a promise that every ClickHouse type, function, or combination is implemented. Refer to each API's constraints and the [current roadmap](TODO.md).

## Learn TypedHouse in three guides

1. **[Getting started](https://fhur.github.io/typedhouse/docs/getting-started/)** — understand descriptors, query expressions, SQL compilation, and execution.
2. **[Simple example](https://fhur.github.io/typedhouse/docs/tutorials/composition/)** — build a report and dashboard from one reusable query.
3. **[Advanced example](https://fhur.github.io/typedhouse/docs/tutorials/advanced-example/)** — combine tables, expand arrays, and deduplicate before counting.

The guides include typechecked examples, compiler-generated SQL, and exercises that make operation order and result shapes concrete.

## Frequently asked questions

### Is TypedHouse a ClickHouse ORM or a database driver?

Neither is its primary purpose. TypedHouse is a TypeScript query builder and compiler with an optional execution client. It describes queries over existing tables rather than managing entities, relationships, or database migrations.

### Does type-safe mean every query is correct?

No. Types catch supported construction and result-shape mistakes. They do not prove business logic, enforce authorization, detect stale schema descriptors, or guarantee compatibility with every server setting. Review the generated SQL and test against your database.

### Does TypedHouse make ClickHouse queries faster?

There is no blanket performance claim. The compiler simplifies supported query shapes and preserves operation order. Actual performance depends on your schema, data, query, and ClickHouse execution plan. Shared query objects and CTEs are not guaranteed result caches.

### How are ClickHouse numeric types represented in TypeScript?

The client uses descriptors to decode supported types. For example, UInt32 becomes `number`, while UInt64 and `count()` results become `bigint`. Matching JavaScript types do not necessarily mean two ClickHouse descriptors are interchangeable.

### Is TypedHouse an official ClickHouse project?

No. TypedHouse is an independent project and is not affiliated with ClickHouse.

## Development and contributions

This is an ESM-only pnpm workspace using strict TypeScript. The maintained integration target is `clickhouse/clickhouse-server:24.8`.

```sh
pnpm typecheck
pnpm test
pnpm check:all
```

`pnpm check:all` includes builds, package verification, and Docker-backed integration tests. It requires a working Docker installation; see [Testcontainers setup notes](patches/README.md) if the environment check fails.

| Package | Responsibility |
| --- | --- |
| [Core](packages/core) | Dependency-free types, table descriptors, expressions, and relational query representation |
| [Compiler](packages/compiler) | Validation, query rewrites, parameter allocation, and ClickHouse SQL emission |
| [Client](packages/client) | Server-side execution, streaming, and result decoding |
| [Codegen](packages/codegen) | ClickHouse schema introspection and descriptor generation |

Before proposing a change, check the [roadmap](TODO.md) and [implementation contract](spec.md). Bug reports are most useful with a minimal query, expected and actual results, and the ClickHouse version—without credentials or private data.

[Report an issue](https://github.com/fhur/typedhouse/issues) · [Implementation notes](IMPLEMENTATION.md) · [Documentation development](apps/docs/README.md) · [Markdown index for AI coding tools](https://fhur.github.io/typedhouse/llms.txt)
