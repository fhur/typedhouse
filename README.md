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
`from(table)` returns a descriptor-preserving `TableQuery` with chainable
`.final()` and `.sample(fraction)`; other operators drop these scan-only methods.
SAMPLE accepts finite fractions in `(0, 1]` and emits inline after FINAL, without
expression parameters. The fixture has no sampling key, so SAMPLE is SQL-only.
Use FINAL on a suitable engine (e.g. ReplacingMergeTree) to deduplicate on reads.
`q.arrayJoin(r => r.ids, 'item')` keeps original columns and emits one row per
array element, including duplicates. `.leftArrayJoin(...)` also keeps empty-array
rows, using ClickHouse child defaults (`''`, `0n`, `null` for nullable children,
recursive tuple defaults), **not** nullable widening. Aliases cannot overwrite
existing columns. Sequential expansions are nested operations; limit before
expansion selects input rows, whereas limit after expansion selects expanded rows.
Literal aliases retain exact child types. Union and template-pattern aliases expose
optional additional fields (only one exists at runtime); patterned indexes also admit
matching source values. Widened `string` aliases retain known source
fields and expose possibly absent dynamic keys whose values include source and
child types. Narrow/check dynamic keys before use; runtime collisions still fail.
`join({ a: queryA, b: queryB, ... }).on(r => r.a.id.eq(r.b.id))` executes
inner **ALL** joins (duplicates retained). An array of predicates supplies multiple
keys; additional non-equality predicates become Filters above the join. Include
tenant keys unless both sides are already tenant-scoped. Each input after the first
must have an equality connecting it to an earlier input: disconnected input-order
graphs fail with `join_condition_arity`, never silently become cross joins.
Callbacks expose frozen nested rows; `map(r => ({ ...r.a }))` flattens a side and
retains leaf descriptors. Direct `client.run(joined)` returns nested decoded rows,
including when a join is itself another join's input. Tuple-valued columns remain
expressions, not relational side objects. Filters/order/limit/distinct and grouped
callbacks preserve nested structure. Transport names are collision-free internal
ordinals, never dotted paths. Shared inputs retain IR identity; the naive emitter
repeats them rather than extracting CTEs. ON references use an explicit occurrence
scope (`Join.scope`) so same-input self-joins cannot accidentally bind both sides
to one alias. `crossJoin({ a: queryA, b: queryB, ... })` directly returns a Query
(no `.on` stage), retaining Cartesian multiplicity and returning no rows if any
input is empty. It supports the same nested rows, descriptors and composition.

`unionAll(q1, q2, ...rest)` requires at least two queries with exactly matching
row types and retains duplicates. Branch fields are aligned by complete path to
the first input's explicit order (reversed record insertion order is safe).
Nested join rows, expanded fields and Tuple leaves retain descriptors and proxies;
branch-local sorting/limits/distinct remain inside each branch. Apply global
operators to the returned Query; UNION row order itself is unspecified. Live
capability is the AND of inputs; scan-only and thenBy stages are not retained.
Matching TypeScript rows are not sufficient for SQL compatibility: UInt32 and
Float64 both decode to number, but this increment rejects their union explicitly
with `union_descriptor_mismatch`. Automatic common-type/coercion support remains backlog.
Use explicit alignment instead (import `cast`, `col`, `unionAll` from `@chql/core`):
```ts
const aligned = unionAll(
  integers.map(r => ({ value: cast(r.value, col.Float64) })),
  floats.map(r => ({ value: r.value })),
);
```
`cast(expr, col.X)` emits SQL CAST, unlike `.as(col.X)` (a declaration only).
It supports numeric integers/floats, String and Bool operands/targets, optionally
Nullable, retaining root names, modes and original Params. Nullable operands
require Nullable targets: nullable removal is rejected, so both values of the
server's `cast_keep_nullable` setting produce truthful descriptors. Other type
families (including Decimal, dates, LowCardinality and containers) are rejected.
Invalid String conversions remain server errors wrapped in QueryError; casts do
not substitute defaults or promise lossless/range-checked numeric conversion.
Casts compose with grouping, aggregates, sorting, scalar/IN queries and run/stream.

The naive compiler also supports low-level `Union { all: false }` with explicit
UNION DISTINCT; no public intersect/except APIs are implied.

