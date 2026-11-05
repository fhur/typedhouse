import type { Column, Value } from './types.js';
import { Expr, val, type DescribedExpr, type ExprOperand } from './expr.js';
import { assertDataContainer, exprNode, type ExprNode } from './ir.js';
import type { KnownResultDescriptor } from './known-functions.js';

export type SqlValue = string | boolean | number | bigint | Date | readonly SqlValue[];

/** Trusted scalar SQL awaiting a result-type declaration before use as an expression. */
export interface SqlSnippet {
  /** Declare the snippet's result type; this neither casts nor verifies the SQL result.
   * @example
   * ```ts
   * sql`length(${val('abc')})`.as(col.UInt64);
   * ```
   */
  as<C extends Column>(
    descriptor: C & (C['type'] extends KnownResultDescriptor ? unknown : never),
  ): DescribedExpr<Value<C>, never, 'row', C['type']>;
}

function descriptorData(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol')
      throw new Error('invalid_sql_descriptor');

    return;
  }

  assertDataContainer(value);
  if (active.has(value)) throw new Error('cyclic_sql_descriptor');
  active.add(value);

  for (const item of Object.values(Object.getOwnPropertyDescriptors(value)))
    descriptorData(item.value, active);

  active.delete(value);
}

function rowOperand(node: ExprNode, active = new Set<object>()): void {
  assertDataContainer(node);
  if (active.has(node)) throw new Error('cyclic_ir');
  active.add(node);

  try {
    if (node.kind === 'Agg' || (node.kind === 'ColumnRef' && node.mode === 'grouped'))
      throw new Error('invalid_expression_mode');

    if (node.kind === 'Call' || node.kind === 'Raw') {
      assertDataContainer(node.args);
      for (const arg of node.args) rowOperand(arg, active);
    } else if (node.kind === 'Cast') rowOperand(node.expr, active);
    // Scalar subqueries establish an independent scope; compiler checks their cardinality.
  } finally {
    active.delete(node);
  }
}

function plainValue(value: unknown, active = new Set<object>()): void {
  if (['string', 'number', 'bigint', 'boolean'].includes(typeof value)) return;

  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Date.prototype
  ) {
    // Dates are slot-only values: reject overrides/extra fields without reading
    // them, then check the slot intrinsically (including forged Date prototypes).
    if (Reflect.ownKeys(value).length) throw new Error('invalid_sql_operand');

    try {
      Date.prototype.getTime.call(value);
    } catch {
      throw new Error('invalid_sql_operand');
    }

    return;
  }

  if (!Array.isArray(value)) throw new Error('invalid_sql_operand');
  assertDataContainer(value);
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length!.value as number;
  // Only dense indices and length are accepted, not auxiliary owned data that
  // snapshot would otherwise visit. Non-enumerable data indices remain valid.
  if (Object.keys(descriptors).length !== length + 1) throw new Error('invalid_sql_operand');
  if (active.has(value)) throw new Error('cyclic_sql_value');
  active.add(value);

  try {
    for (let i = 0; i < length; i++) {
      const item = descriptors[String(i)];
      if (!item) throw new Error('invalid_sql_operand');
      plainValue(item.value, active);
    }
  } finally {
    active.delete(value);
  }
}

/** Build trusted scalar SQL and finish with `.as(descriptor)` to declare its result.
 * Literal template text is trusted, not parsed or sanitized. Holes must occupy
 * expression positions: plain values become parameters and row expressions bind
 * column references. Holes cannot supply identifiers, keywords, or SQL fragments.
 * Aggregate and grouped expressions are not accepted as operands.
 * @example
 * ```ts
 * from(components).map(c => ({
 *   id: c.entityId,
 *   label: sql`concat(${c.entityId}, ${'-component'})`.as(col.String),
 * }));
 * ```
 */
export function sql(
  parts: TemplateStringsArray,
  ...values: readonly (ExprOperand<unknown, string, 'row'> | SqlValue)[]
): SqlSnippet {
  assertDataContainer(parts);

  if (!Array.isArray(parts) || parts.length !== values.length + 1)
    throw new Error('invalid_sql_parts');

  const strings: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (!Object.hasOwn(parts, i) || typeof parts[i] !== 'string')
      throw new Error('invalid_sql_parts');

    strings.push(parts[i]!);
  }

  const args = values.map(value => {
    if (value instanceof Expr) {
      const fields = Object.getOwnPropertyDescriptors(value);

      if (
        Object.values(fields).some(field => !('value' in field)) ||
        !Object.hasOwn(fields, 'mode') ||
        !Object.hasOwn(fields, 'ir')
      )
        throw new Error('invalid_sql_operand');

      if (value.mode !== 'row') throw new Error('invalid_expression_mode');
      rowOperand(value.ir);
      return value.ir;
    }

    plainValue(value);
    return val(value).ir;
  });

  // Capture inputs now, not when .as is later called. Graph edges retain identity.
  const captured = exprNode({
    kind: 'Raw',
    parts: strings,
    args,
    type: null,
    resolution: 'deferred',
    opaque: true,
    provenance: { origin: 'sql' },
  });

  return Object.freeze({
    as<C extends Column>(descriptor: C): DescribedExpr<Value<C>, never, 'row', C['type']> {
      assertDataContainer(descriptor);
      descriptorData(descriptor);

      return new Expr(
        exprNode({
          kind: 'Raw',
          parts: captured.parts,
          args: captured.args,
          type: descriptor.type,
          resolution: 'declared',
          opaque: true,
          provenance: { origin: 'sql' },
        }),
        undefined as never,
        'row',
      ) as DescribedExpr<Value<C>, never, 'row', C['type']>;
    },
  });
}
