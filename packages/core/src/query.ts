import { expandedOutput, outputLeaves } from './output.js';
import { Ordering } from './ordering.js';
import { count } from './catalog/aggregate.js';
import { Expr, columnExpr } from './expr.js';
import {
  exprNode,
  flatOutput,
  relNode,
  type ExprNode,
  type FlatColumns,
  type Rel,
  type SortKey,
} from './ir.js';
import type { CHType } from './ch-type.js';
import type { TableDef } from './table.js';
import type { Infer, Row } from './types.js';
import { InsertCommand, type InsertRow, type ExactInsertRow } from './insert.js';

export interface Caps {
  readonly live: boolean;
}

export interface CompiledQuery {
  readonly sql: string;
  readonly params: Readonly<Record<string, string>>;
  /** Resolved placeholder descriptors, used to transport pre-serialized containers verbatim. */
  readonly parameterTypes?: Readonly<Record<string, CHType>>;
  readonly columns: FlatColumns;
  readonly columnPaths?: Readonly<Record<string, readonly string[]>>;
  readonly nodes: Readonly<Record<string, Rel>>;
}

export type QueryCompiler = (rel: Rel) => CompiledQuery;

let compiler: QueryCompiler | undefined;

/** Attach the compiler used by {@link Query.toSQL}; importing core alone loads no backend.
 * This replaces the process-local registration, not the compiler of a single query.
 * @example
 * ```ts
 * registerCompiler(compile); // compile from @typedhouse/compiler
 * ```
 */
export function registerCompiler(implementation: QueryCompiler): void {
  compiler = implementation;
}

export type IsLive<Q> = Q extends { readonly caps: infer C extends Caps } ? C['live'] : never;

type DescribedRow<R, D> = {
  readonly [K in keyof R]: Expr<R[K], K & string> & {
    readonly ir: ExprNode & {
      readonly type: K extends keyof D ? (D[K] extends CHType ? D[K] : CHType) : CHType;
    };
  };
};

type WithRow<Q, R> = Q & { readonly row: R };

export type Projection = Record<string, Expr<unknown, string, 'row'>>;

type ArrayValue<E> = E extends Expr<readonly (infer T)[], string> ? T : never;

type ArrayChild<E extends Expr<readonly unknown[], string>> = E['ir']['type'] extends {
  readonly kind: 'Array';
  readonly inner: infer D extends CHType;
}
  ? D
  : CHType;

type IsUnion<A, Whole = A> = A extends Whole ? ([Whole] extends [A] ? false : true) : never;

// Pattern indexes (including `${number}`) accept an empty record, unlike a
// concrete literal key. Union detection alone cannot distinguish these.
type OptionalAlias<A extends string> =
  true extends IsUnion<A> ? true : {} extends Record<A, unknown> ? true : false;

// Only a singleton alias is guaranteed to exist. A widened index must also
// admit every source value; intersecting a child-only index corrupts those fields.
type Expanded<R, E, A extends string> = string extends A
  ? R & Partial<Record<string, R[keyof R] | ArrayValue<E>>>
  : OptionalAlias<A> extends true
    ? R & Partial<Record<A, R[Extract<keyof R, A>] | ArrayValue<E>>>
    : { [K in keyof R | A]: K extends keyof R ? R[K] : ArrayValue<E> };

type ExpandedRow<R, E extends Expr<readonly unknown[], string>, A extends string> = string extends A
  ? R &
      Partial<
        Record<
          string,
          | R[keyof R]
          | (Expr<ArrayValue<E>, string> & {
              readonly ir: ExprNode & { readonly type: ArrayChild<E> };
            })
        >
      >
  : OptionalAlias<A> extends true
    ? R &
        Partial<{
          [K in A]:
            | R[Extract<keyof R, A>]
            | DescribedRow<{ [P in K]: ArrayValue<E> }, { [P in K]: ArrayChild<E> }>[K];
        }>
    : R & DescribedRow<{ [K in A]: ArrayValue<E> }, { [K in A]: ArrayChild<E> }>;

/** Reify descriptor intersections at projection boundaries, including tuple/array
 * children. Reusing ExprNode['type'] intersections accumulates distributive union
 * products across renamed arithmetic/join chains (TS2590). Keep erased CHType
 * opaque; reconstruct concrete evidence without changing its fields or unions. */
type ProjectDescriptor<D> = CHType extends D
  ? D
  : D extends object
    ? { [K in keyof D]: ProjectDescriptor<D[K]> }
    : D;

type ProjectRow<P extends Projection> = DescribedRow<
  Infer<P>,
  { [K in keyof P]: ProjectDescriptor<NonNullable<P[K]['ir']['type']>> }
>;

type NamedProjection<E extends Expr<unknown, string>> = { [K in E['name']]: E };