`componentParts.materialize()` is a composable v1 **ordinary CTE hint**. It retains
nested/expanded rows, descriptors and capabilities, but drops scan/thenBy stages
and direct-aggregate scalar evidence. Filters, projections, grouping, ordering,
limits, unions and membership can compose around it. `emitNaive` (also `compile`)
logs `materialization is not yet implemented` to `console.warn` once per distinct
Materialize node per successful compilation, not per repeated occurrence. Invalid
compilations do not warn. The client's existing identity memoization means repeated
runs reuse compilation; explicit `toSQL()` calls compile and warn again. Local WITH
boundaries preserve input operations; ClickHouse may inline and evaluate each use
repeatedly. This does **not** promise cached rows, one evaluation, temporary tables,
or automatic shared-parent CTE extraction (the latter remains M4; real materialization
is deferred M7). See `examples/first-query.ts` for executable composition.

Mean metrics over a caller-selected history window:
```ts
import { from, avg, avgIf } from '@chql/core';
const since = new Date('2026-01-01T00:00:00Z');
const until = new Date('2027-01-01T00:00:00Z');
const history = from(db.metric_group_ots_component_market_availability).final()
  .where(a => a.tenantId.eq('acme'))
  .where(a => a.effectiveAt.ge(since).and(a.effectiveAt.lt(until)))
  .groupBy(a => ({ entityId: a.entityId }))
  .aggregate(g => ({ stock: avg(g.market_stock_total),
    leadDays: avg(g.market_lead_time_p50_days),
    positiveStock: avgIf(g.market_stock_total, g.market_stock_total.gt(0)) }))
  .orderBy(r => r.stock.desc());
console.log(await client.run(history));
for await (const row of client.stream(history)) console.log(row);
```
`avg`/`avgIf` accept closed integer/float descriptors, optionally Nullable,
returning Float64/Nullable(Float64). NULL values are skipped; false or NULL
predicates exclude rows without making a non-null value's result nullable.
Empty/no-match non-null aggregates return **NaN**, not NULL or zero; nullable
inputs return NULL when no non-null values qualify. Empty grouped input yields
no rows. Non-finite values remain NaN/±Infinity through run and stream.
Means use Float64: wide integers can lose precision (9007199254740993 becomes
9007199254740992), and floating accumulation is not exact decimal arithmetic.
Decimal, Bool, String, wrappers and containers are rejected; State/Merge are
not exposed. Aligned means compose with UNION ALL and bounded global scalar
queries (scalar remains Nullable).
`pnpm example:first-query` runs the analogous indices history and weekly queries.

Weekly stock/lead-time history (Sunday-start weeks, not ISO/Monday):
```ts
import { quantile } from '@chql/core';
const weekly = from(db.metric_group_ots_component_market_availability).final()
  .where(a => a.tenantId.eq('acme')).where(a => a.entityId.eq('cmp_7'))
  .groupBy(a => ({ week: a.effectiveAt.toStartOfWeek() }))
  .aggregate(g => ({ stock: avg(g.market_stock_total), leadDays: quantile(0.5)(g.market_lead_time_p50_days) }))
  .where(r => r.week.ge(new Date('2026-01-04T00:00:00Z')))
  .orderBy(r => r.week);
console.log(await client.run(weekly));
for await (const row of client.stream(weekly)) console.log(row);
```
The generated zero-argument method supports retained Date/DateTime64(0–3)
(and Nullable) descriptors only. It preserves root names and row/grouped/aggregate
modes; NULL produces NULL. Bucketing uses the input column's calendar timezone
(or the server/session timezone for unzoned columns). DateTime64 JS parameters
still represent UTC instants and use UTC wire descriptors, so a standalone
parameter buckets in UTC. Returned Date days decode to **UTC midnight**, not a
midnight instant in the source timezone.

On pinned 24.8, native DateTime64 week results change from Date to Date32 with
`enable_extended_results_for_datetime_functions`. Queries containing this method
explicitly emit `SETTINGS enable_extended_results_for_datetime_functions = 1`,
bucket through Date32 with mode 0, check the result range, then normalize to Date.
Other queries do not acquire this setting. A week before 1970-01-01 or after
2149-06-06 raises `chql_date_out_of_range` instead of silently wrapping/clamping;
notably 1970-01-01–03 belong to an unsupported pre-epoch Sunday week.
Date wire strings must be valid canonical YYYY-MM-DD within 1970-01-01–2149-06-06.
Date parameters use the UTC calendar day of a valid JS Date (time-of-day discarded),
with the same range validation, including Array elements. Invalid wire calendar
days are rejected, never normalized by JavaScript. Date32/DateTime/high-precision
bucketing remain unsupported; this is not full
temporal-catalog acceptance.

