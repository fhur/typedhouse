# chql

Typed ClickHouse query algebra. Implementation contract: [spec.md](spec.md).
Progress and current tasks: [TODO.md](TODO.md).

## First runnable query (bounded preview)

`from(table).where(...).map(...).limit(n, offset?)` now runs through the permanent
naive compiler and `client.run`. Single-expression `map(r => r.column)` keeps
the root column name; unnamed constants require the object form. `.distinct()`
removes duplicate output rows. `.orderBy(r => r.column)` defaults to ascending;
generated `.asc()`/`.desc()` support immutable `.nullsFirst()`/`.nullsLast()`.
Only ordered queries expose `.thenBy()`; another `.orderBy()` replaces the keys.
Other operators drop `.thenBy()`. Sort and limit retain their written order:
`q.orderBy(r => r.id).limit(10)` selects the first ten sorted rows, whereas
`q.limit(10).orderBy(r => r.id)` sorts only the selected ten.
Grouped and global aggregation execute `count`, `sum`, `max` and their `If`
forms: `q.groupBy(r => r.category).aggregate(() => count())` or
`q.aggregate(g => ({ total: sum(g.amount) }))`. Keys precede aggregate outputs;
object forms choose names, single forms retain root names, and collisions fail.
Grouped stages expose only `aggregate`; callbacks use grouped-mode operands.
Integer sums decode as bigint, floating sums as number, and nullable aggregates
retain null for all-null/empty inputs. `where` after aggregation is an outer
naive filter. State/Merge construction remains available but execution and raw
state selection remain explicitly unsupported. Builder ColumnRefs record row/grouped
provenance; legacy low-level refs without a mode are checked in their contextual
scope (their original wrapper mode cannot be recovered).
All 24 existing scalar catalog methods execute: six
comparisons, and/or/not, plus/minus/multiply/divide, isNull/isNotNull/ifNull,
length/empty/notEmpty/startsWith, has/hasAny/arrayElement/element. No additional
operators or catalog families are implied; unsupported forms fail explicitly.
The client decodes String/FixedString, Bool, integer widths, floats (including
non-finite values), DateTime64(0–3), recursive Array and named/unnamed Tuple,
Nullable and LowCardinality. Decimal, other dates/high-precision timestamps,
Map, Enum, addresses, opaque states and unknown descriptors remain explicitly
unsupported. Full catalog, joins, optimizations, streaming and Part 4 backend
plugins remain backlog.

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
named/unnamed tuples and arrays decode recursively. The executable example also
shows structural filtering, tuple-field extraction and array lengths. Array indices
follow ClickHouse's 1-based/negative-index semantics; non-integer indices are rejected.
Arrays are serialized by the library, including nested nullable/bigint values.
The client transports those preformatted literals via HTTP `param_*` fields rather
than letting the driver's string formatter escape their quotes a second time;
scalar parameters still use `query_params`. No values are interpolated into SQL.

Date parameters are instants, not local wall times. The library serializes supported
DateTime64(0–3) values as UTC text, truncating to the descriptor's precision, and
uses an explicitly UTC-typed placeholder (including Nullable wrappers). The sibling
column descriptor and Param identity remain unchanged. This deliberately resolves
the spec tension between sibling-timezone placeholders and mandated UTC strings:
parsing UTC text in the sibling/server timezone would change the instant.

Typed NULL emits `CAST(NULL AS <resolved type>)`; equality with NULL retains SQL's
unknown/drop behavior. This minimally qualifies the spec's NULL-rendering rule:
bare NULL has type Nullable(Nothing), so `ifNull(NULL, UInt32)` returns UInt32,
whereas an explicitly Nullable(Int32) operand requires Int64 (decoded as bigint).
The cast preserves descriptor evidence without binding or interpolating a value.

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
