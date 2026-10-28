import fc from 'fast-check';
import { col, count, crossJoin, from, scalar, table, unionAll, val, type Rel } from '@chql/core';

export const seed = 20261028;
export const source = from(table('validation_rows', { id: col.UInt64, tags: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
export const categories = [
  'input', 'output', 'metadata', 'args', 'sparseArgs', 'badArg', 'relationCycle', 'expressionCycle', 'subqueryCycle', 'outputCycle', 'descriptorCycle',
  'joinPair', 'sparsePair', 'sparseInputs', 'unionInput', 'sortExpr', 'projectExprs', 'aggregateKeys', 'aggregateArgs', 'aggregateParams',
  'outputColumns', 'outputOrder', 'outputInputs', 'outputFields', 'table', 'tableColumns', 'columnPath', 'castExpr', 'castTarget',
  'tupleItem', 'mapValue', 'variantItem', 'enumValue', 'aggregateTypeArg', 'simpleAggregateInner', 'rawArgs', 'caseBranch', 'unknownRel', 'unknownExpr', 'unknownType',
] as const;
export type Category = typeof categories[number];
export interface Recipe { category: Category; wrappers: readonly ('distinct' | 'limit')[]; value: number }
export const recipes: fc.Arbitrary<Recipe> = fc.record({ category: fc.constantFrom(...categories), wrappers: fc.array(fc.constantFrom('distinct' as const, 'limit' as const), { maxLength: 6 }), value: fc.integer({ min: 0, max: 100 }) });

/** All casts/mutations live at this deliberately malformed-IR boundary. A fresh
 * public graph is cloned with identity preservation; every shrink reapplies one
 * corruption, never filters/discards a recipe or turns it back into a valid IR.
 */
export function mutation(recipe: Recipe): { root: Rel; path: string; code: string; offending: unknown } {
  let query = source.where(r => r.id.gt(BigInt(recipe.value)));
  // Mutable test-only graph, including intentionally absent/wrong fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = structuredClone(query.ir);
  let edge = '', code = 'invalid_structure';
  const project = () => structuredClone(source.map(r => ({ id: r.id })).ir);
  const aggregate = () => structuredClone(source.aggregate(() => ({ n: count() })).ir);
  const join = () => structuredClone(crossJoin({ a: source, b: source }).ir);
  const type = (descriptor: unknown) => { node = structuredClone(source.ir); node.output.columns.id = descriptor; };
  switch (recipe.category) {
    case 'input': node.input = undefined; edge = '.input'; break;
    case 'output': node.output = undefined; edge = '.output'; break;
    case 'metadata': node.pred.fn = undefined; edge = '.pred.fn'; break;
    case 'args': node.pred.args = undefined; edge = '.pred.args'; break;
    case 'sparseArgs': delete node.pred.args[0]; edge = '.pred.args[0]'; break;
    case 'badArg': node.pred.args[1] = null; edge = '.pred.args[1]'; break;
    case 'relationCycle': node.input = node; edge = '.input'; code = 'cyclic_ir'; break;
    case 'expressionCycle': node.pred.args[0] = node.pred; edge = '.pred.args[0]'; code = 'cyclic_ir'; break;
    case 'subqueryCycle': node = structuredClone(source.map(() => ({ n: scalar(source.aggregate(() => ({ n: count() }))) })).ir); node.exprs.n.rel = node; edge = '.exprs.n.rel'; code = 'cyclic_ir'; break;
    case 'outputCycle': node = join(); node.output.inputs[0][1] = node.output; edge = '.output.inputs[0][1]'; code = 'cyclic_ir'; break;
    case 'descriptorCycle': { const descriptor = { kind: 'Array', inner: null as unknown }; descriptor.inner = descriptor; type(descriptor); edge = '.output.columns.id.inner'; code = 'cyclic_ir'; break; }
    case 'joinPair': node = join(); node.inputs[0] = {}; edge = '.inputs[0]'; break;
    case 'sparsePair': node = join(); delete node.inputs[0][1]; edge = '.inputs[0][1]'; break;
    case 'sparseInputs': node = join(); delete node.inputs[0]; edge = '.inputs[0]'; break;
    case 'unionInput': node = structuredClone(unionAll(source, source).ir); node.inputs[1] = null; edge = '.inputs[1]'; break;
    case 'sortExpr': node = structuredClone(source.orderBy(r => r.id).ir); node.keys[0].expr = null; edge = '.keys[0].expr'; break;
    case 'projectExprs': node = project(); node.exprs = null; edge = '.exprs'; break;
    case 'aggregateKeys': node = aggregate(); node.keys = null; edge = '.keys'; break;
    case 'aggregateArgs': node = aggregate(); node.aggs.n.args = null; edge = '.aggs.n.args'; break;
    case 'aggregateParams': node = aggregate(); node.aggs.n.params = null; edge = '.aggs.n.params'; break;
    case 'outputColumns': node.output.columns = null; edge = '.output.columns'; break;
    case 'outputOrder': node.output.order = null; edge = '.output.order'; break;
    case 'outputInputs': node = join(); node.output.inputs = null; edge = '.output.inputs'; break;
    case 'outputFields': node = join(); node.output.fields = false; edge = '.output.fields'; break;
    case 'table': node = structuredClone(source.ir); node.table = null; edge = '.table'; break;
    case 'tableColumns': node = structuredClone(source.ir); node.table.columns = null; edge = '.table.columns'; break;
    case 'columnPath': node.pred.args[0].path = [null]; edge = '.pred.args[0].path[0]'; break;
    case 'castExpr': node.pred.args[0] = { ...node.pred.args[0], kind: 'Cast', expr: null, to: col.UInt64.type }; edge = '.pred.args[0].expr'; break;
    case 'castTarget': node.pred.args[0] = { ...node.pred.args[0], kind: 'Cast', expr: node.pred.args[0], to: null }; edge = '.pred.args[0].to'; code = 'unsupported_cast_type'; break;
    case 'tupleItem': type({ kind: 'Tuple', items: [null] }); edge = '.output.columns.id.items[0]'; break;
    case 'mapValue': type({ kind: 'Map', key: col.String.type, value: null }); edge = '.output.columns.id.value'; break;
    case 'variantItem': type({ kind: 'Variant', items: [null] }); edge = '.output.columns.id.items[0]'; break;
    case 'enumValue': type({ kind: 'Enum', bits: 8, values: [{ name: 'a', value: null }] }); edge = '.output.columns.id.values[0].value'; break;
    case 'aggregateTypeArg': type({ kind: 'AggregateFunction', fn: 'count', args: [null] }); edge = '.output.columns.id.args[0]'; break;
    case 'simpleAggregateInner': type({ kind: 'SimpleAggregateFunction', fn: 'sum', inner: null }); edge = '.output.columns.id.inner'; break;
    case 'rawArgs': node.pred = { ...node.pred, kind: 'Raw', opaque: true, resolution: 'declared', provenance: { origin: 'sql' }, parts: [''], args: null }; edge = '.pred.args'; break;
    case 'caseBranch': node.pred = { ...node.pred, kind: 'Case', branches: [{ when: node.pred, then: null }], otherwise: val(true).ir }; edge = '.pred.branches[0].then'; break;
    case 'unknownRel': node.kind = 'Oops'; edge = '.kind'; break;
    case 'unknownExpr': node.pred.kind = 'Oops'; edge = '.pred.kind'; break;
    case 'unknownType': type({ kind: 'Oops' }); edge = '.output.columns.id.kind'; break;
  }
  let root = node;
  // Build wrapper topology publicly before attaching the malformed child, so no
  // builder ever traverses the corruption; wrapper shrink always remains valid.
  for (const wrapper of recipe.wrappers) {
    query = wrapper === 'distinct' ? query.distinct() : query.limit(recipe.value);
    root = { ...query.ir, input: root, output: root.output };
    edge = '.input' + edge;
  }
  // Wrappers sharing a corrupt output would report its shape first. Keep their
  // own valid schema: the selected mutation must remain at its selected edge.
  let cursor = root;
  for (let i = 0; i < recipe.wrappers.length; i++) { cursor.output = source.ir.output; cursor = cursor.input; }
  const path = 'root' + edge;
  const offending = path.slice(5).replaceAll('[', '.').replaceAll(']', '').split('.').filter(Boolean).reduce((o, key) => o?.[key], root);
  return { root: root as Rel, path, code, offending };
}
