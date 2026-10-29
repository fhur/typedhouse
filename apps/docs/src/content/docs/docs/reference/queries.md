---
title: Query API index
description: Find query builder concepts, executable examples, and generated SQL.
---

The [Query Builder section](/docs/query-builder/overview/) documents each implemented concept on its own page, with a complete TypeScript example and actual generated SQL and parameters.

## table and from

[from](/docs/query-builder/tables/) — describe existing tables and start typed queries.

## where

[where](/docs/query-builder/filtering/) — construct typed predicates without JavaScript comparisons.

## map

[map](/docs/query-builder/projection/) — shape outputs and choose names.

## orderBy, thenBy, limit

[orderBy / thenBy](/docs/query-builder/ordering/) and [limit](/docs/query-builder/limits/) — sort, break ties, and bound results while respecting operation order.

## groupBy and aggregate

[groupBy / aggregate](/docs/query-builder/aggregation/) — compute summaries and filter groups.

## Scan-only ClickHouse modifiers

[final / sample](/docs/query-builder/scan-modifiers/) — apply FINAL and SAMPLE before general query operations.

## Combining and expanding rows

- [join / crossJoin](/docs/query-builder/joins/)
- [unionAll](/docs/query-builder/unions/)
- [arrayJoin / leftArrayJoin](/docs/query-builder/array-expansion/)
- [distinct](/docs/query-builder/distinct/)

## Reuse and subqueries

- [cte](/docs/query-builder/cte-hints/)
- [in / notIn](/docs/query-builder/set-subqueries/)
- [scalar](/docs/query-builder/scalar-subqueries/)

## Explicit preview limits

This is the implemented workspace preview, not complete ClickHouse coverage. Outer joins remain unsupported; union inputs require exact compatible descriptors; CTE hints do not guarantee cached or single evaluation.

Related: [Simplifying Compiler](/docs/compiler/overview/), [parameter and compiler outputs](/docs/reference/parameters/), and [composition tutorial](/docs/tutorials/composition/).