export type ValidProjection<P> =
  P extends Expr<unknown, string>
    ? [P['name']] extends [never]
      ? { readonly unnamed_expression: never }
      : unknown
    : unknown;

export type ProjectionRow<P extends Projection | Expr<unknown, string>> =
  P extends Expr<unknown, string>
    ? ProjectRow<NamedProjection<P>>
    : P extends Projection
      ? ProjectRow<P>
      : never;

type AggregateProjection =
  Record<string, Expr<unknown, string, 'agg'>> | Expr<unknown, string, 'agg'>;

type CountProjection = { count: ReturnType<typeof count> };

type Named<P> = P extends Expr<unknown, infer N, infer _M> ? { [K in N]: P } : P;

type FlatGroupedInput<R> = {
  readonly [K in keyof R]: R[K] extends Expr<infer T, infer N>
    ? Expr<T, N, 'grouped'> & { readonly ir: R[K]['ir'] }
    : never;
};

type NestedGroupedInput<R> = {
  readonly [K in keyof R]: R[K] extends Expr<infer T, infer N>
    ? Expr<T, N, 'grouped'> & { readonly ir: R[K]['ir'] }
    : NestedGroupedInput<R[K]>;
};

type GroupedInput<R, Nested extends boolean> = Nested extends true
  ? NestedGroupedInput<R>
  : FlatGroupedInput<R>;

type QueryGrouped<R, P, N extends boolean> = N extends true
  ? NestedGroupedInput<P>
  : {
      readonly [K in keyof R]: Expr<R[K], K & string, 'grouped'> & {
        readonly ir: K extends keyof P
          ? P[K] extends { readonly ir: infer I extends ExprNode }
            ? I
            : ExprNode
          : ExprNode;
      };
    };

type AggregateRow<K, A> = { [P in keyof (Infer<K> & Infer<A>)]: (Infer<K> & Infer<A>)[P] };

type OutputRow<K, A> = DescribedRow<
  AggregateRow<K, A>,
  {
    [P in keyof (Named<K> & Named<A>)]: (Named<K> & Named<A>)[P] extends { ir: { type: infer D } }
      ? ProjectDescriptor<D>
      : CHType;
  }
>;

type ValidNamed<P> = P extends { readonly name: infer N }
  ? [N] extends [never]
    ? { readonly unnamed_expression: never }
    : unknown
  : unknown;

type Unique<K, A> =
  Extract<keyof Named<K>, keyof Named<A>> extends never
    ? unknown
    : { readonly duplicate_column: never };

function expressions(
  value: unknown,
  mode: 'row' | 'agg',
): [string, Expr<unknown, string, typeof mode>][] {
  if (value instanceof Expr) {
    if (value.name === undefined) throw new Error('unnamed_expression: use the object form');
    value = { [value.name]: value };
  }

  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length)
    throw new Error('nested_projection');

  return Object.entries(value).map(([name, e]) => {
    if (!(e instanceof Expr) || e.mode !== mode || !e.ir.type)
      throw new Error(`invalid_expression_mode: ${name}`);

    return [name, e];
  });
}

/** A grouping specification awaiting `aggregate()` or `count()`.
 * Callbacks read the original input; grouping keys are retained in the final result.
 */
export class GroupedQuery<
  R,
  K,
  C extends Caps = Caps,
  Nested extends boolean = false,
  G = GroupedInput<R, Nested>,
