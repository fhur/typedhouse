---
title: Parameters and compiler outputs
description: Keep values separate from SQL and inspect the actual compiler result.
---

**API context:** current workspace preview. Use the full `events` fixture and imports from [Getting started](/docs/getting-started/).

## Bind values through expressions

Expression methods accept supported JavaScript values and convert them to typed parameters. For example:

```ts
const userInput = "acme' OR 1=1 --";
const query = from(events).where((e) =>
  e.tenant.eq(userInput),
);
const compiled = query.toSQL();
console.log(compiled.sql, compiled.params);
```

Expected SQL:

```sql
SELECT `tenant`, `category`, `id` FROM (
  SELECT `tenant`, `category`, `id` FROM `events`
) AS `__chql_input` WHERE (`__chql_input`.`tenant` = {p0:String})
```

Expected parameters:

```json
{ "p0": "acme' OR 1=1 --" }
```

The output row remains `{ tenant: string; category: string; id: number }`. The quote characters remain data. Do not interpolate input into SQL or turn it into identifiers. Parameterization is not authorization: the application must establish the tenant value and access rules correctly.

## Compile a query

Core has no implicit compiler dependency. Import `registerCompiler` from `@chql/core` and `emitNaive` from `@chql/compiler`, then call `registerCompiler(emitNaive)` once before `query.toSQL()`.

Alternatively use `emitNaive(query.ir)` or `compile(query.ir)` directly from `@chql/compiler`. The compiler accepts a relational IR node, not a Query wrapper. Both compiler exports currently use the naive backend.

`toSQL(): CompiledQuery` returns:

- `sql: string`: emitted ClickHouse SQL.
- `params: Readonly<Record<string, string>>`: serialized parameter values, separate from SQL.
- `parameterTypes?`: resolved placeholder descriptors used by client transport.
- `columns`: flat output descriptors.
- `columnPaths?`: paths for reconstructing nested output rows.
- `nodes`: relational nodes associated with compilation.

Descriptors are not a complete TypeScript typechecker. `@chql/client` uses the compiled output to decode supported values; use the client rather than assuming every JSON result matches your application type.

## Errors and corrections

- **Compiler not registered:** register it, or use `emitNaive(query.ir)` directly. Importing core alone intentionally does not attach a backend.
- **Invalid predicate or expression mode:** return a core expression from the callback, not a JavaScript boolean, object, or grouped expression in a row context.
- **Unsupported descriptor/function:** use a supported operation; changing a TypeScript assertion does not add compiler or server support.
- **Server-side failure:** compilation is not execution validation. Check real table metadata, engine requirements, supported server version, and the SQL retained by the client's `QueryError`.

The maintained integration target is ClickHouse 24.8. Always typecheck your application and review compiled SQL. The [playground](/playground/) transpiles and compiles but does not perform full TypeScript checking or connect to a server.
