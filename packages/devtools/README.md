# @typedhouse/devtools

Inspect [TypedHouse](https://github.com/fhur/typedhouse) relational query graphs and export SVG or Mermaid diagrams.

## Install

```sh
npm install @typedhouse/core @typedhouse/devtools
```

This package is ESM-only.

## Inspect a query

Pass a TypedHouse query's `ir` to `dataflow`:

```ts
import { dataflow } from '@typedhouse/devtools';

const graph = dataflow(query.ir);
console.log(graph.nodes, graph.edges);

await graph.viz('debug/query.svg');
await graph.mermaid('debug/query.md');
```

The file writers require Node.js, create parent directories, and replace existing files. With no path, they write `graph.svg` or `graph.md` in the current directory. SVG generation requires no external rendering tools.

For graph data without file writers, use `toDataflowGraph(query.ir)`.

## License

MIT
