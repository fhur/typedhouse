import type { CHType } from './ch-type.js';
import type { GeneratedExprMethods } from './expr-methods.generated.js';
import { exprNode, type ExprNode } from './ir.js';
import type { Column, Mode, NodeId, Value } from './types.js';
import type { KnownResultDescriptor } from './known-functions.js';

/** Refine the existing runtime twin, without adding a value phantom to Expr. */
export type DescribedExpr<T, N extends string, M extends Mode, D extends CHType> = Expr<T, N, M> & { readonly ir: ExprNode & { readonly type: D } };
export type DescribedConstant<C extends Column> = Constant<Value<C>> & { readonly ir: ExprNode & { readonly type: C['type'] } };

/** Descriptor-backed construction retains SQL identity even when decoded types coincide. */
export function columnExpr<C extends Column, N extends string, M extends Mode>(descriptor: C, rel: NodeId, path: readonly string[], name: N, mode: M): DescribedExpr<Value<C>, N, M, C['type']> {
  return new Expr(exprNode({ kind: 'ColumnRef', rel, path, type: descriptor.type, ...(mode === 'grouped' || mode === 'row' ? { mode } : {}) }), name, mode) as DescribedExpr<Value<C>, N, M, C['type']>;
}

declare const exprValue: unique symbol;
declare const exprName: unique symbol;
declare const exprMode: unique symbol;
export type ExprValue<E extends Expr<unknown, string, Mode>> = E[typeof exprValue];
/** A private base brand preserves instance evidence without the generated methods.
 * Unlike public symbol phantoms, it cannot survive an object spread. */
class ExprIdentity {
  declare private readonly brand: void;
}
/** Compare nominal identity and exact value/name/mode evidence, not recursive
 * generated overloads and their promoted results. */
export type ExprOperand<T, N extends string, M extends Mode> = ExprIdentity & Pick<Expr<T, N, M>, typeof exprValue | typeof exprName | typeof exprMode | 'ir' | 'name' | 'mode'>;
export type ConstantOperand<T> = ExprOperand<T, never, 'row'> & Pick<Constant<T>, typeof constant>;
/** An immutable SQL expression, not its decoded JavaScript value.
 * Obtain expressions from query callbacks, `val()`, or DSL functions. Methods build
 * new expressions; row, grouped-input, and aggregate modes restrict where they can be used.
 */
export class Expr<T, N extends string = never, M extends Mode = 'row'> extends ExprIdentity {
  // Private field types are erased by declaration emit. Symbol phantoms survive packaging.
  declare readonly [exprValue]: T;
  declare readonly [exprName]: N;
  declare readonly [exprMode]: M;
  constructor(readonly ir: ExprNode, readonly name: N, readonly mode: M) { super(); Object.freeze(this); }
  /** Declare a constant's ClickHouse type without emitting CAST.
   * Use this when inference is insufficient, such as an empty array or NULL.
   * @example
   * ```ts
   * val([]).as(col.Array(col.String));
   * ```
   */
  as<C extends Column>(this: Constant<T>, descriptor: C): DescribedConstant<C>;
  /** Declare the result descriptor without changing the SQL computation.
   * This is an assertion, not a conversion; use `cast()` to emit a SQL CAST.
   * Known-function results require a supported declaration before projection.
   * @example
   * ```ts
   * const size = sql`length(${val('abc')})`.as(col.UInt64);
   * ```
   */
  as<C extends Column>(descriptor: C & (this extends { readonly knownResult: true } ? C['type'] extends KnownResultDescriptor ? unknown : never : unknown)): DescribedExpr<Value<C>, N, M, C['type']>;
  as<U>(descriptor: Column<U>): Expr<U, string, Mode> {
    // A declaration, not a SQL cast; edges keep their identity and owned values are recaptured.
    const { id: _id, ...fields } = this.ir;
    if (fields.kind === 'Call' && fields.fn.origin === 'known' && fields.fn.known) {
      return new Expr(exprNode({ ...fields, fn: { ...fields.fn, known: { ...fields.fn.known, declaration: { origin: 'as', type: descriptor.type } } }, type: descriptor.type }), this.name, this.mode);
    }
    if (fields.kind === 'Agg' && fields.fn.origin === 'known' && fields.fn.known) {
      return new Expr(exprNode({ ...fields, fn: { ...fields.fn, known: { ...fields.fn.known, declaration: { origin: 'as', type: descriptor.type } } }, type: descriptor.type }), this.name, this.mode);
    }
    return new Expr(exprNode({ ...fields, ...(fields.kind === 'Raw' ? { resolution: 'declared' as const } : {}), type: descriptor.type }), this.name, this.mode);
  }
}
// The builtin method surface is generated once for all expression modes.
export interface Expr<T, N extends string = never, M extends Mode = 'row'> extends GeneratedExprMethods<T, N, M> {}

