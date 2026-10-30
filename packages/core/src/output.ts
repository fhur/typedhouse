import type { CHType } from './ch-type.js';
import { flatOutput, type OutputSchema } from './ir.js';

/** Append a top-level leaf without turning relational sides into Tuple columns. */
export function expandedOutput(input: OutputSchema, alias: string, type: CHType): OutputSchema {
  if (input.shape === 'deferred') throw new Error('unsupported_output');
  const fields = input.shape === 'flat' ? input : input.fields;
  if ((fields && Object.hasOwn(fields.columns, alias)) || (input.shape === 'nested' && input.inputs.some(([name]) => name === alias))) throw new Error(`duplicate_column: ${alias}`);
  const output = flatOutput([...(fields?.order.map(name => [name, fields.columns[name]!] as const) ?? []), [alias, type]]);
  return input.shape === 'flat' ? output : { ...input, fields: output };
}

export interface OutputLeaf { readonly path: readonly string[]; readonly name: string; readonly type: CHType }
/** Transport names are ordinal, never dot-separated paths (dots are legal identifiers). */
export function outputLeaves(output: OutputSchema): readonly OutputLeaf[] {
  const leaves: OutputLeaf[] = [];
  function visit(schema: OutputSchema, prefix: readonly string[]): void {
    if (schema.shape === 'deferred') throw new Error('unsupported_output');
    if (schema.shape === 'nested') {
      const names = schema.inputs.map(([name]) => name);
      if (names.length === 0 || new Set(names).size !== names.length) throw new Error('invalid_output');
      for (const [name, child] of schema.inputs) {
        if (typeof name !== 'string' || name.includes('\0')) throw new Error('invalid_output');
        visit(child, [...prefix, name]);
      }
      if (schema.fields) {
        if (schema.fields.order.some(name => names.includes(name))) throw new Error('invalid_output');
        visit(schema.fields, prefix);
      }
    } else {
      if (!schema.order.length || new Set(schema.order).size !== schema.order.length || schema.order.length !== Object.keys(schema.columns).length || schema.order.some(k => !Object.hasOwn(schema.columns, k))) throw new Error('invalid_output');
      for (const name of schema.order) leaves.push({ path: [...prefix, name], name: output.shape === 'flat' ? name : `__typedhouse_leaf_${leaves.length}`, type: schema.columns[name]! });
    }
  }
  visit(output, []);
  if (output.shape === 'flat') return leaves;
  const reserved = new Set(leaves.flatMap(l => l.path));
  let prefix = '__typedhouse_leaf_';
  while (leaves.some((_, i) => reserved.has(`${prefix}${i}`))) prefix += '_';
  return leaves.map((leaf, i) => ({ ...leaf, name: `${prefix}${i}` }));
}
