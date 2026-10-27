import { Ordering } from './ordering.js';
import { Expr, columnExpr } from './expr.js';
import { exprNode, flatOutput, relNode, type ExprNode, type FlatColumns, type Rel, type SortKey } from './ir.js';
import type { CHType } from './ch-type.js';
import type { TableDef } from './table.js';
import type { Infer, Row } from './types.js';

export interface Caps { readonly live: boolean }
export interface CompiledQuery {
  readonly sql: string;
  readonly params: Readonly<Record<string, string>>;
  /** Resolved placeholder descriptors, used to transport pre-serialized containers verbatim. */
  readonly parameterTypes?: Readonly<Record<string, CHType>>;
  readonly columns: FlatColumns;
  readonly nodes: Readonly<Record<string, Rel>>;
}
export type QueryCompiler = (rel: Rel) => CompiledQuery;
let compiler: QueryCompiler | undefined;
/** Explicit attachment: importing core never loads a backend. */
export function registerCompiler(implementation: QueryCompiler): void { compiler = implementation; }
export type IsLive<Q> = Q extends Query<infer _R, infer C> ? C['live'] : never;
type DescribedRow<R, D> = { readonly [K in keyof R]: Expr<R[K], K & string> & { readonly ir: ExprNode & { readonly type: K extends keyof D ? D[K] extends CHType ? D[K] : CHType : CHType } } };
type WithRow<Q, R> = Q & { readonly row: R };
type Projection = Record<string, Expr<unknown, string, 'row'>>;
type ArrayValue<E> = E extends Expr<readonly (infer T)[], string> ? T : never;
type ArrayChild<E extends Expr<readonly unknown[], string>> = E['ir']['type'] extends { readonly kind: 'Array'; readonly inner: infer D extends CHType } ? D : CHType;
type IsUnion<A, Whole = A> = A extends Whole ? [Whole] extends [A] ? false : true : never;
// Pattern indexes (including `${number}`) accept an empty record, unlike a
// concrete literal key. Union detection alone cannot distinguish these.
type OptionalAlias<A extends string> = true extends IsUnion<A> ? true : {} extends Record<A, unknown> ? true : false;
// Only a singleton alias is guaranteed to exist. A widened index must also
// admit every source value; intersecting a child-only index corrupts those fields.
type Expanded<R, E, A extends string> = string extends A
  ? R & Partial<Record<string, R[keyof R] | ArrayValue<E>>>
  : OptionalAlias<A> extends true ? R & Partial<Record<A, R[Extract<keyof R, A>] | ArrayValue<E>>>
  : { [K in keyof R | A]: K extends keyof R ? R[K] : ArrayValue<E> };
type ExpandedRow<R, E extends Expr<readonly unknown[], string>, A extends string> = string extends A
  ? R & Partial<Record<string, R[keyof R] | (Expr<ArrayValue<E>, string> & { readonly ir: ExprNode & { readonly type: ArrayChild<E> } })>>
  : OptionalAlias<A> extends true ? R & Partial<{ [K in A]: R[Extract<keyof R, A>] | DescribedRow<{ [P in K]: ArrayValue<E> }, { [P in K]: ArrayChild<E> }>[K] }>
  : R & DescribedRow<{ [K in A]: ArrayValue<E> }, { [K in A]: ArrayChild<E> }>;
