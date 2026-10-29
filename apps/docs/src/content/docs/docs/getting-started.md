---
title: Build your first query
description: Define a table, compose a bounded query, inspect SQL, and execute it outside the browser.
---

This guide targets the current **workspace preview**, not a claim of complete v1 support. You need Node.js 20+, pnpm, and TypeScript with strict checking. You do not need a database to compile SQL.

You will define a descriptor, compose a query, inspect parameters, and optionally execute against your own ClickHouse instance.

## Install

```sh
pnpm add @chql/core @chql/compiler
# Only for server-side execution:
pnpm add @chql/client
```

In the source workspace these packages use `workspace:*`; see the repository README for build and setup. Package availability depends on the release you are using.

## Define and compile

This is the canonical `events` fixture used throughout these docs. `table` describes a table; it does not create it in ClickHouse. The metadata must describe your real schema when executing.

```ts
import {
  col,
  table,
  from,
  registerCompiler,
} from '@chql/core';
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

registerCompiler(compile);
const base = from(events).where((e) => e.tenant.eq('acme'));
const query = base
  .map((e) => ({ id: e.id }))
  .orderBy((e) => e.id)
  .limit(10);

const { sql, params } = query.toSQL();
console.log(sql, params);
```

The output row type is `{ id: number }`. UInt32 decodes to number; this does not imply that all ClickHouse integers do. UInt64, for example, decodes to bigint.

Expected SQL (only whitespace changed for readability):

```sql
SELECT `id`
FROM `events`
WHERE `tenant` = {p0:String}
ORDER BY `id` ASC
LIMIT 10
```

```json
{ "p0": "acme" }
```

The simplifying compiler combines these relational steps into one SELECT and removes unused columns. See [Simplifying Compiler](/docs/compiler/overview/) for each transformation and its safety limits. Filter input is a separate parameter, not interpolated SQL syntax.

## Try it in the browser

[Open the playground](/playground/). Use the same core imports and table definition, omit compiler registration and `toSQL()`, and end with `export default query`. The playground supplies the real compiler. It compiles SQL only; it does not connect to ClickHouse or typecheck your program.

## Execute on a server

Append this to the complete example in a server-side TypeScript module. Never put credentials in the playground or a public client bundle. The real table must match the descriptor.

```ts
import { createClient } from '@chql/client';

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

`client.run` compiles independently; it does not require `registerCompiler`. To consume rows incrementally use `for await (const row of client.stream(query))`. Close the client when finished, not after each streamed row.

## Refresh your schema

From the repository root, generate descriptors for your database:

```sh
pnpm build
node packages/codegen/dist/cli.js generate --url http://localhost:8123 \
  --database analytics --out-dir examples/generated
pnpm typecheck
```

Credentials can come from `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`. Import generated tables from the generated schema module instead of manually duplicating your database schema.

For example, after renaming `category` to `kind` and regenerating the descriptor, `from(events).map(e => e.category)` no longer typechecks. Change the query to the new field and review its meaning. Stale descriptors cannot detect live database drift, and typechecking cannot detect every semantic change. The browser editor is not a substitute for this CI step.

## Common corrections

- **No compiler registered:** call `registerCompiler(compile)` before `toSQL()`, or use `compile(query.ir)` directly.
- **Missing column:** use the callback row's actual fields and refresh generated descriptors. Do not cast away the error.
- **Unexpected first ten rows:** put `orderBy` before `limit`; an unsorted limit has no deterministic row order.
- **Unauthorized rows:** add the correct tenant/access predicate. Parameterization is not authorization.

Next: [reuse a query without changing its meaning](/docs/tutorials/composition/) or inspect the [query API contract](/docs/reference/queries/).