`quantile(level)(value)` and `quantileIf(level)(value, predicate)` accept finite
numeric levels in [0, 1], emitted as Float64 parameters (never inlined). Inputs
are closed integer/float descriptors, optionally Nullable; results are Float64
or Nullable(Float64). NULL and NaN values are skipped; empty/no-match non-null
inputs yield NaN, nullable empty/all-null inputs yield NULL (all-NaN nullable
inputs still yield NaN). False/NULL predicates exclude rows.
Infinity can propagate or interpolate to NaN; wide integers can lose precision.
This is ClickHouse's approximate, nondeterministic reservoir quantile, not
quantileExact; separate executions need not agree on large inputs. Small finite
fixtures below the reservoir capacity use interpolation (0/1 select endpoints).
Each application of a curried helper creates a fresh level Param; reusing its
resulting aggregate expression shares that Param. Equal constructions are not
merged by value. State/Merge, other parametric/user aggregate execution and
broader descriptors remain unsupported.

Latest metric values do not require a self-join:
```ts
import { from, max, argMax } from '@chql/core';
const latestMetrics = from(db.metric_group_ots_component_indices).final()
  .where(i => i.tenantId.eq('acme'))
  .groupBy(i => ({ entityId: i.entityId }))
  .aggregate(g => ({
    version: max(g.version),
    stockIndex: argMax(g.stock_index, g.version),
    leadDays: argMax(g.lead_time_max_days, g.version),
  })).orderBy(r => r.entityId);
console.log(await client.run(latestMetrics));
for await (const row of client.stream(latestMetrics)) console.log(row);
```
`argMax(value, version)` and `argMaxIf(value, version, predicate)` retain the value
operand's descriptor and name (constant-first expressions use `argMax`, not the
version/predicate name). Supported values are integer/float, String and Bool,
optionally Nullable; versions must be non-null integer/float descriptors.
LowCardinality, Decimal, dates, containers and nullable versions are rejected.
ClickHouse 24.8 **skips NULL values**: each metric can come from a different older
row even though `max(version)` reports the newest version. All-null or empty
Nullable inputs return NULL; non-null empty/no-match inputs return the type's
default (0, false or empty string). If predicates exclude false/NULL rows.
Different values tied at the maximal version have **no stable tie breaker**;
FINAL deduplicates sorting keys but does not resolve remaining version ties.
Aligned aggregate outputs compose with UNION ALL, downstream filter/order/limit
and bounded global scalar queries (whose descriptor remains Nullable).
No argMax State/Merge helpers are exported in this bounded slice. The runnable
`pnpm example:first-query` demonstrates this against the generated fixture tables.

`scalar(q.aggregate(g => sum(g.stock)))` now embeds a directly built keyless,
exactly-one-column aggregate as a row-mode expression. Object-form names and
single-expression root names are retained. Use it in projections, arithmetic
and predicates; inner references are independently scoped (no correlation).
The naive emitter inlines the SELECT with shared Param identity; CTE extraction
is still backlog. Cardinality-preserving wrappers and arbitrary Queries are
not accepted, and no LIMIT 1 is inserted.
**ClickHouse 24.8 reports Nullable even for scalar count/sum over a guaranteed
one-row aggregate.** The expression therefore has `T | null` and a matching
Nullable descriptor; stock-share arithmetic conservatively returns `number | null`,
not the spec example's `number`. This discrepancy remains explicit rather than
masking it with a default or pretending the descriptor is non-nullable. Current
scalar descriptor support is numeric, String, Bool and Date (optionally Nullable);
containers and other families are rejected pending server evidence.

Generated `expr.in(valuesOrQuery)` / `notIn` accept readonly JS lists or exactly
one flat column from an ordinary Query (including filtered/distinct/UNION sets).
No cardinality restriction or LIMIT 1 is imposed. Examples:
```ts
components.where(c => c.entityId.in(cIndices.map(i => i.entityId)))
parts.aggregate(g => ({ eol: countIf(g.lifecycleStatus.in(['EOL', 'Obsolete'])) }))
```
Numeric, bigint, String, Bool and Date descriptors (optionally Nullable) are supported;
other families and container membership are explicitly rejected. Lists use
`Array(<non-null receiver type>)`: NULL list elements and Expr-valued lists are
not supported. Nullable set columns are supported. On pinned ClickHouse 24.8,
NULL receivers produce NULL for both IN and NOT IN, even against an empty set;
non-NULL receivers do not match NULL set entries. Results are boolean, nullable
only when the receiver is nullable (Bool decoder accepts the server UInt8).
Duplicates do not multiply rows. Inner queries are independently scoped, inline,
and share the outer Param allocator; correlation and shared CTE extraction remain
unsupported. Names and grouped modes survive membership (including countIf).

