import type { CHType } from '../ch-type.js';
import { col } from '../columns.js';
import { Expr, type ConstantOperand, type DescribedExpr, type ExprOperand } from '../expr.js';
import type { Mode } from '../types.js';
import { defineFunction, invoke } from './define.js';

type StringDescriptor = { readonly kind: 'scalar'; readonly name: 'String' };
export type DayDescriptor = { readonly kind: 'scalar'; readonly name: 'Date' | 'DateTime' } |
  { readonly kind: 'DateTime'; readonly tz?: string } |
  { readonly kind: 'DateTime64'; readonly precision: 0 | 1 | 2 | 3; readonly tz?: string };
type Temporal = ExprOperand<Date, string, Mode> & { readonly ir: { readonly type: DayDescriptor } };
type Condition = ExprOperand<boolean | null, string, Mode>;
type Branch = string | (ExprOperand<string, string, Mode> & { readonly ir: { readonly type: StringDescriptor } });
type Pair = readonly [Condition, Branch];
type IsUnion<T, U = T> = T extends U ? [U] extends [T] ? false : true : never;
type Single<T> = true extends IsUnion<T> ? never : unknown;
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? unknown : never : never;
type NonConstant<E> = Exclude<Extract<E, ExprOperand<unknown, string, Mode>>, ConstantOperand<unknown>>;
type ModeCheck<E, M> = [NonConstant<E>] extends [never] ? unknown : NonConstant<E> extends ExprOperand<unknown, string, infer N> ? Single<N> & Equal<N, M> : never;
type FirstMode<A extends readonly unknown[]> = A extends readonly [infer H, ...infer T]
  ? H extends Pair ? FirstMode<readonly [H[0], H[1], ...T]>
    : [NonConstant<H>] extends [never] ? FirstMode<T> : NonConstant<H> extends ExprOperand<unknown, string, infer M> ? M : never
  : 'row';
type Fixed<A extends readonly unknown[]> = number extends A['length'] ? never : true extends IsUnion<A> ? never : A extends Required<A> ? unknown : never;
type Checked<A extends readonly [Pair, ...Pair[], Branch]> = {
  [K in keyof A]: A[K] extends Pair ? A[K] & Fixed<A[K]> & ModeCheck<A[K][0], FirstMode<A>> & ModeCheck<A[K][1], FirstMode<A>> : A[K] & ModeCheck<A[K], FirstMode<A>>
};

export function isDayDescriptor(t: CHType): boolean {
  return t.kind === 'scalar' && (t.name === 'Date' || t.name === 'DateTime') || t.kind === 'DateTime' || t.kind === 'DateTime64' && [0, 1, 2, 3].includes(t.precision);
}
const nowDefinition = defineFunction({ name: 'now', args: [], returns: col.DateTime(), nullable: 'never', deterministic: false, origin: 'typed' }).definition;
const dayDefinition = defineFunction({
  name: 'dateDiff', args: [col.String, { match: isDayDescriptor }, { match: isDayDescriptor }, col.String],
  argumentPolicies: ['dayUnit', 'sibling', 'sibling', 'utcZone'], returns: col.Int64,
  nullable: 'never', deterministic: true, origin: 'typed',
}).definition;
const multiDefinition = defineFunction({
  name: 'multiIf', args: [], repeatedArgs: 'stringMultiIf', returns: col.String,
  nullable: 'never', deterministic: true, origin: 'typed',
}).definition;
export const projectionDefinitions = [nowDefinition, dayDefinition, multiDefinition] as const;

/** Server clock; intentionally carries no invented timezone metadata. */
export function now(): DescribedExpr<Date, 'now', 'row', { readonly kind: 'DateTime' }>;
export function now(): Expr<unknown, string, Mode> {
  const expression = invoke(nowDefinition, []);
  return new Expr(expression.ir, 'now', 'row');
}

/** UTC calendar boundaries, not elapsed 24-hour periods. */
export function dateDiff<const S extends Temporal, const E extends Temporal>(unit: 'day', start: S, end: E & ModeCheck<E, S['mode']> & Single<S['mode']>): DescribedExpr<bigint, S['name'], S['mode'], { readonly kind: 'scalar'; readonly name: 'Int64' }>;
export function dateDiff(unit: 'day', start: Expr<Date, string, Mode>, end: Expr<Date, string, Mode>): Expr<unknown, string, Mode> {
  if (unit !== 'day' || !(start instanceof Expr) || !(end instanceof Expr) || !start.ir.type || !end.ir.type || !isDayDescriptor(start.ir.type) || !isDayDescriptor(end.ir.type)) throw new Error('incompatible_operands');
  if (start.ir.kind !== 'Param' && end.ir.kind !== 'Param' && start.mode !== end.mode) throw new Error('invalid_expression_mode');
  const result = invoke(dayDefinition, [unit, start, end, 'UTC']);
  return new Expr(result.ir, start.name, start.mode);
}

/** Closed string-only conditional family; nullable conditions are skipped by SQL. */
export function multiIf<const A extends readonly [Pair, ...Pair[], Branch]>(...args: A & Fixed<A> & Checked<A> & Single<FirstMode<A>>): DescribedExpr<string, A[0][0]['name'], FirstMode<A>, StringDescriptor>;
export function multiIf(...args: readonly unknown[]): Expr<unknown, string, Mode> {
  if (args.length < 2) throw new Error('invalid_argument_arity');
  const pairs = args.slice(0, -1);
  const flat: unknown[] = [];
  let first: Expr<unknown, string, Mode> | undefined;
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !(pair[0] instanceof Expr)) throw new Error('incompatible_operands');
    first ??= pair[0];
    const type = pair[0].ir.type;
    const base = type?.kind === 'Nullable' ? type.inner : type;
    if (base?.kind !== 'scalar' || base.name !== 'Bool') throw new Error('invalid_predicate');
    flat.push(pair[0], pair[1]);
  }
  flat.push(args[args.length - 1]);
  const mode = flat.find((item): item is Expr<unknown, string, Mode> => item instanceof Expr && item.ir.kind !== 'Param')?.mode ?? 'row';
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    if (i % 2 === 1 || i === flat.length - 1) {
      if (typeof item !== 'string' && (!(item instanceof Expr) || item.ir.type?.kind !== 'scalar' || item.ir.type.name !== 'String')) throw new Error('incompatible_operands');
    }
    if (item instanceof Expr && item.ir.kind !== 'Param' && item.mode !== mode) throw new Error('invalid_expression_mode');
  }
  const result = invoke(multiDefinition, flat);
  return new Expr(result.ir, first!.name, mode);
}
