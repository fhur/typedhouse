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

export type JoinKind = 'inner' | 'left' | 'right' | 'full' | 'cross';
/** The descriptor an outer join's null-extended side yields under join_use_nulls = 1 on 24.8:
 * kinds ClickHouse can put inside Nullable are wrapped (SimpleAggregateFunction when its argument
 * can be), LowCardinality(T) becomes LowCardinality(Nullable(T)), and so does
 * SimpleAggregateFunction(f, LowCardinality(T)): the server drops that SAF wrapper. Nullable, Array,
 * Map, Tuple, Variant, Dynamic, JSON, AggregateFunction and Unknown stay as declared (the server
 * returns their defaults for unmatched rows). Idempotent; returns the argument when unchanged. */
export function outerColumnType(t: CHType): CHType {
  const lc = t.kind === 'SimpleAggregateFunction' && t.inner.kind === 'LowCardinality' ? t.inner : t;
  if (lc.kind === 'LowCardinality') return insideNullable(lc.inner) ? { kind: 'LowCardinality', inner: { kind: 'Nullable', inner: lc.inner } } : t;
  return insideNullable(t) ? { kind: 'Nullable', inner: t } : t;
}
function insideNullable(t: CHType): boolean {
  switch (t.kind) {
    case 'scalar': return t.name !== 'JSON';
    case 'FixedString': case 'DateTime': case 'DateTime64': case 'Decimal': case 'Enum': return true;
    case 'SimpleAggregateFunction': return insideNullable(t.inner);
    default: return false;
  }
}
/** Inputs whose columns are null-extended: left — every input after the first; right — every
 * input before the last; full — all; inner and cross — none. */
export function nullExtended(kind: JoinKind, index: number, count: number): boolean {
  return kind === 'full' || (kind === 'left' && index > 0) || (kind === 'right' && index < count - 1);
}
function outerOutput(schema: OutputSchema): OutputSchema {
  if (schema.shape === 'deferred') return schema;
  if (schema.shape === 'nested') {
    const inputs = schema.inputs.map(([alias, child]) => [alias, outerOutput(child)] as const);
    const fields = schema.fields && outerOutput(schema.fields) as Extract<OutputSchema, { shape: 'flat' }>;
    return inputs.every(([, child], i) => child === schema.inputs[i]![1]) && fields === schema.fields ? schema : { ...schema, inputs, ...(fields ? { fields } : {}) };
  }
  const types = schema.order.map(name => outerColumnType(schema.columns[name]!));
  return types.every((t, i) => t === schema.columns[schema.order[i]!]) ? schema : flatOutput(schema.order.map((name, i) => [name, types[i]!] as const));
}
/** A Join's nested output: each input's schema, null-extended per the kind. */
export function joinOutput(kind: JoinKind, inputs: readonly (readonly [string, { readonly output: OutputSchema }])[]): Extract<OutputSchema, { shape: 'nested' }> {
  return { shape: 'nested', inputs: inputs.map(([alias, rel], i) => [alias, nullExtended(kind, i, inputs.length) ? outerOutput(rel.output) : rel.output] as const) };
}
