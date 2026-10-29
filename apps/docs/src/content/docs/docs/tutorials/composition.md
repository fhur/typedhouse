---
title: Reuse a query without changing its meaning
description: Build a dashboard, report, and drill-down from one immutable base query.
sidebar:
  order: 1
---

**Context:** current workspace preview. **Prerequisite:** the complete `events` fixture and compiler setup in [Getting started](/docs/getting-started/). **Goal:** reuse a tenant filter and preserve operation order.

## Compose three outputs

Append this to the canonical fixture. `count` is a named export of core; no raw SQL fragments are needed.

```ts
import { count } from '@chql/core';

const tenantEvents = from(events).where((e) =>
  e.tenant.eq('acme'),
);
const dashboard = tenantEvents
  .groupBy((e) => e.category)
  .aggregate(() => ({ total: count() }));
const report = tenantEvents.orderBy((e) => e.id).limit(100);
const drillDown = tenantEvents.where((e) =>
  e.category.eq('purchase'),
);

console.log(dashboard.toSQL());
console.log(report.toSQL());
console.log(drillDown.toSQL());
```

`tenantEvents` remains unchanged. Dashboard rows are `{ category: string; total: bigint }`; report and drill-down retain `{ tenant: string; category: string; id: number }`. The dashboard has one row per category, not one row per event. Empty input produces no grouped rows.

Expected SQL structure, shown schematically rather than as an exact emitted string:

```sql
-- Dashboard
SELECT category, count() AS total FROM (<tenant-filtered input>) GROUP BY category
-- Report
SELECT * FROM (<tenant-filtered input> ORDER BY id ASC) LIMIT 100
-- Drill-down
SELECT * FROM (<tenant-filtered input>) WHERE category = {p1:String}
```

Dashboard and report parameters are `{ "p0": "acme" }`. Drill-down parameters are `{ "p0": "acme", "p1": "purchase" }`. The real emitter quotes identifiers and wraps each operation; inspect `toSQL()` for exact text. Reuse shares query structure, not a database cache or one execution.

## Preserve order

`report.orderBy(e => e.id.desc())` sorts only the report's already limited rows. It does not choose the newest 100 rows from the full tenant input. For that, start from `tenantEvents.orderBy(e => e.id.desc()).limit(100)`.

`orderBy` replaces preceding sort keys when called on an ordered query. Use `thenBy` immediately after an ordered stage to add tie breakers. Other operations drop the `thenBy` stage.

## Correct common mistakes

- A grouped stage only exposes `aggregate`. Finish aggregation before filtering or sorting the resulting rows.
- Aggregate callback inputs are grouped expressions. Use `count()`, `sum(g.id)`, or another supported aggregate; do not project an unaggregated grouped value as an aggregate.
- Group keys and aggregate output names must not collide. Rename the aggregate in its object projection.
- Reusing a base does not add missing tenant predicates to joined tables. Scope every input appropriately.

[Try the shared editor](/playground/) with the fixture inlined and one of these queries as the default export. Next: [parameters and compilation](/docs/reference/parameters/).