Select weeks from a tenant/entity-scoped weekly summary (the runnable
`examples/first-query.ts` includes this through both run and stream):
```ts
const selectedWeeks = weekly.where(r => r.stock.ge(20)).map(r => r.week);
const selectedHistory = weekly
  .where(r => r.week.in(unionAll(selectedWeeks, selectedWeeks)))
  .where(r => r.week.in([new Date('2026-10-25T23:00:00Z')]))
  .where(r => r.week.notIn([]))
  .orderBy(r => r.week);
console.log(await client.run(selectedHistory));
```
Date membership requires retained Date/Nullable(Date) descriptors on both the
receiver and Query set; Date32, DateTime, DateTime64 and LowCardinality(Date) are
not interchangeable even when decoded as JS Date. Lists use each Date's UTC
calendar day, discard time-of-day, and reject invalid/out-of-range dates using
the bounds above. Queries containing Date membership explicitly emit
`SETTINGS transform_null_in = 0`: on 24.8, setting it to 1 changes nullable
results from Nullable(UInt8) to UInt8 and allows NULL to match NULL. The emitted
setting preserves the documented NULL behavior even when the client/session
sets 1. Unrelated queries acquire no new setting.
NULL/Expr list elements and temporal coercions remain unsupported.

Select the newest available week without a round trip through application code:
```ts
const newestWeek = scalar(weekly.aggregate(g => max(g.week)));
const newest = weekly.where(r => r.week.eq(newestWeek))
  .map(r => ({ ...r, newestWeek })).orderBy(r => r.week);
console.log(await client.run(newest));
for await (const row of client.stream(newest)) console.log(row);
```
Date scalars require retained Date/Nullable(Date) evidence and a direct keyless,
one-column aggregate; Date32/DateTime/DateTime64 are not interchangeable.
On ClickHouse 24.8 max/maxIf over empty/nonmatching non-null Date inputs returns
1970-01-01, not NULL. Nullable empty/all-null/nonmatching inputs return NULL.
Scalar wrappers always expose Nullable(Date); decoding preserves the server value.
With `aggregate_functions_null_for_empty=1`, empty/nonmatching Date aggregates
return NULL too. This library does not override that aggregate setting or invent
a fallback date. Grouped/arbitrary/LIMIT-1/wrapped scalar queries and correlation
remain unsupported; broader temporal support and the scalar/spec nullability
discrepancy remain backlog.

Outer joins are owner-deferred unresolved v1 backlog, not a blocker for cross
joins or independent features. Two explicit contract issues remain, without silently widened
types: structural TypeScript records do not encode first/last insertion order
(`{ a, b }` and `{ b, a }` have the same type), and ClickHouse 24.8 with
`join_use_nulls=1` still fills unmatched Array/Tuple/Map columns with non-null
defaults. Nullable containers are rejected by the server. Enabled regression
reproductions are in `cross-join.test.ts` and `query.integration.ts`. A decision on
ordered input evidence and structured null-extension representation is required
before the specified outer-join API can honestly promise exact rows.
### Exact String cardinality

`uniqExact(value)` and `uniqExactIf(value, predicate)` accept String/Nullable(String)
grouped expressions or `val` constants; predicates are Bool/Nullable(Bool).
Results retain UInt64 and decode to **bigint**, never nullable. NULL values are
skipped, empty String is a value, and empty/all-null/no-match inputs return `0n`.
False/NULL predicates exclude rows. Pinned ClickHouse 24.8 preserves these values
and UInt64 descriptors with `aggregate_functions_null_for_empty=0` or `1`; no
setting override or client fallback is applied. Empty grouped inputs produce no groups.

```ts
import { uniqExact, uniqExactIf, count } from '@chql/core';
const scoped = components.where(forTenant('acme'));
const categories = scoped.aggregate(g => ({ categories: uniqExact(g.category) }));
const matched = join({ c: scoped.arrayJoin(c => c.matched_part_ids, 'partId'), p: parts })
  .on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)])
  .groupBy(r => ({ category: r.c.category.ifNull('uncategorised') }))
  .aggregate(g => ({ rows: count(), components: uniqExact(g.c.entityId),
    eol: uniqExactIf(g.c.entityId, g.p.lifecycleStatus.eq('EOL')) }))
  .where(r => r.components.gt(0n)).orderBy(r => r.category).limit(10);
console.log(await client.run(categories));
for await (const row of client.stream(matched)) console.log(row);
```

