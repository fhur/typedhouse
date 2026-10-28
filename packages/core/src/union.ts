import { print } from './ch-type.js';
import { relNode } from './ir.js';
import { outputLeaves } from './output.js';
import { Query, type Caps } from './query.js';

type Input = Pick<Query<unknown, Caps, unknown>, 'ir' | 'row' | '_rowType' | 'caps'>;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Matching<F extends Input, I extends readonly Input[]> = { [K in keyof I]: Equal<F['_rowType'], I[K]['_rowType']> extends true ? unknown : { readonly union_row_mismatch: never } };
type UnionCaps<I extends readonly Input[]> = { readonly live: false extends { [K in keyof I]: I[K]['caps']['live'] extends false ? false : never }[number] ? false : I[number]['caps']['live'] };

/** Bag union, aligned by field path. Equal decoded rows still require identical SQL descriptors;
 * implicit ClickHouse common-type coercion is deliberately not supported. */
export function unionAll<F extends Input, const I extends readonly [Input, ...Input[]]>(first: F, ...rest: I & Matching<NoInfer<F>, I>): Query<F['_rowType'], UnionCaps<readonly [F, ...I]>, F['row'], true> {
  const inputs = [first, ...rest];
  if (inputs.length < 2) throw new Error('union_input_count at Union.inputs');
  for (const [i, input] of inputs.entries()) if (!(input instanceof Query)) throw new Error(`invalid_union_input at Union.inputs[${i}]`);
  const expected = outputLeaves(first.ir.output);
  for (const [i, input] of inputs.entries()) {
    const leaves = outputLeaves(input.ir.output);
    if (leaves.length !== expected.length) throw new Error(`union_schema_mismatch at Union.inputs[${i}].output`);
    for (const leaf of expected) {
      const actual = leaves.find(candidate => JSON.stringify(candidate.path) === JSON.stringify(leaf.path));
      if (!actual) throw new Error(`union_schema_mismatch at Union.inputs[${i}].output: ${JSON.stringify(leaf.path)}`);
      if (print(actual.type) !== print(leaf.type)) throw new Error(`union_descriptor_mismatch at Union.inputs[${i}].output: ${JSON.stringify(leaf.path)}`);
    }
  }
  return new Query(relNode({ kind: 'Union', inputs: inputs.map(q => q.ir), all: true, output: first.ir.output }), { live: inputs.every(q => q.caps.live) } as UnionCaps<readonly [F, ...I]>);
}
