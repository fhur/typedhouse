---
title: Getting started
description: Understand the query model, compile your first query, and learn where execution and typechecking fit.
---

**Goal:** turn “give me the first ten event IDs for this tenant” into typed, inspectable SQL. Allow about 10 minutes. No database is needed until the optional execution section.

This is guide **1 of 3**. Next, [Simple example](/docs/tutorials/composition/) builds a report and dashboard from one reusable query. [Advanced example](/docs/tutorials/advanced-example/) combines tables and explains how joins, arrays, and duplicates change a result.

## The mental model

Think of TypedHouse as a **recipe for a query**, not an array of fetched rows:

1. A **table descriptor** describes an existing ClickHouse table. It does not create it.
2. A **query** records operations on that table. Each operation returns a new query.
3. The **compiler** turns the recipe into SQL and separate parameter values.
4. The **client** sends it to ClickHouse and decodes the result.

Callbacks such as `e => e.id` receive typed **expressions**, not database values. Use `e.id.eq(42)`, not JavaScript `e.id === 42`: the former describes a SQL comparison; the latter compares JavaScript objects while building the query.

## Install

You need Node.js 20+, pnpm, and TypeScript with `strict: true`. This documentation describes the **current workspace preview**, not a guarantee that every package is published yet.

TypedHouse was formerly typedhouse. Packages still use `@typedhouse/*` to keep existing imports and installations compatible; the `typedhouse` codegen command is unchanged.

If your release is available in your package registry:

```sh
pnpm add @typedhouse/core @typedhouse/compiler
```

For the source preview, clone the repository and build its workspace packages instead:

```sh
git clone https://github.com/fhur/typedhouse.git
cd typedhouse
pnpm install --frozen-lockfile
pnpm --filter @typedhouse/core --filter @typedhouse/compiler build
```

Workspace consumers use `workspace:*` dependencies. You can also [open the playground](/playground/) without installing anything.

## Define and compile

Copy this complete example into a TypeScript module. The small `events` fixture is reused in the next guide. Its `id` is a UInt32; assume IDs are unique within each tenant for deterministic ordering.

```ts
import { col, table, from } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

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

const query = from(events)
  .where((e) => e.tenant.eq('acme'))
  .map((e) => ({ id: e.id }))
  .orderBy((e) => e.id)
  .limit(10);

export default compile(query.ir);
```

Read the chain as a sentence: **start with events → keep this tenant → select the ID → sort → take ten**.

| Step | What changes? |
| --- | --- |
| `from(events)` | Starts a query with all three described columns. No rows are fetched. |
| `where(...)` | Filters rows, without changing their fields. |
| `map(...)` | Selects and names the output fields. Later callbacks can access `id`, not `category`. |
| `orderBy(...)` | Defines which IDs come first. |
| `limit(10)` | Bounds the result, not necessarily the work ClickHouse must do. |

`query.ir` is the compiler's internal query representation. Pass it to `compile`; you do not need to construct or edit it yourself. The default export below is a compiled object with `sql`, `params`, and output metadata—not fetched data.

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`
FROM
  `events`
WHERE
  `tenant` = {p0:String}
ORDER BY
  `id` ASC
LIMIT
  10
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

The compiler combines these steps into one SELECT when doing so preserves their meaning. The value `acme` is separate from the SQL text. Values containing quotes remain data; **parameterization does not enforce authorization**. Your application must choose the tenant from an authorized context.

When executed, the row type is `{ id: number }`. ClickHouse UInt32 decodes to `number`; UInt64 and aggregate counts decode to `bigint`. Do not assume every numeric column is a JavaScript number.

:::tip[Check your understanding]
If you move `limit(10)` before `where`, do you still request the first ten matching events?

**No.** You first select at most ten rows, then discard nonmatching tenants. Operations record meaning in order; they are not an unordered bag of SQL clauses.
:::

## Try it in the browser

Copy the example into the [playground](/playground/), remove the compiler import, and replace `export default compile(query.ir)` with `export default query`. The playground supplies the compiler. Change `'acme'` and notice that the SQL placeholder stays while the parameter changes.

The playground **compiles SQL**, but neither connects to ClickHouse nor performs full TypeScript checking. Run your application's `tsc --noEmit` to catch type errors.

<details>
<summary>Already prefer query.toSQL()?</summary>

Core deliberately has no implicit compiler dependency. Import `registerCompiler` from `@typedhouse/core`, call `registerCompiler(compile)` once, then call `query.toSQL()`. This is an alternative to `compile(query.ir)`, not another required step. Both let you inspect `sql` and `params` before execution.

</details>

## Execute on a server

**Optional:** install `@typedhouse/client` for your server application. Build that package too if working from source. The real ClickHouse table must match the descriptor; compilation does not validate a live database.

Append this to the module above. This example is typechecked but is **not executed** by the docs build.

```ts typecheck-only
import { createClient } from '@typedhouse/client';

const client = createClient({
  url:
    process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
});
try {
  const rows = await client.run(query); // { id: number }[]
  console.log(rows);
} finally {
  await client.close();
}
```

`client.run(query)` compiles independently; it does not require compiler registration. For incremental consumption, use `for await (const row of client.stream(query))` inside the same `try` block instead of `run`. Close the client after consumption, not after each row.

**Never put credentials in the playground or a browser bundle.** The maintained integration target is ClickHouse 24.8. If a query fails on the server, inspect the SQL, parameters, and actual table schema rather than casting away types.

## Refresh your schema

Handwritten descriptors are useful for learning. For an application, generate them from your database so schema changes become visible to TypeScript:

```sh
pnpm --filter @typedhouse/codegen... build
node packages/codegen/dist/cli.js generate --url http://localhost:8123 \
  --database analytics --out-dir examples/generated
pnpm typecheck
```

Run these from the source repository root; credentials can come from `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`. In your application, import generated descriptors and run its own typecheck command.

After renaming `category` to `kind` in the database, regenerate. A query reading `e.category` should stop typechecking. Update it deliberately and review its meaning. **Stale descriptors cannot detect live drift**, and types cannot prove every business rule correct.

## What you now know

You can distinguish a descriptor, a query, compiled SQL, and fetched rows. You know why callback expressions use methods, why operation order matters, and where typechecking and execution belong.

**Next:** [Simple example →](/docs/tutorials/composition/) Reuse this query model to build two outputs without duplicating business rules.
