# @chql/codegen (M2)

```sh
chql generate --url http://localhost:8123 --database analytics --out-dir src/generated
chql check --database analytics --out-dir src/generated
```

`--database` and `--out-dir` are required. URL defaults to `CLICKHOUSE_URL`, then
`http://localhost:8123`; `--user` and `--password` override `CLICKHOUSE_USER` and
`CLICKHOUSE_PASSWORD` (defaults: `default`, empty password). Prefer environment
credentials to avoid shell history. Unknown, duplicate value flags and missing
values fail. Driver errors are redacted. The client is closed on both success and
failure. `check` compares both files without creating/writing files, and exits 1
if either is missing or stale. `--skip-alias` excludes only ALIAS columns.

Introspection uses bound database parameters and server metadata, never parses
DDL. Key expression lists retain expressions and split only at top-level commas.
Views and materialized views are included. Column names, comments, defaults,
positions, sorting/partition/primary keys are retained; no change source is set.

Generated tables/functions are lexically sorted (code-point order), columns by
position. Header hashes are SHA-256 of the UTF-8 body after the header, including
the trailing newline. There are no timestamps. Properties use original names,
with computed `__proto__` keys to prevent prototype mutation. Column comments
are string metadata, not injected source comments. Row exports are `Table0Row`,
`Table1Row`, etc. in sorted table order, avoiding naming collisions; inserting a
table can renumber these aliases. Prefer `Infer<typeof db['table-name']>` for
stable names. The fixture additionally exports `ComponentRow`, `PartRow`, and
`ComponentIndicesRow` as in the spec.

Named tuples use `col.NamedTuple([[name, descriptor], ...])` so SQL positional
order survives integer-like field names (JavaScript object enumeration would
reorder them). Inference remains a named object, including nested array elements.
Existing `col.Tuple({...})` and unnamed `col.Tuple([...])` APIs remain supported;
use ordered entries when original SQL field order matters.

**Staged boundary:** `functions.ts` currently exports `functions`, complete
metadata keyed by function name (`isAggregate`, `deterministic`, `aliasTo`). If
`system.functions.deterministic` is absent, determinism is `null`, never assumed
true. M3 must attach callable `fn` / `agg` wrappers using the real Expr/catalog
implementation and `.as()`; this metadata is not the final v1 callable API.

## Acceptance

`pnpm check:all` builds the executable before real testcontainers integration,
then compiles generated snapshots and hostile-name/type examples in an isolated
consumer resolving the built packages. `CHQL_TYPESCRIPT_VERSION` selects that
consumer's compiler, as in the existing M1 gate. The root compiler matrix still
requires the explicit TypeScript 5.5/current commands documented in TODO.

Snapshots were captured from a real `clickhouse/clickhouse-server:24.8` container
(server 24.8.14.39), using `packages/compiler/test/fixtures/schema.sql`. These are
controlled-fixture data, not production data. The materialized view uses an
explicit target table, avoiding random Atomic-database inner-table UUIDs without
filtering any server metadata. Current capture has 1,560 function records; all
have unknown determinism on that server. Unit tests also exercise the newer
column-present branch with an explicitly identified driver double.

To deliberately refresh snapshots after reviewing a schema/server change:

```sh
pnpm build
CHQL_UPDATE_CODEGEN_SNAPSHOTS=1 pnpm test:codegen-integration
```

Normal acceptance only compares snapshots and never updates them. Seed data,
query execution and callable catalog generation belong to M3, not this batch.
