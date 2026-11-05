import { expectTypeOf } from 'expect-type';
import { col, from, table } from '@typedhouse/core';
import { dataflow, toDataflowGraph, type Dataflow, type DataflowGraph } from '@typedhouse/devtools';

const source = from(
  table('graph_types', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
);

const inspector = dataflow(source.ir);
expectTypeOf(inspector).toEqualTypeOf<Dataflow>();
expectTypeOf(inspector.viz()).toEqualTypeOf<Promise<string>>();
expectTypeOf(inspector.mermaid()).toEqualTypeOf<Promise<string>>();
// @ts-expect-error output path must be a string
inspector.mermaid(123);
// @ts-expect-error output path must be a string
inspector.viz(123);
const graph = toDataflowGraph(source.ir);
expectTypeOf(graph).toEqualTypeOf<DataflowGraph>();
expectTypeOf(graph).not.toBeAny();
// @ts-expect-error pass relational IR, not the builder
toDataflowGraph(source);
// @ts-expect-error expressions are not relational roots
toDataflowGraph(source.row.id.ir);