Duplicate matched IDs and duplicate joined part rows increase `rows`, not distinct
component counts. The runnable small example fixture prints categories `1n` and
matched components `[]` (its matched arrays are empty); the enabled multiplicity
fixture asserts visible category `{ rows: 7n, entities: 2n, selected: 2n }` and
uncategorised `{ rows: 1n, entities: 1n, selected: 0n }` against native SQL.
Exact distinct **server memory grows with cardinality**. Client streaming and its
10M-row heap gate do not bound aggregate server memory. Other descriptors,
approximate uniq, multi-argument distinct and State/Merge remain unsupported.

Grouped and global aggregation execute `count`, `sum`, `avg`, `max`, `argMax`, `uniqExact`, `quantile(level)` and their `If`
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
All 26 existing scalar catalog methods execute: IN/NOT IN, six
comparisons, and/or/not, plus/minus/multiply/divide, isNull/isNotNull/ifNull,
length/empty/notEmpty/startsWith, has/hasAny/arrayElement/element. No additional
operators or catalog families are implied; unsupported forms fail explicitly.
The client decodes String/FixedString, Bool, integer widths, floats (including
non-finite values), DateTime64(0–3), recursive Array and named/unnamed Tuple,
Nullable and LowCardinality. Decimal, other dates/high-precision timestamps,
Map, Enum, addresses, opaque states and unknown descriptors remain explicitly
unsupported. Full catalog, outer joins, optimizations and Part 4 backend
plugins remain backlog. M3–M6 and the remaining Part 4 constraints are incomplete;
this preview is not full v1 acceptance. M7–M8 remain deferred.

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

The default `compile` pipeline validates relational IR, lowers it into SELECT blocks,
then emits SQL and allocates parameters. It folds scan → filter → sort → limit
into one SELECT. Blocks reading directly from a physical table omit the internal
table alias and column qualifiers; derived-table and join scopes retain explicit
qualification. Identifiers remain quoted. Consecutive filters combine with AND. Simple same-name column
selections (for example `.map(p => ({ id: p.id, stock: p.stock }))`) fold before
sorting/limiting, including filters on columns omitted by the selection. Repeated
sorts/limits and out-of-order clauses start a derived table. Direct renames and
integer `plus`/`minus`/`multiply` projections with typed operands can fold over a
scan and its filters, provided output aliases do not shadow different physical
columns. Computed projections retain a boundary for subsequent clauses; fallible
expressions, projections after sort/limit, aggregates, joins, DISTINCT and
materialization remain fences. A seeded ClickHouse property test compares rows
and column types across 30 generated datasets/parameter sets and five query shapes;
queries use unique ordering before LIMIT to make comparisons deterministic. `emitNaive` remains
the one-subquery-per-node reference backend. Future logical rewrites belong between
validation and block planning, not in SQL rendering. For now validation reuses the
reference backend (discarding its SQL), and emission retains defensive checks; a
standalone validation visitor is a future performance improvement.

Core intentionally has no compiler dependency. Explicitly initialize `toSQL()` with
`registerCompiler(compile)` (`registerCompiler` from `@chql/core`, `compile` from
`@chql/compiler`). `createClient` from `@chql/client` compiles independently and
memoizes plans/decoders by IR identity. `run` forces ISO date output, quoted 64-bit
integers and quoted non-finite floats; errors retain SQL, params, cause and the root
node (fine-grained server attribution remains backlog). Always `await client.close()`.
`client.stream(q)` lazily compiles and executes on first iteration, sharing the same
plan/decoder cache, parameter transport and output settings as `run`. It yields decoded
rows incrementally from the driver's JSONEachRow batches, without collecting results.
Exhaustion, early `break`, consumer exceptions and read/decode failures release the
response, not the reusable client. Each iterator has its own cursor. The driver has
bounded internal stream buffering; this is not a strict single-network-chunk guarantee.
The enabled Docker test consumes 10,000,000 real `{ id: UInt32 }` rows in an isolated
Node process (`scripts/verify-stream-memory.mjs`), checking count/checksum and sampled
peak `heapUsed < 200_000_000` bytes (every 4096 rows plus a 10ms timer, no forced GC or
baseline subtraction). Fixture population is outside that process. This budget applies
only to this measured workload, not arbitrary row widths or consumer-retained rows.

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