> {
  readonly keys: readonly (readonly [string, Expr<unknown, string>])[];

  constructor(
    readonly input: Rel,
    keys: readonly (readonly [string, Expr<unknown, string>])[],
    readonly caps: C,
  ) {
    this.keys = Object.freeze(keys.map(([name, e]) => Object.freeze([name, e] as const)));
    Object.freeze(this.caps);
    Object.freeze(this);
  }

  /** Add grouping keys from the original input, without replacing earlier keys.
   * Key names must be unique across the whole grouping specification.
   * @example
   * ```ts
   * from(components).groupBy(c => c.entityId)
   *   .thenBy(c => ({ partCount: c.matched_part_ids.length() })).count();
   * ```
   */
  thenBy<P extends Projection | Expr<unknown, string>>(
    f: (row: R) => P & ValidProjection<P> & Unique<K, P>,
  ): GroupedQuery<R, Named<K> & Named<P>, C, Nested, G> {
    const added = expressions(f(rowOf(this.input) as R), 'row') as [
      string,
      Expr<unknown, string>,
    ][];

    const names = new Set(this.keys.map(([name]) => name));

    for (const [name] of added) {
      if (names.has(name)) throw new Error(`duplicate_column: ${name}`);
      names.add(name);
    }

    return new GroupedQuery(this.input, [...this.keys, ...added], this.caps);
  }

  /** Return grouping keys plus a UInt64 `count` column decoded as `bigint`.
   * Counts rows, not distinct values; a key named `count` conflicts with this shortcut.
   * Use `aggregate(() => ({ total: count() }))` to choose another name.
   * @example
   * ```ts
   * from(components).groupBy(c => ({ partCount: c.matched_part_ids.length() })).count();
   * ```
   */
  count(
    this: GroupedQuery<R, K, C, Nested, G> & Unique<K, CountProjection>,
  ): Query<AggregateRow<K, CountProjection>, ExpressionCaps<C>, OutputRow<K, CountProjection>> {
    // The receiver constraint enforces the same unique-alias rule as aggregate.
    return this.aggregate<CountProjection>(
      () => ({ count: count() }) as CountProjection & Unique<K, CountProjection>,
    );
  }

  /** Reduce each group and return its keys alongside the aggregate columns.
   * The callback exposes grouped input expressions: consume them with functions such
   * as `sum`, `max`, or `countIf`, rather than projecting them directly.
   * Aggregate names must not collide with grouping keys.
   * @example
   * ```ts
   * from(components).groupBy(c => ({ partCount: c.matched_part_ids.length() }))
   *   .aggregate(() => ({ total: count() }));
   * ```
   */
  aggregate<A extends AggregateProjection>(
    f: (row: G) => A & ValidNamed<A> & Unique<K, A>,
  ): Query<AggregateRow<K, A>, ExpressionCaps<C>, OutputRow<K, A>> {
    const row = rowOf(this.input, 'grouped');
    const aggs = expressions(f(row as G), 'agg');
    const entries = [...this.keys, ...aggs];
    const output = flatOutput(entries.map(([name, e]) => [name, e.ir.type!]));

    const ir = relNode({
      kind: 'Aggregate',
      input: this.input,
      keys: Object.fromEntries(this.keys.map(([k, e]) => [k, e.ir])),
      aggs: Object.fromEntries(aggs.map(([k, e]) => [k, e.ir])),
      columns: output.columns,
      output,
    });

    return new Query<AggregateRow<K, A>, ExpressionCaps<C>, OutputRow<K, A>>(ir, {
      live: this.caps.live && entries.every(([, e]) => deterministic(e.ir)),
    } as ExpressionCaps<C>);
  }
}

type SortResult = Expr<unknown, string, 'row'> | Ordering<'row'>;

/** One row-level key or several. A sort key (`asc()`, `desc()`) is not a LIMIT BY key. */
type LimitByKeys = Expr<unknown, string, 'row'> | readonly Expr<unknown, string, 'row'>[];

/** Whether an expression reads a column of its own row. A Subquery opens another scope, so it does not count. */
function readsRow(e: ExprNode): boolean {
  switch (e.kind) {
    case 'ColumnRef':
      return true;
    case 'Call':
    case 'Raw':
      return e.args.some(readsRow);
    case 'Agg':
      return [...e.args, ...e.params].some(readsRow);
    case 'Cast':
      return readsRow(e.expr);
    case 'Case':
      return e.branches.some(b => readsRow(b.when) || readsRow(b.then)) || readsRow(e.otherwise);
    default:
      return false;
  }
}

function limitCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('invalid_limit: expected a non-negative safe integer');

  return value;
}

export type ExpressionCaps<C extends Caps> = {
  readonly live: C['live'] extends false ? false : boolean;
};

/** Capabilities are recomputed through relation edges, never trusted from a Subquery flag. */
function liveRelation(rel: Rel, active: Set<Rel>): boolean {
  if (active.has(rel)) return false;
  active.add(rel);
  const expr = (e: ExprNode) => deterministic(e, active);
  const child = (r: Rel) => liveRelation(r, active);

  try {
    switch (rel.kind) {
      case 'Scan':
        return rel.table.source !== undefined;
      case 'Filter':
        return child(rel.input) && expr(rel.pred);
      case 'Project':
        return child(rel.input) && Object.values(rel.exprs).every(expr);
      case 'Aggregate':
        return (
          child(rel.input) && [...Object.values(rel.keys), ...Object.values(rel.aggs)].every(expr)
        );
      case 'Join':
        return rel.inputs.every(([, r]) => child(r)) && rel.on.every(expr);
      case 'Union':
        return rel.inputs.every(child);
      case 'Sort':
        return child(rel.input) && rel.keys.every(k => expr(k.expr));
      case 'ArrayJoin':
        return child(rel.input) && expr(rel.expr);
      case 'Limit':
      case 'Distinct':
      case 'Materialize':
        return child(rel.input);
      default:
        return false;
    }
  } finally {
    active.delete(rel);
  }
}

