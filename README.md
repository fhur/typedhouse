# chql

Typed ClickHouse query algebra. Implementation contract: [spec.md](spec.md).
Progress and current tasks: [TODO.md](TODO.md).

## First runnable query (bounded preview)

`from(table).where(...).map(...).limit(n, offset?)` now runs through the permanent
naive compiler and `client.run`. This is not full v1: only column/parameter/equality
expressions compile in this checkpoint. Other expressions/operators fail explicitly.
The client currently decodes String, UInt64, DateTime64(0–3), Nullable and
LowCardinality wrappers; all other mappings are explicitly unsupported (not passed
through as typed values). Full catalog, joins, optimizations, streaming, other
mappings and Part 4 backend plugins remain backlog.

Against a ClickHouse database with the fixture's `entity_ots_component` schema:

```sh
CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=default \
  CLICKHOUSE_PASSWORD='' CLICKHOUSE_DATABASE=default pnpm example:first-query
```

[`examples/first-query.ts`](examples/first-query.ts) imports the checked-in generated
fixture schema, prints `q.toSQL()`, runs the query, and always closes the client.
The mandatory Docker integration test executes this exact command with fixture rows.
To generate descriptors for your own database, build first, then run:

```sh
pnpm build
node packages/codegen/dist/cli.js generate --url http://localhost:8123 \
  --database analytics --out-dir examples/generated
```

Credentials can come from `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`. Change the example's
schema import to `./generated/schema.js` and set `CLICKHOUSE_DATABASE=analytics`.
Your table must have the demo columns; adjust the projection for another schema.

Core intentionally has no compiler dependency. Explicitly initialize `toSQL()` with
`registerCompiler(emitNaive)` (`registerCompiler` from `@chql/core`, `emitNaive` from
`@chql/compiler`). `createClient` from `@chql/client` compiles independently and
memoizes plans/decoders by IR identity. `run` forces ISO date output, quoted 64-bit
integers and quoted non-finite floats; errors retain SQL, params, cause and the root
node (fine-grained server attribution remains backlog). Always `await client.close()`.
Rows and graph nodes are immutable. Named Tuple descriptors survive projections;
selecting such tuples currently requires a later decoder checkpoint.

Date parameters are instants, not local wall times. The library serializes supported
DateTime64(0–3) values as UTC text, truncating to the descriptor's precision, and
uses an explicitly UTC-typed placeholder (including Nullable wrappers). The sibling
column descriptor and Param identity remain unchanged. This deliberately resolves
the spec tension between sibling-timezone placeholders and mandated UTC strings:
parsing UTC text in the sibling/server timezone would change the instant. NULL
still emits SQL NULL; equality with NULL retains SQL's unknown/drop behavior.

## Development

Node.js 20+ and Corepack are required. Integration tests require Docker and
use `clickhouse/clickhouse-server:24.8`.

```sh
corepack enable
pnpm install
pnpm check:all
```

ESM-only pnpm workspace with strict TypeScript and exact optional properties.

- `packages/core`: dependency-free types, descriptors, expressions and relational IR
- `packages/codegen`: ClickHouse introspection and generation CLI
- `packages/compiler`: validation, rewrites and SQL emission
- `packages/client`: execution, streaming and decoding

Milestones 1–6 are v1 scope. Temporary-table materialization and the incremental
engine (milestones 7–8) are deferred by the specification.
