---
title: Query Builder
description: Compose typed ClickHouse queries without hiding the SQL they produce.
sidebar:
  order: 0
---

The **Query Builder** lets you express and reuse query logic in TypeScript, with typed columns and explicit relational operations. Its job is to construct a query—not to execute JavaScript callbacks against fetched rows or hide the SQL from you.

Each concept below has a standalone code example and the **final SQL and parameters actually generated** by `compile`. Examples are executed and typechecked against the workspace implementation. The [Simplifying Compiler](/docs/compiler/overview/) may combine operations or move safe filters, so the resulting SQL need not contain a separate SELECT for every builder call.

## Concepts

1. [from](/docs/query-builder/tables/)
2. [where](/docs/query-builder/filtering/)
3. [map](/docs/query-builder/projection/)
4. [groupBy / aggregate](/docs/query-builder/aggregation/)
5. [orderBy / thenBy](/docs/query-builder/ordering/)
6. [limit](/docs/query-builder/limits/)
7. [final / sample](/docs/query-builder/scan-modifiers/)
8. [join / crossJoin](/docs/query-builder/joins/)
9. [unionAll](/docs/query-builder/unions/)
10. [arrayJoin / leftArrayJoin](/docs/query-builder/array-expansion/)
11. [distinct](/docs/query-builder/distinct/)
12. [cte](/docs/query-builder/cte-hints/)
13. [in / notIn](/docs/query-builder/set-subqueries/)
14. [scalar](/docs/query-builder/scalar-subqueries/)

## Composition and execution

Each operation returns a query you can pass around, extend, or reuse without changing the original. Operation order matters: limiting before filtering selects a different subset than filtering before limiting. See the [composition tutorial](/docs/tutorials/composition/) for reuse across application boundaries.

Examples export the result of `compile(query.ir)` so you can inspect SQL without connecting to a database. For `query.toSQL()`, register `compile` with `registerCompiler` from `@chql/core`. To execute a query on a server, use `client.run` or `client.stream`; see [getting started](/docs/getting-started/#execute-on-a-server).

This section documents the implemented workspace preview, not the full language specification. Table descriptors must match your real schema. Typechecking and parameterization do not enforce authorization or make arbitrary raw SQL safe.