export function deterministic(e: ExprNode, active = new Set<Rel>()): boolean {
  switch (e.kind) {
    case 'ColumnRef':
    case 'Param':
    case 'Literal':
      return true;
    case 'Agg':
      return (
        e.fn.deterministic === true &&
        e.args.every(a => deterministic(a, active)) &&
        e.params.every(a => deterministic(a, active))
      );
    case 'Call':
      return e.fn.deterministic === true && e.args.every(a => deterministic(a, active));
    case 'Cast':
      return deterministic(e.expr, active);
    case 'Subquery':
      return (e.usage === 'scalar' || e.usage === 'in') && liveRelation(e.rel, active);
    default:
      return false;
  }
}

/** Removing the preceding Sort changes only its own row scope, never Params or foreign refs. */
export function rebindSort(e: ExprNode, from: Rel, to: Rel): ExprNode {
  if (from === to) return e;
  const visit = (child: ExprNode) => rebindSort(child, from, to);

  switch (e.kind) {
    case 'ColumnRef':
      return e.rel === from.id
        ? exprNode({
            kind: 'ColumnRef',
            rel: to.id,
            path: e.path,
            type: e.type,
            ...(e.mode === undefined ? {} : { mode: e.mode }),
          })
        : e;
    case 'Call':
    case 'Agg':
    case 'Raw': {
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

      return otherwise === e.otherwise &&
        branches.every((b, i) => b.when === e.branches[i]!.when && b.then === e.branches[i]!.then)
        ? e
        : exprNode({ kind: 'Case', branches, otherwise, type: e.type });
    }

    default:
      return e;
  }
}

export function rowOf(rel: Rel, mode: 'row' | 'grouped' = 'row'): unknown {
  function visit(output: Rel['output'], prefix: readonly string[]): unknown {
    if (output.shape === 'deferred') throw new Error(`unsupported_output: ${rel.kind}#${rel.id}`);

    return Object.freeze(
      Object.fromEntries(
        output.shape === 'nested'
          ? [
              ...output.inputs.map(([alias, child]) => [alias, visit(child, [...prefix, alias])]),
              ...Object.entries(output.fields ? (visit(output.fields, prefix) as object) : {}),
            ]
          : output.order.map(name => [
              name,
              columnExpr({ type: output.columns[name]! }, rel.id, [...prefix, name], name, mode),
            ]),
      ),
    );
  }

  return visit(rel.output, []);
}

/** An immutable query description, built with {@link from} or composition helpers.
 * Each operation returns a new query; callbacks build expressions, not JavaScript
 * computations over fetched rows. Compilation and execution are separate steps.
 */
export class Query<R, C extends Caps = Caps, Proxy = Row<R>, Nested extends boolean = false> {
  declare readonly _rowType: R;

  /** Expressions bound to this query's output, not fetched row values.
   * Prefer callback parameters when composing operations so references stay in scope.
   */
  readonly row: Proxy;

  constructor(
    readonly ir: Rel,
    readonly caps: C,
  ) {
    this.row = rowOf(ir) as Proxy;
    Object.freeze(this.caps);
    Object.freeze(this);
  }

  /** Keep rows for which the predicate is true; false and NULL are discarded.
   * Columns remain unchanged. After aggregation, the callback sees aggregate results.
   * @example
   * ```ts
   * from(components).where(c => c.matched_part_ids.notEmpty());
   * ```
   */
  where(
    predicate: (row: this['row']) => Expr<boolean | null, string, 'row'>,
  ): Query<R, ExpressionCaps<C>, this['row'], Nested> {
    const pred = predicate(this.row);
    if (!(pred instanceof Expr) || pred.mode !== 'row') throw new Error('invalid_predicate');

    return new Query(
      relNode({ kind: 'Filter', input: this.ir, pred: pred.ir, output: this.ir.output }),
      { live: this.caps.live && deterministic(pred.ir) } as ExpressionCaps<C>,
    );
  }

  /** Select or rename columns into a flat output row.
   * A single named expression keeps its name; use an object for aliases or unnamed
   * expressions such as `val(3n)`. Nested objects and aggregate expressions are not projections.
   * @example
   * ```ts
   * from(components).map(c => ({ id: c.entityId, partCount: c.matched_part_ids.length() }));
   * ```
   */
  map<P extends Projection | Expr<unknown, string>>(
    projection: (row: this['row']) => P & ValidProjection<P>,
  ): Query<Infer<P>, ExpressionCaps<C>, ProjectionRow<P>> {
    let result: Projection | Expr<unknown, string> = projection(this.row);

    if (result instanceof Expr) {
      if (result.name === undefined) throw new Error('unnamed_expression: use the object form');
      result = { [result.name]: result };
    }

    if (
      !result ||
      typeof result !== 'object' ||
      result instanceof Expr ||
      Object.getOwnPropertySymbols(result).length
    )
      throw new Error('nested_projection');

    const entries = Object.entries(result);

    for (const [name, e] of entries)
      if (!(e instanceof Expr) || e.mode !== 'row' || !e.ir.type)
        throw new Error(`nested_projection or param_untyped: ${name}`);

    const output = flatOutput(entries.map(([name, e]) => [name, e.ir.type!]));

    const ir = relNode({
      kind: 'Project',
      input: this.ir,
      exprs: Object.fromEntries(entries.map(([name, e]) => [name, e.ir])),
      columns: output.columns,
      output,
    });

    return new Query<Infer<P>, ExpressionCaps<C>, ProjectionRow<P>>(ir, {
      live: this.caps.live && entries.every(([, e]) => deterministic(e.ir)),
    } as ExpressionCaps<C>);
  }

