# @typedhouse/codegen — generate TypeScript types from a ClickHouse schema

Introspect a live **ClickHouse** database and generate **TypeScript table descriptors** for the [TypedHouse](https://fhur.github.io/typedhouse/) query builder. Commit the generated files, then run `typedhouse check` in CI to catch **schema drift** before a renamed or retyped column reaches production.

```sh
npm install --save-dev @typedhouse/codegen
npm install @typedhouse/core
```

## Usage

The CLI command is `typedhouse`.

```sh
typedhouse generate --url http://localhost:8123 --database analytics --out-dir src/generated
typedhouse check --database analytics --out-dir src/generated
```

`--database` and `--out-dir` are required. URL defaults to `CLICKHOUSE_URL`, then
`http://localhost:8123`; `--user` and `--password` override `CLICKHOUSE_USER` and
`CLICKHOUSE_PASSWORD` (defaults: `default`, empty password). Prefer environment
credentials to avoid shell history. Unknown, duplicate value flags and missing
values fail. Driver errors are redacted. The client is closed on both success and
failure. `check` compares both files without creating/writing files, and exits 1
if either is missing or stale. `--skip-alias` excludes only ALIAS columns from the
row type; their names are kept as the descriptor's shadow-only `hiddenColumns`
metadata (`table(name, columns, { ..., hiddenColumns: ["alias_id"] })`), which is
never a row field or select item. MATERIALIZED columns are always declared.

**Descriptor completeness.** A descriptor must list every column the
server resolves by name in a SELECT over the table, or name it in
`hiddenColumns`: under `prefer_column_name_to_alias = 1` an output alias equal to
such a column binds the column (e.g. `count() AS hidden … HAVING hidden > 1` over a
table with `hidden ALIAS …` fails with code 215), and the compiler's alias guards
can only avoid that for names they know. They check declared and hidden names on
every path where the table is read directly: a computed selection, an aggregate
folded onto the table (also through filters, an ARRAY JOIN or plain column
selections), and an aggregate folded onto a join with that table as a side. Generated descriptors always satisfy this.
`check` additionally prints a warning to stderr, per table, naming the live columns
that the existing `schema.ts` neither declares nor hides (for example a column added
after generation); the exit status is decided by the stale comparison exactly as
before. Hand-written descriptors are not checked: list hidden names yourself.

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
stable names.

Named tuples use `col.NamedTuple([[name, descriptor], ...])` so SQL positional
order survives integer-like field names (JavaScript object enumeration would
reorder them). Inference remains a named object, including nested array elements.
Existing `col.Tuple({...})` and unnamed `col.Tuple([...])` APIs remain supported;
use ordered entries when original SQL field order matters.

**Function metadata:** `functions.ts` exports `functions`, metadata keyed by
function name (`isAggregate`, `deterministic`, `aliasTo`). If
`system.functions.deterministic` is absent, determinism is `null`, never assumed
true. This metadata is not a callable API.

## Developing codegen

`pnpm check:all` (in the [repository](https://github.com/fhur/typedhouse)) builds
the CLI, runs it against a real `clickhouse/clickhouse-server:24.8` container, and
compiles the generated snapshots in an isolated consumer that resolves the built
packages. Snapshots come from `packages/compiler/test/fixtures/schema.sql`. To
refresh them deliberately after reviewing a schema or server change:

```sh
pnpm build
TYPEDHOUSE_UPDATE_CODEGEN_SNAPSHOTS=1 pnpm test:codegen-integration
```

Normal runs only compare snapshots and never update them.

## License

MIT