type ProjectRow<P extends Projection> = DescribedRow<Infer<P>, { [K in keyof P]: NonNullable<P[K]['ir']['type']> }>;
type NamedProjection<E extends Expr<unknown, string>> = { [K in E['name']]: E };
type ValidProjection<P> = P extends Expr<unknown, string> ? [P['name']] extends [never] ? { readonly unnamed_expression: never } : unknown : unknown;
type ProjectionRow<P extends Projection | Expr<unknown, string>> = P extends Expr<unknown, string> ? ProjectRow<NamedProjection<P>> : P extends Projection ? ProjectRow<P> : never;
type AggregateProjection = Record<string, Expr<unknown, string, 'agg'>> | Expr<unknown, string, 'agg'>;
type Named<P> = P extends Expr<unknown, infer N, infer _M> ? { [K in N]: P } : P;
type GroupedInput<R> = { readonly [K in keyof R]: R[K] extends Expr<infer T, infer N> ? Expr<T, N, 'grouped'> & { readonly ir: R[K]['ir'] } : never };
type AggregateRow<K, A> = { [P in keyof (Infer<K> & Infer<A>)]: (Infer<K> & Infer<A>)[P] };
type OutputRow<K, A> = DescribedRow<AggregateRow<K, A>, { [P in keyof (Named<K> & Named<A>)]: (Named<K> & Named<A>)[P] extends { ir: { type: infer D } } ? D : CHType }>;
type ValidNamed<P> = P extends { readonly name: infer N } ? [N] extends [never] ? { readonly unnamed_expression: never } : unknown : unknown;
type Unique<K, A> = Extract<keyof Named<K>, keyof Named<A>> extends never ? unknown : { readonly duplicate_column: never };
function expressions(value: unknown, mode: 'row' | 'agg'): [string, Expr<unknown, string, typeof mode>][] {
  if (value instanceof Expr) {
    if (value.name === undefined) throw new Error('unnamed_expression: use the object form');
    value = { [value.name]: value };
  }
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) throw new Error('nested_projection');
  return Object.entries(value).map(([name, e]) => {
    if (!(e instanceof Expr) || e.mode !== mode || !e.ir.type) throw new Error(`invalid_expression_mode: ${name}`);
    return [name, e];
  });
}
export class GroupedQuery<R, K, C extends Caps = Caps> {
  readonly keys: readonly (readonly [string, Expr<unknown, string>])[];
  constructor(readonly input: Rel, keys: readonly (readonly [string, Expr<unknown, string>])[], readonly caps: C) {
    this.keys = Object.freeze(keys.map(([name, e]) => Object.freeze([name, e] as const)));
    Object.freeze(this.caps);
    Object.freeze(this);
  }
  aggregate<A extends AggregateProjection>(f: (row: GroupedInput<R>) => A & ValidNamed<A> & Unique<K, A>): Query<AggregateRow<K, A>, ExpressionCaps<C>> & { readonly row: OutputRow<K, A> } {
    const row = Object.freeze(Object.fromEntries(Object.entries(rowOf(this.input)).map(([name, e]) => [name, columnExpr({ type: e.ir.type! }, this.input.id, [name], name, 'grouped')])));
    const aggs = expressions(f(row as GroupedInput<R>), 'agg');
    const entries = [...this.keys, ...aggs];
    const output = flatOutput(entries.map(([name, e]) => [name, e.ir.type!]));
    const ir = relNode({ kind: 'Aggregate', input: this.input, keys: Object.fromEntries(this.keys.map(([k, e]) => [k, e.ir])), aggs: Object.fromEntries(aggs.map(([k, e]) => [k, e.ir])), columns: output.columns, output });
    return new Query(ir, { live: this.caps.live && entries.every(([, e]) => deterministic(e.ir)) }) as Query<AggregateRow<K, A>, ExpressionCaps<C>> & { readonly row: OutputRow<K, A> };
  }
}
type SortResult = Expr<unknown, string, 'row'> | Ordering<'row'>;
type ExpressionCaps<C extends Caps> = { readonly live: C['live'] extends false ? false : boolean };
function deterministic(e: ExprNode): boolean {
  switch (e.kind) {
    case 'ColumnRef': case 'Param': case 'Literal': return true;
    case 'Agg': return e.fn.deterministic === true && e.args.every(deterministic) && e.params.every(deterministic);
    case 'Call': return e.fn.deterministic === true && e.args.every(deterministic);
    case 'Cast': return deterministic(e.expr);
    default: return false;
  }
}
/** Removing the preceding Sort changes only its own row scope, never Params or foreign refs. */
function rebindSort(e: ExprNode, from: Rel, to: Rel): ExprNode {
  if (from === to) return e;
  const visit = (child: ExprNode) => rebindSort(child, from, to);
  switch (e.kind) {
    case 'ColumnRef': return e.rel === from.id ? exprNode({ kind: 'ColumnRef', rel: to.id, path: e.path, type: e.type, ...(e.mode === undefined ? {} : { mode: e.mode }) }) : e;
    case 'Call': case 'Agg': case 'Raw': {
      const args = e.args.map(visit);
      if (args.every((arg, i) => arg === e.args[i])) return e;
      const { id: _id, ...fields } = e;
      return exprNode({ ...fields, args });
    }
    case 'Cast': {
      const expr = visit(e.expr);
      return expr === e.expr ? e : exprNode({ kind: 'Cast', expr, type: e.type, to: e.to });
    }
    case 'Case': {
      const branches = e.branches.map(b => ({ when: visit(b.when), then: visit(b.then) }));
      const otherwise = visit(e.otherwise);
      return otherwise === e.otherwise && branches.every((b, i) => b.when === e.branches[i]!.when && b.then === e.branches[i]!.then) ? e : exprNode({ kind: 'Case', branches, otherwise, type: e.type });
    }
    default: return e;
  }
}
export function rowOf(rel: Rel): Readonly<Record<string, Expr<unknown, string>>> {
  if (rel.output.shape !== 'flat') throw new Error(`unsupported_output: ${rel.kind}#${rel.id}`);
  return Object.freeze(Object.fromEntries(rel.output.order.map(name => [name, columnExpr({ type: rel.output.shape === 'flat' ? rel.output.columns[name]! : { kind: 'Unknown', raw: '' } }, rel.id, [name], name, 'row')])));
}
export class Query<R, C extends Caps = Caps> {
  declare readonly _rowType: R;
  readonly row: Row<R>;
  constructor(readonly ir: Rel, readonly caps: C) {
    this.row = rowOf(ir) as Row<R>;
    Object.freeze(this.caps);
    Object.freeze(this);
  }
  where(predicate: (row: this['row']) => Expr<boolean | null, string, 'row'>): WithRow<Query<R, ExpressionCaps<C>>, this['row']> {
    const pred = predicate(this.row);
    if (!(pred instanceof Expr) || pred.mode !== 'row') throw new Error('invalid_predicate');
    return new Query(relNode({ kind: 'Filter', input: this.ir, pred: pred.ir, output: this.ir.output }), { live: this.caps.live && deterministic(pred.ir) }) as WithRow<Query<R, ExpressionCaps<C>>, this['row']>;
  }
  map<P extends Projection | Expr<unknown, string>>(projection: (row: this['row']) => P & ValidProjection<P>): Query<Infer<P>, ExpressionCaps<C>> & { readonly row: ProjectionRow<P> } {
    let result: Projection | Expr<unknown, string> = projection(this.row);
    if (result instanceof Expr) {
      if (result.name === undefined) throw new Error('unnamed_expression: use the object form');
      result = { [result.name]: result };
    }
    if (!result || typeof result !== 'object' || result instanceof Expr || Object.getOwnPropertySymbols(result).length) throw new Error('nested_projection');
    const entries = Object.entries(result);
    for (const [name, e] of entries) if (!(e instanceof Expr) || e.mode !== 'row' || !e.ir.type) throw new Error(`nested_projection or param_untyped: ${name}`);
    const output = flatOutput(entries.map(([name, e]) => [name, e.ir.type!]));
    const ir = relNode({ kind: 'Project', input: this.ir, exprs: Object.fromEntries(entries.map(([name, e]) => [name, e.ir])), columns: output.columns, output });
    return new Query(ir, { live: this.caps.live && entries.every(([, e]) => deterministic(e.ir)) }) as Query<Infer<P>, ExpressionCaps<C>> & { readonly row: ProjectionRow<P> };
  }
  groupBy<K extends Projection | Expr<unknown, string>>(f: (row: this['row']) => K & ValidProjection<K>): GroupedQuery<this['row'], K, C> {
    return new GroupedQuery(this.ir, expressions(f(this.row), 'row') as [string, Expr<unknown, string>][], this.caps);
  }
  aggregate<A extends AggregateProjection>(f: (row: GroupedInput<this['row']>) => A & ValidNamed<A>): Query<AggregateRow<{}, A>, ExpressionCaps<C>> & { readonly row: OutputRow<{}, A> } {
    return new GroupedQuery<this['row'], {}, C>(this.ir, [], this.caps).aggregate<A>(f);
  }
  arrayJoin<E extends Expr<readonly unknown[], string, 'row'>, A extends string>(f: (row: this['row']) => E, alias: A & (A extends keyof R ? { readonly duplicate_column: never } : unknown)): WithRow<Query<Expanded<R, E, A>, ExpressionCaps<C>>, ExpandedRow<this['row'], E, A>> {
    return this.expand<E, A>(f, alias, false);
  }
  leftArrayJoin<E extends Expr<readonly unknown[], string, 'row'>, A extends string>(f: (row: this['row']) => E, alias: A & (A extends keyof R ? { readonly duplicate_column: never } : unknown)): WithRow<Query<Expanded<R, E, A>, ExpressionCaps<C>>, ExpandedRow<this['row'], E, A>> {
    return this.expand<E, A>(f, alias, true);
  }
  private expand<E extends Expr<readonly unknown[], string>, A extends string>(f: (row: this['row']) => E, alias: A, left: boolean): WithRow<Query<Expanded<R, E, A>, ExpressionCaps<C>>, ExpandedRow<this['row'], E, A>> {
    const e = f(this.row);
    if (!(e instanceof Expr) || e.mode !== 'row' || e.ir.type?.kind !== 'Array') throw new Error('invalid_array_join_expression');
    if (typeof alias !== 'string' || alias.includes('\0')) throw new Error('invalid_array_join_alias');
    if (this.ir.output.shape !== 'flat') throw new Error('unsupported_output');
    if (Object.hasOwn(this.ir.output.columns, alias)) throw new Error(`duplicate_column: ${alias}`);
    const input = this.ir.output;
    const output = flatOutput([...input.order.map(name => [name, input.columns[name]!] as const), [alias, e.ir.type.inner]]);
    return new Query(relNode({ kind: 'ArrayJoin', input: this.ir, expr: e.ir, alias, left, columns: output.columns, output }), { live: this.caps.live && deterministic(e.ir) }) as WithRow<Query<Expanded<R, E, A>, ExpressionCaps<C>>, ExpandedRow<this['row'], E, A>>;
  }
  limit(n: number, offset?: number): WithRow<Query<R, C>, this['row']> {
    return new Query(relNode({ kind: 'Limit', input: this.ir, n, ...(offset === undefined ? {} : { offset }), output: this.ir.output }), this.caps) as WithRow<Query<R, C>, this['row']>;
  }
  distinct(): WithRow<Query<R, C>, this['row']> {
    return new Query(relNode({ kind: 'Distinct', input: this.ir, output: this.ir.output }), this.caps) as WithRow<Query<R, C>, this['row']>;
  }
  orderBy(f: (row: this['row']) => SortResult): WithRow<OrderedQuery<R, ExpressionCaps<C>>, this['row']> {
    const input = this instanceof OrderedQuery && this.ir.kind === 'Sort' ? this.ir.input : this.ir;
    return this.sort(input, f, []);
  }
  protected sort(input: Rel, f: (row: this['row']) => SortResult, keys: readonly SortKey[]): WithRow<OrderedQuery<R, ExpressionCaps<C>>, this['row']> {
    const value = f(this.row);
    if (!(value instanceof Ordering) && !(value instanceof Expr)) throw new Error('invalid_sort_expression');
    const ordering = value instanceof Ordering ? value : new Ordering(value, 'asc');
    if (!(ordering.expr instanceof Expr) || ordering.expr.mode !== 'row') throw new Error('invalid_sort_expression');
    const key = { expr: rebindSort(ordering.expr.ir, this.ir, input), dir: ordering.dir, ...(ordering.nulls === undefined ? {} : { nulls: ordering.nulls }) };
    return new OrderedQuery(relNode({ kind: 'Sort', input, keys: [...keys, key], output: input.output }), { live: this.caps.live && deterministic(key.expr) }) as WithRow<OrderedQuery<R, ExpressionCaps<C>>, this['row']>;
  }
  toSQL(): CompiledQuery {
    if (!compiler) throw new Error('compiler_not_registered: call registerCompiler(emitNaive) from @chql/compiler');
    return compiler(this.ir);
  }
}
/** No instance fields: the base constructor can freeze the complete wrapper. */
export class OrderedQuery<R, C extends Caps = Caps> extends Query<R, C> {
  thenBy(f: (row: this['row']) => SortResult): WithRow<OrderedQuery<R, ExpressionCaps<C>>, this['row']> {
    if (this.ir.kind !== 'Sort') throw new Error('invalid_sort');
    return this.sort(this.ir.input, f, this.ir.keys);
  }
}
/** Scan hints retain descriptor evidence without adding fields to the frozen wrapper. */
export class TableQuery<R, C extends Caps = Caps> extends Query<R, C> {
  final(): WithRow<TableQuery<R, C>, this['row']> { return this.hint({ final: true }); }
  sample(fraction: number): WithRow<TableQuery<R, C>, this['row']> { return this.hint({ sample: fraction }); }
  private hint(hint: { final?: boolean; sample?: number }): WithRow<TableQuery<R, C>, this['row']> {
    if (this.ir.kind !== 'Scan') throw new Error('invalid_scan_hint');
    const { id: _id, ...fields } = this.ir;
    return new TableQuery(relNode({ ...fields, ...hint }), this.caps) as WithRow<TableQuery<R, C>, this['row']>;
  }
}
type SourceLive<T extends TableDef> = T extends { readonly source: object } ? true : T['source'] extends undefined ? false : boolean;
export function from<T extends TableDef>(table: T): TableQuery<Infer<T>, { live: SourceLive<T> }> & { readonly row: DescribedRow<Infer<T>, T['columns']> } {
  const output = flatOutput(Object.entries(table.columns));
  return new TableQuery(relNode({ kind: 'Scan', table, columns: output.columns, output }), { live: table.source !== undefined }) as TableQuery<Infer<T>, { live: SourceLive<T> }> & { readonly row: DescribedRow<Infer<T>, T['columns']> };
}