  /** Start a grouping specification; finish it with `aggregate()` or `count()`.
   * Return one named expression or an object of keys. Grouping alone does not produce
   * a query result; `thenBy()` on the grouped builder adds further keys, not sorting.
   * @example
   * ```ts
   * from(components).groupBy(c => ({ partCount: c.matched_part_ids.length() })).count();
   * ```
   */
  groupBy<K extends Projection | Expr<unknown, string>>(
    f: (row: this['row']) => K & ValidProjection<K>,
  ): GroupedQuery<this['row'], K, C, Nested, QueryGrouped<R, this['row'], Nested>> {
    return new GroupedQuery(
      this.ir,
      expressions(f(this.row), 'row') as [string, Expr<unknown, string>][],
      this.caps,
    );
  }

  /** Count all input rows, including the effect of preceding filters and limits.
   * Returns a one-column aggregate query: `{ count: bigint }`, with `0n` for empty input.
   * This builds a query; it does not fetch a JavaScript number.
   * @example
   * ```ts
   * from(components).where(c => c.matched_part_ids.notEmpty()).count();
   * ```
   */
  count(): Query<
    AggregateRow<{}, CountProjection>,
    ExpressionCaps<C>,
    OutputRow<{}, CountProjection>
  > & { readonly ir: Extract<Rel, { kind: 'Aggregate' }> } {
    return this.aggregate(() => ({ count: count() }));
  }

  /** Aggregate the entire input without grouping keys.
   * The callback receives grouped expressions and must return aggregate expressions,
   * either as a named expression or a flat object. Use `groupBy()` for per-key results.
   * @example
   * ```ts
   * from(components).aggregate(c => ({ total: count(), matched: countIf(c.matched_part_ids.notEmpty()) }));
   * ```
   */
  aggregate<A extends AggregateProjection>(
    f: (row: QueryGrouped<R, this['row'], Nested>) => A & ValidNamed<A>,
  ): Query<AggregateRow<{}, A>, ExpressionCaps<C>, OutputRow<{}, A>> & {
    readonly ir: Extract<Rel, { kind: 'Aggregate' }>;
  } {
    return new GroupedQuery<this['row'], {}, C, Nested, QueryGrouped<R, this['row'], Nested>>(
      this.ir,
      [],
      this.caps,
    ).aggregate<A>(f) as Query<AggregateRow<{}, A>, ExpressionCaps<C>, OutputRow<{}, A>> & {
      readonly ir: Extract<Rel, { kind: 'Aggregate' }>;
    };
  }

  /**
   * Expand an array into one row per element, exposed under `alias`.
   * Original columns are retained; rows with empty arrays are dropped.
   * Use `leftArrayJoin` to retain rows with empty arrays.
   *
   * @example Expand an array of part IDs and select each element.
   * ```ts
   * from(components)
   *   .arrayJoin(c => c.matched_part_ids, 'partId')
   *   .map(c => ({ componentId: c.entityId, partId: c.partId }));
   * ```
   *
   * @example Expand an array of named tuples and read a tuple field.
   * ```ts
   * from(components)
   *   .arrayJoin(c => c.part_specifications, 'part')
   *   .map(c => ({ componentId: c.entityId, mpn: c.part.element('mpn') }));
   * ```
   *
   * @param f Select an array expression from the input row.
   * @param alias Name for the element column; must not shadow an existing column.
   */
  arrayJoin<E extends Expr<readonly unknown[], string, 'row'>, A extends string>(
    f: (row: this['row']) => E,
    alias: A & (A extends keyof R ? { readonly duplicate_column: never } : unknown),
  ): WithRow<
    Query<Expanded<R, E, A>, ExpressionCaps<C>, ExpandedRow<this['row'], E, A>, Nested>,
    ExpandedRow<this['row'], E, A>
  > {
    return this.expand<E, A>(f, alias, false);
  }

