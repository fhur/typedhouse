import type { CHType } from './ch-type.js';
import type { GeneratedExprMethods } from './expr-methods.generated.js';
import { exprNode, type ExprNode } from './ir.js';
import type { Column, Mode, NodeId, Value } from './types.js';

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
/** The only expression wrapper. The graph owns values; this wrapper owns no mutable state. */
export class Expr<T, N extends string = never, M extends Mode = 'row'> {
  declare private readonly brand: void;
  // Private field types are erased by declaration emit. Symbol phantoms survive packaging.
  declare readonly [exprValue]: T;
  declare readonly [exprName]: N;
  declare readonly [exprMode]: M;
  constructor(readonly ir: ExprNode, readonly name: N, readonly mode: M) { Object.freeze(this); }
  as<C extends Column>(this: Constant<T>, descriptor: C): DescribedConstant<C>;
  as<C extends Column>(descriptor: C): DescribedExpr<Value<C>, N, M, C['type']>;
  as<U>(descriptor: Column<U>): Expr<U, string, Mode> {
    // A declaration, not a SQL cast; edges keep their identity and owned values are recaptured.
    const { id: _id, ...fields } = this.ir;
    return new Expr(exprNode({ ...fields, ...(fields.kind === 'Raw' ? { resolution: 'declared' as const } : {}), type: descriptor.type }), this.name, this.mode);
  }
}
// Application extensions merge into this interface; generated declarations extend it once.
export interface ExprMethods<T, N extends string = never, M extends Mode = 'row'> extends GeneratedExprMethods<T, N, M> {}
export interface Expr<T, N extends string = never, M extends Mode = 'row'> extends ExprMethods<T, N, M> {}

export function extendExpr(methods: Record<string, (...args: never[]) => unknown>): void {
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
export function val(value: number): DescribedConstant<Column<number, false, { readonly kind: 'scalar'; readonly name: 'Float64' }>>;
export function val(value: bigint): DescribedConstant<Column<bigint, false, { readonly kind: 'scalar'; readonly name: 'Int64' }>>;
export function val<T>(value: T): Constant<Widen<T>>;
export function val<C extends Column>(value: NoInfer<Value<C>>, descriptor: C): DescribedConstant<C>;
export function val(value: unknown, descriptor?: Column): Constant<unknown> {
  return new Expr(exprNode({ kind: 'Param', value, type: descriptor?.type ?? defaultType(value) }), undefined as never, 'row') as Constant<unknown>;
}
export function cast<T, N extends string, M extends Mode, C extends Column>(expr: Expr<T, N, M>, descriptor: C): DescribedExpr<Value<C>, N, M, C['type']> {
  return new Expr(exprNode({ kind: 'Cast', expr: expr.ir, to: descriptor.type, type: descriptor.type }), expr.name, expr.mode) as DescribedExpr<Value<C>, N, M, C['type']>;
}
/** Plain operands intentionally stay unresolved until sibling-based compiler resolution. */
export function operand(value: unknown): ExprNode {
  return value instanceof Expr ? value.ir : exprNode({ kind: 'Param', value, type: null });
}
