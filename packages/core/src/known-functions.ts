import { Expr, type ConstantOperand, type ExprOperand } from './expr.js';
import { exprNode, type KnownFunctionCatalog } from './ir.js';
import type { Mode } from './types.js';

/** The same bounded recursive grammar as the compiler's known-result decoder guard. */
export type KnownResultDescriptor =
  | { readonly kind: 'scalar'; readonly name: `UInt${8 | 16 | 32 | 64 | 128 | 256}` | `Int${8 | 16 | 32 | 64 | 128 | 256}` | 'Float32' | 'Float64' | 'String' | 'Bool' | 'Date' | 'DateTime' }
  | { readonly kind: 'FixedString'; readonly n: number }
  | { readonly kind: 'DateTime'; readonly tz?: string }
  | { readonly kind: 'DateTime64'; readonly precision: 0 | 1 | 2 | 3; readonly tz?: string }
  | { readonly kind: 'Nullable' | 'LowCardinality' | 'Array'; readonly inner: KnownResultDescriptor }
  | { readonly kind: 'Tuple'; readonly items: readonly { readonly name?: string; readonly type: KnownResultDescriptor }[] };
export type KnownExpr<N extends string, M extends Mode = 'row'> = Expr<unknown, N, M> & { readonly knownResult: true };

/** No signatures are inferred from system.functions. These are caller-declared
 * escape hatches, not typed overloads or a server-authenticity guarantee. */
export interface KnownScalar<F extends string> {
  (): KnownExpr<F>;
  <N extends string, M extends Mode>(first: ExprOperand<unknown, N, M>, ...rest: readonly (ExprOperand<unknown, string, NoInfer<M>> | ConstantOperand<unknown>)[]): KnownExpr<N, M>;
}
export interface KnownAggregate<F extends string> {
  (): KnownExpr<F, 'agg'>;
  <N extends string>(first: ExprOperand<unknown, N, 'grouped'>, ...rest: readonly (ExprOperand<unknown, string, 'grouped'> | ConstantOperand<unknown>)[]): KnownExpr<N, 'agg'>;
  (first: ConstantOperand<unknown>, ...rest: readonly ConstantOperand<unknown>[]): KnownExpr<never, 'agg'>;
}
export type KnownFunctions<C extends KnownFunctionCatalog> = {
  readonly fn: { readonly [K in keyof C as C[K]['isAggregate'] extends false ? K : never]: KnownScalar<K & string> };
  readonly agg: { readonly [K in keyof C as C[K]['isAggregate'] extends true ? K : never]: KnownAggregate<K & string> };
};

export function createKnownFunctions<const C extends KnownFunctionCatalog>(catalog: C): KnownFunctions<C> {
  // Capture the whole provided catalog, not a mutable registry or an application
  // module import. The IR constructor snapshots this plain data on each call.
  const evidence = Object.freeze(Object.fromEntries(Object.entries(catalog).map(([name, entry]) => [name, Object.freeze({ ...entry })])));
  const fn: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const agg: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, entry] of Object.entries(evidence)) {
    const invoke = (...args: Expr<unknown, string, Mode>[]) => {
      if (args.some(a => !(a instanceof Expr))) throw new Error('known_function_requires_expression');
      const nonconstants = args.filter(a => a.ir.kind !== 'Param');
      const mode = entry.isAggregate ? 'agg' : nonconstants[0]?.mode ?? args[0]?.mode ?? 'row';
      if (nonconstants.some(a => a.mode !== (entry.isAggregate ? 'grouped' : mode))) throw new Error('invalid_expression_mode');
      const metadata = { name, origin: 'known' as const, deterministic: entry.deterministic === true, known: { catalog: evidence, name } };
      const type = { kind: 'Unknown' as const, raw: 'known function result requires .as()' };
      const ir = entry.isAggregate
        ? exprNode({ kind: 'Agg', fn: { ...metadata, linear: false }, args: args.map(a => a.ir), params: [], combinators: [], type })
        : exprNode({ kind: 'Call', fn: metadata, args: args.map(a => a.ir), type });
      return new Expr(ir, args.length ? args[0]!.name : name, mode);
    };
    Object.defineProperty(entry.isAggregate ? agg : fn, name, { enumerable: true, value: invoke });
  }
  return Object.freeze({ fn: Object.freeze(fn), agg: Object.freeze(agg) }) as KnownFunctions<C>;
}