  /** Expand an array while retaining rows whose arrays are empty.
   * Empty arrays contribute one element with ClickHouse's default for the element
   * type (for example `''` or `0`), not NULL unless the element type is nullable.
   * Original columns are retained; use `arrayJoin()` to drop empty arrays instead.
   * @example
   * ```ts
   * from(components).leftArrayJoin(c => c.matched_part_ids, 'partId')
   *   .map(c => ({ componentId: c.entityId, partId: c.partId }));
   * ```
   * @param f Select the array to expand.
   * @param alias Element column name; must not shadow an existing column.
   */
  leftArrayJoin<E extends Expr<readonly unknown[], string, 'row'>, A extends string>(
    f: (row: this['row']) => E,
    alias: A & (A extends keyof R ? { readonly duplicate_column: never } : unknown),
  ): WithRow<
    Query<Expanded<R, E, A>, ExpressionCaps<C>, ExpandedRow<this['row'], E, A>, Nested>,
    ExpandedRow<this['row'], E, A>
  > {
    return this.expand<E, A>(f, alias, true);
  }

  private expand<E extends Expr<readonly unknown[], string>, A extends string>(
    f: (row: this['row']) => E,
    alias: A,
    left: boolean,
  ): WithRow<
    Query<Expanded<R, E, A>, ExpressionCaps<C>, ExpandedRow<this['row'], E, A>, Nested>,
    ExpandedRow<this['row'], E, A>
  > {
    const e = f(this.row);

    if (!(e instanceof Expr) || e.mode !== 'row' || e.ir.type?.kind !== 'Array')
      throw new Error('invalid_array_join_expression');

    if (typeof alias !== 'string' || alias.includes('\0'))
      throw new Error('invalid_array_join_alias');

    const output = expandedOutput(this.ir.output, alias, e.ir.type.inner);
    const columns = Object.fromEntries(outputLeaves(output).map(leaf => [leaf.name, leaf.type]));

    return new Query(
      relNode({ kind: 'ArrayJoin', input: this.ir, expr: e.ir, alias, left, columns, output }),
      { live: this.caps.live && deterministic(e.ir) },
    ) as WithRow<
      Query<Expanded<R, E, A>, ExpressionCaps<C>, ExpandedRow<this['row'], E, A>, Nested>,
      ExpandedRow<this['row'], E, A>
    >;
  }

  /** Take at most `n` rows after skipping `offset` rows (zero by default).
   * Use an explicit ordering, including tie breakers, when the chosen rows matter;
   * a limit alone does not define a stable page.
   * @example
   * ```ts
   * from(components).orderBy(c => c.entityId).limit(20, 40);
   * ```
   */
  limit(n: number, offset?: number): Query<R, C, this['row'], Nested> {
    return new Query(
      relNode({
        kind: 'Limit',
        input: this.ir,
        n,
        ...(offset === undefined ? {} : { offset }),
        output: this.ir.output,
      }),
      this.caps,
    );
  }

  /** Start a per-key limit; finish it with `take()`, optionally followed by `offset()`.
   * Return one key or an array of keys; each must read a column of the row, and a key need
   * not be selected. NULL is one group. Float keys group by bit pattern: NaNs with the same bit
   * pattern form one group, and `0.0` and `-0.0` are separate groups. Sort first, with a tie
   * breaker: without a total order, which rows of a group survive is unspecified.
   * @example
   * ```ts
   * from(components).orderBy(c => c.updatedAt.desc()).limitBy(c => c.entityId).take(3);
   * ```
   */
  limitBy(by: (row: this['row']) => LimitByKeys): LimitByBuilder<R, this['row'], Nested> {
    const value: unknown = by(this.row);
    const keys: readonly unknown[] = Array.isArray(value) ? value : [value];
    if (!keys.length) throw new Error('invalid_limit_by_key: expected at least one key');

    for (const key of keys) {
      if (!(key instanceof Expr) || key.mode !== 'row')
        throw new Error('invalid_limit_by_key: expected a row expression');

      // `LIMIT 1 BY 2` is positional on the server, and a constant puts every row in one group.
      if (!readsRow(key.ir))
        throw new Error('invalid_limit_by_key: a key must read a column of the row');
    }

    return new LimitByBuilder(
      this.ir,
      (keys as readonly Expr<unknown, string, 'row'>[]).map(key => key.ir),
    );
  }

  /** Request an ordinary common table expression without changing the row shape.
   * This is not an execution cache or a materialized result: ClickHouse may inline
   * and evaluate each use independently.
   * @example
   * ```ts
   * const matched = from(components).where(c => c.matched_part_ids.notEmpty()).cte();
   * const ids = matched.map(c => c.entityId);
   * ```
   */
  cte(): Query<R, C, this['row'], Nested> {
    return new Query(
      relNode({ kind: 'Materialize', input: this.ir, output: this.ir.output }),
      this.caps,
    );
  }

  /** Remove duplicate output rows, comparing all currently selected columns.
   * Project first to deduplicate only the columns you need; this does not choose
   * a representative row for a subset of keys.
   * @example
   * ```ts
   * from(components).map(c => ({ partCount: c.matched_part_ids.length() })).distinct();
   * ```
   */
  distinct(): Query<R, C, this['row'], Nested> {
    return new Query(
      relNode({ kind: 'Distinct', input: this.ir, output: this.ir.output }),
      this.caps,
    );
  }

