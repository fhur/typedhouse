---
title: Inspecting dataflow
description: Inspect the relational IR as a JSON-friendly graph.
---

Install the optional inspection package with `pnpm add -D @typedhouse/devtools`.
Use `dataflow` to inspect a query without compiling or executing it:

```ts typecheck-only
import { col, from, table } from '@typedhouse/core';
import { dataflow } from '@typedhouse/devtools';

const offers = table(
  'offers',
  { origin: col.String },
  {
    engine: 'Memory',
    sortingKey: [],
    partitionKey: [],
  },
);
const query = from(offers)
  .groupBy((x) => x.origin)
  .count();

const graph = dataflow(query.ir);
await graph.viz(); // graph.svg in the working directory
await graph.viz('debug/offers.svg'); // custom path
console.table(graph.nodes);
console.table(graph.edges);
console.log(JSON.stringify(graph, null, 2));
```

`viz()` is asynchronous and requires Node.js. It writes a self-contained SVG,
creates missing parent directories, and replaces an existing file at the chosen
path. No Graphviz installation is needed. Operators flow left to right; dashed
purple edges indicate subqueries. Hover an edge to inspect its IR path. Rendering
does not execute the query. Nodes show up to five attributes with an overflow
count; limits show only their label (such as `Limit 20`), and filters show their
condition.

`toDataflowGraph(ir)` remains available for plain graph data without the writer.

The graph contains:

- `root`: the result operator's graph-local ID (`n0`).
- `nodes`: relational operators, with `id`, original `irId`, `kind`, a short `label`, and output `columns` (name paths and ClickHouse type strings).
- `edges`: dependencies directed from producer `source` to consumer `target`. Each edge records its consumer-side IR `path` and `kind`: `input`, `scalar`, or `in`.

A shared relation appears once, identified by object identity. Repeated input slots and repeated subquery occurrences produce separate edges. Equivalent but independently constructed relations remain separate nodes. Join aliases are preserved as path segments, including aliases containing dots.

This is a **relational topology**, not a physical execution plan or an expression-level debugger. Scalar expressions are not separate nodes; scalar and set subqueries are followed to their relational inputs. Filter nodes display a human-readable condition instead of attributes, including parameter values. Raw SQL text is omitted. Exported graphs can contain sensitive query data and should be shared accordingly. Long predicates and values are abbreviated with `…`; labels are summaries, not executable SQL.

Output is detached from the IR and JSON-friendly. Graph-local IDs follow deterministic discovery order for a given IR, but should not be persisted as stable identifiers across query changes. Original `irId` values depend on construction order. Deferred raw-relation column types are represented as `null`.

The function accepts trusted IR and does not validate query semantics. It does not run compiler rewrites; passing the builder's `.ir` shows the query as constructed.