/** Internal installer for the generated builtin surface. */
export function installBuiltinMethods(methods: Record<string, (...args: never[]) => unknown>): void {
  for (const name of Object.keys(methods)) {
    if (name in Expr.prototype) throw new Error(`duplicate_function: ${name}`);
  }
  for (const [name, method] of Object.entries(methods)) Object.defineProperty(Expr.prototype, name, { value: method });
}

export function defaultType(value: unknown): CHType | null {
  if (typeof value === 'string') return { kind: 'scalar', name: 'String' };
  if (typeof value === 'boolean') return { kind: 'scalar', name: 'Bool' };
  if (typeof value === 'number') return { kind: 'scalar', name: 'Float64' };
  if (typeof value === 'bigint') return { kind: 'scalar', name: 'Int64' };
  if (value instanceof Date) return { kind: 'DateTime64', precision: 3 };
  if (Array.isArray(value) && value.length) {
    const inner = defaultType(value[0]);
    if (inner) return { kind: 'Array', inner };
  }
  return null;
}
declare const constant: unique symbol;
export type Constant<T> = Expr<T> & { readonly [constant]: true };
type Widen<T> = T extends string ? string : T extends number ? number : T extends bigint ? bigint : T extends boolean ? boolean : T;
/** Bind a JavaScript number as a Float64 parameter; use an explicit descriptor for integers.
 * @example
 * ```ts
 * val(1.5); // Float64
 * val(3, col.UInt32); // UInt32
 * ```
 */
export function val(value: number): DescribedConstant<Column<number, false, { readonly kind: 'scalar'; readonly name: 'Float64' }>>;
/** Bind a bigint as an Int64 parameter; pass a descriptor for another integer width.
 * @example
 * ```ts
 * val(3n); // Int64
 * val(3n, col.UInt64); // UInt64
 * ```
 */
export function val(value: bigint): DescribedConstant<Column<bigint, false, { readonly kind: 'scalar'; readonly name: 'Int64' }>>;
/** Bind a value as a parameter, inferring a descriptor when possible.
 * Empty arrays and NULL need an explicit descriptor or `.as()` declaration.
 * Values are never inserted as SQL text; use an object key when projecting an unnamed constant.
 * @example
 * ```ts
 * from(components).map(c => ({ id: c.entityId, label: val('component') }));
 * ```
 */
export function val<T>(value: T): Constant<Widen<T>>;
/** Bind a value using an explicit ClickHouse descriptor.
 * Useful for empty arrays, nullable values, or exact numeric widths.
 * @example
 * ```ts
 * val([], col.Array(col.String));
 * val(null, col.Nullable(col.String));
 * ```
 */
export function val<C extends Column>(value: NoInfer<Value<C>>, descriptor: C): DescribedConstant<C>;
export function val(value: unknown, descriptor?: Column): Constant<unknown> {
  return new Expr(exprNode({ kind: 'Param', value, type: descriptor?.type ?? defaultType(value) }), undefined as never, 'row') as Constant<unknown>;
}
/** Emit a SQL CAST to the supplied descriptor, preserving the expression's name and mode.
 * Unlike `.as()`, this asks ClickHouse to convert the value; invalid conversions can fail at execution.
 * @example
 * ```ts
 * cast(val(3n), col.String);
 * ```
 */
export function cast<T, N extends string, M extends Mode, C extends Column>(expr: Expr<T, N, M>, descriptor: C): DescribedExpr<Value<C>, N, M, C['type']> {
  return new Expr(exprNode({ kind: 'Cast', expr: expr.ir, to: descriptor.type, type: descriptor.type }), expr.name, expr.mode) as DescribedExpr<Value<C>, N, M, C['type']>;
}
/** Plain operands intentionally stay unresolved until sibling-based compiler resolution. */
export function operand(value: unknown): ExprNode {
  return value instanceof Expr ? value.ir : exprNode({ kind: 'Param', value, type: null });
}