  /** Sort by one expression, ascending unless `.desc()` is specified.
   * Replaces the current ordering when called directly on an ordered query;
   * use `thenBy()` to append tie breakers. After another operation, this starts
   * a new ordering at that operation's output.
   * @example
   * ```ts
   * from(components).orderBy(c => c.matched_part_ids.length().desc()).thenBy(c => c.entityId);
   * ```
   */
  orderBy(
    f: (row: this['row']) => SortResult,
  ): OrderedQuery<R, ExpressionCaps<C>, this['row'], Nested> {
    const input = this instanceof OrderedQuery && this.ir.kind === 'Sort' ? this.ir.input : this.ir;
    return this.sort(input, f, []);
  }

  protected sort(
    input: Rel,
    f: (row: this['row']) => SortResult,
    keys: readonly SortKey[],
  ): OrderedQuery<R, ExpressionCaps<C>, this['row'], Nested> {
    const value = f(this.row);

    if (!(value instanceof Ordering) && !(value instanceof Expr))
      throw new Error('invalid_sort_expression');

    const ordering = value instanceof Ordering ? value : new Ordering(value, 'asc');

    if (!(ordering.expr instanceof Expr) || ordering.expr.mode !== 'row')
      throw new Error('invalid_sort_expression');

    const key = {
      expr: rebindSort(ordering.expr.ir, this.ir, input),
      dir: ordering.dir,
      ...(ordering.nulls === undefined ? {} : { nulls: ordering.nulls }),
    };

    return new OrderedQuery(
      relNode({ kind: 'Sort', input, keys: [...keys, key], output: input.output }),
      { live: this.caps.live && deterministic(key.expr) },
    ) as OrderedQuery<R, ExpressionCaps<C>, this['row'], Nested>;
  }

  /** Compile this query into SQL, bound parameters, and output descriptors.
   * Does not contact ClickHouse. Register a compiler first, or use the compiler's
   * standalone `compile(query.ir)` entry point.
   * @example
   * ```ts
   * registerCompiler(compile); // compile from @typedhouse/compiler
   * const { sql, params } = from(components).map(c => c.entityId).toSQL();
   * ```
   * @throws If no compiler has been registered, or the query fails compilation.
   */
  toSQL(): CompiledQuery {
    if (!compiler)
      throw new Error(
        'compiler_not_registered: call registerCompiler(emitNaive) from @typedhouse/compiler',
      );

    return compiler(this.ir);
  }
}

/** A query with an active ordering; `thenBy()` adds tie breakers.
 * Operations such as `where()` and `map()` return ordinary queries, so add sort keys
 * before those operations or start a new `orderBy()` afterward.
 */
export class OrderedQuery<
  R,
  C extends Caps = Caps,
  Proxy = Row<R>,
  Nested extends boolean = false,
> extends Query<R, C, Proxy, Nested> {
  /** Append a sort key after the existing keys; a bare expression sorts ascending.
   * Unlike `orderBy()`, this preserves earlier keys and their precedence.
   * @example
   * ```ts
   * from(components).orderBy(c => c.matched_part_ids.length().desc()).thenBy(c => c.entityId);
   * ```
   */
  thenBy(
    f: (row: this['row']) => SortResult,
  ): OrderedQuery<R, ExpressionCaps<C>, this['row'], Nested> {
    if (this.ir.kind !== 'Sort') throw new Error('invalid_sort');
    return this.sort(this.ir.input, f, this.ir.keys);
  }
}

/** A per-key limit awaiting `take()`. It is not a query: it has no other method, and it builds nothing yet. */
export class LimitByBuilder<R, Proxy = Row<R>, Nested extends boolean = false> {
  readonly #input: Rel;

  readonly #keys: readonly ExprNode[];

  constructor(input: Rel, keys: readonly ExprNode[]) {
    this.#input = input;
    this.#keys = Object.freeze([...keys]);
    Object.freeze(this);
  }

  /** Keep at most `n` rows per distinct key tuple. `n` is a non-negative safe integer.
   * @example
   * ```ts
   * from(events).limitBy(e => e.category).take(10);
   * ```
   */
  take(n: number): LimitByQuery<R, { readonly live: false }, Proxy, Nested> {
    return new LimitByQuery(
      relNode({
        kind: 'LimitBy',
        input: this.#input,
        n: limitCount(n),
        keys: this.#keys,
        output: this.#input.output,
      }),
      { live: false },
    );
  }
}

/** A query whose last step is `limitBy(...).take(n)`; `offset()` is available directly after `take()`.
 * Every other operation returns an ordinary query, so it cannot add an offset later.
 */
export class LimitByQuery<
  R,
  C extends Caps = Caps,
  Proxy = Row<R>,
  Nested extends boolean = false,
> extends Query<R, C, Proxy, Nested> {
  /** Skip the first `m` rows of each key group before taking. `m` is a non-negative safe integer.
   * @example
   * ```ts
   * from(events).limitBy(e => e.category).take(10).offset(20);
   * ```
   */
  offset(m: number): Query<R, C, this['row'], Nested> {
    if (this.ir.kind !== 'LimitBy') throw new Error('invalid_limit_by');

    return new Query(
      relNode({
        kind: 'LimitBy',
        input: this.ir.input,
        n: this.ir.n,
        offset: limitCount(m),
        keys: this.ir.keys,
        output: this.ir.output,
      }),
      this.caps,
    );
  }
}

/** A direct table scan with `final()` and `sample()` hints and an explicit `prewhere()`.
 * Apply them before filtering, projecting, or other query operations.
 */
export class TableQuery<R, C extends Caps = Caps, Proxy = Row<R>> extends Query<R, C, Proxy> {
  /** Apply ClickHouse FINAL to this scan, using the table engine's merge semantics.
   * For example, ReplacingMergeTree resolves competing versions at query time.
   * This does not mutate the table or force background merges; engine support is required.
   * @example
   * ```ts
   * from(components).final().map(c => c.entityId);
   * ```
   */
  final(): TableQuery<R, C, this['row']> {
    return this.hint({ final: true });
  }

  /** Apply a ClickHouse SAMPLE fraction to this scan.
   * Requires a table with a supported sampling key; this is not a random LIMIT.
   * Apply before other query operations. The fraction must be finite and in (0, 1].
   * @example
   * ```ts
   * from(components).sample(0.1).count(); // table must support SAMPLE
   * ```
   */
  sample(fraction: number): TableQuery<R, C, this['row']> {
    return this.hint({ sample: fraction });
  }

  /** Filter this scan with an explicit ClickHouse PREWHERE, which reads the predicate's columns first.
   * Same predicate type as `where()`. Call it after `final()` and `sample()`, before anything else.
   * The compiler never infers, moves, splits or drops it. Engine support is checked by the server.
   *
   * With `final()` it filters before merging, so a predicate on a non-key column can return a stale
   * row version that `where()`, which filters after merging, would not. Prefer sorting-key columns there.
   * @example
   * ```ts
   * from(components).prewhere(c => c.tenantId.eq('acme')).where(c => c.matched_part_ids.notEmpty());
   * ```
   */
  prewhere(
    predicate: (row: this['row']) => Expr<boolean | null, string, 'row'>,
  ): Query<R, { readonly live: false }, this['row']> {
    if (this.ir.kind !== 'Scan') throw new Error('invalid_prewhere_source');
    const pred = predicate(this.row);
    if (!(pred instanceof Expr) || pred.mode !== 'row') throw new Error('invalid_predicate');

    return new Query(
      relNode({ kind: 'Prewhere', input: this.ir, pred: pred.ir, output: this.ir.output }),
      { live: false },
    );
  }

  private hint(hint: { final?: boolean; sample?: number }): TableQuery<R, C, this['row']> {
    if (this.ir.kind !== 'Scan') throw new Error('invalid_scan_hint');
    const { id: _id, ...fields } = this.ir;
    return new TableQuery(relNode({ ...fields, ...hint }), this.caps);
  }
}

type SourceLive<T extends TableDef> = T extends { readonly source: object }
  ? true
  : T['source'] extends undefined
    ? false
    : boolean;

/** Start a query over a table descriptor without reading data.
 * All declared columns are available as expressions in subsequent callbacks.
 * Scan-only hints such as `final()` and `sample()` belong immediately after `from()`.
 * @example
 * ```ts
 * from(components).where(c => c.matched_part_ids.notEmpty()).map(c => c.entityId);
 * ```
 */
export class FromQuery<T extends TableDef> extends TableQuery<
  Infer<T>,
  { live: SourceLive<T> },
  DescribedRow<Infer<T>, T['columns']>
> {
  insertMany<R extends readonly InsertRow<T>[]>(
    rows: R & readonly ExactInsertRow<R[number], InsertRow<T>>[],
  ): InsertCommand {
    if (this.ir.kind !== 'Scan' || this.ir.final !== undefined || this.ir.sample !== undefined)
      throw new Error('invalid_insert_source');

    return InsertCommand.create(
      this.ir.table,
      rows as readonly Readonly<Record<string, unknown>>[],
    );
  }
}

export function from<T extends TableDef>(table: T): FromQuery<T> {
  const output = flatOutput(Object.entries(table.columns));

  return new FromQuery<T>(relNode({ kind: 'Scan', table, columns: output.columns, output }), {
    live: table.source !== undefined,
  } as { live: SourceLive<T> });
}
