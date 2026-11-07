import {
  containsAggregateState,
  isNullable,
  print,
  quoteString,
  scalarDescriptor,
  outputLeaves,
  expandedOutput,
  joinOutput,
  nullExtended,
  outerColumnType,
  type CHType,
  type CompiledQuery,
  type ExprNode,
  type Rel,
} from '@typedhouse/core';
import type { SqlPlan } from './plan-selects.js';
import { parameterExpression, parameterWireType, serializeParameter } from './parameters.js';
import { resolveAggregate, resolveCall, resolveCast } from './resolve.js';
import { resolveRaw } from './resolve-raw.js';

import { peelSettings } from './settings.js';
import { validateStructure } from './validate-structure.js';
import { references, totalExpression, totalPredicate } from './rewrite-expressions.js';
import { ValidationError } from './validation-error.js';
export { ValidationError } from './validation-error.js';

export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name.includes('\0')) throw new Error('invalid_identifier');
  return '`' + name.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`';
}

const same = (a: CHType, b: CHType) => print(a) === print(b);

function hasAggregate(e: ExprNode): boolean {
  return (
    e.kind === 'Agg' ||
    (e.kind === 'Call' && e.args.some(hasAggregate)) ||
    (e.kind === 'Cast' && hasAggregate(e.expr))
  );
}

function base(t: CHType): CHType {
  return t.kind === 'Nullable' || t.kind === 'LowCardinality' ? base(t.inner) : t;
}

/** Inequality operands the server's ASOF accepts, measured on 24.3, 24.8 and 26.10. Everything else
 * raises code 169 alone, and 386 or 43 against another type; a LowCardinality on both sides raises 169. */
function asofOperand(t: CHType): { readonly supported: boolean; readonly lowCardinality: boolean } {
  switch (t.kind) {
    case 'Nullable':
    case 'SimpleAggregateFunction':
      return asofOperand(t.inner);
    case 'LowCardinality':
      return { ...asofOperand(t.inner), lowCardinality: true };
    case 'DateTime':
    case 'DateTime64':
    case 'Decimal':
    case 'Enum':
      return { supported: true, lowCardinality: false };
    case 'scalar':
      return {
        supported: /^(U?Int(8|16|32|64|128|256)|Float(32|64)|Bool|Date|Date32|DateTime)$/.test(
          t.name,
        ),
        lowCardinality: false,
      };
    default:
      return { supported: false, lowCardinality: false };
  }
}

const isState = (t: CHType | null | undefined): boolean => !!t && containsAggregateState(t);

const joinKeywords = {
  inner: 'INNER ALL JOIN',
  left: 'LEFT ALL JOIN',
  right: 'RIGHT ALL JOIN',
  full: 'FULL ALL JOIN',
  cross: 'CROSS JOIN',
} as const;

const joinKeyword = (join: Extract<Rel, { kind: 'Join' }>): string =>
  join.strictness === 'asof'
    ? join.joinKind === 'left'
      ? 'ASOF LEFT JOIN'
      : 'ASOF INNER JOIN'
    : joinKeywords[join.joinKind];

/** Kinds whose null-extended input set contains this kind's: LeftToInner keeps the Join's
 * output when it stops extending an input, so an inner Join may carry a left/right/full
 * output, a left or right Join a full one. The builder only produces the kind's own. */
const outputKinds = {
  inner: ['inner', 'left', 'right', 'full'],
  left: ['left', 'full'],
  right: ['right', 'full'],
  full: ['full'],
  cross: ['cross'],
} as const;

/** Kinds the Decided row keeps unwrapped by null extension, also under `SimpleAggregateFunction`. A
 * declared `Nullable(Tuple)` is not one, and `LowCardinality` cannot hold either (code 43). A parser
 * `Unknown` is not one either, although the read would not use its text: `Point`, `Tuple(... Point ...)`
 * and `JSON(...)` measured safe, but the documented limit is pinned, so widening is an owner decision. */
function keepsDefault(t: CHType): boolean {
  switch (t.kind) {
    case 'Tuple':
      return true;
    case 'scalar':
      return t.name === 'JSON';
    case 'SimpleAggregateFunction':
      return keepsDefault(t.inner);
    default:
      return false;
  }
}

/** The column's own type without the Nullable that join_use_nulls adds, as constant text. */
const physicalTypeName = (sql: string) =>
  `replaceRegexpOne(toTypeName(${sql}), ${quoteString('(?s)^Nullable\\((.*)\\)$')}, ${quoteString('\\1')})`;

/** A join input column read where the Join's output declares it null-extended but the Join no
 * longer extends that input (after LeftToInner): toNullable gives exactly outerColumnType's
 * descriptor on 24.8 (scalars, LowCardinality, SimpleAggregateFunction alike), so expression
 * types and server `meta` keep matching the descriptors. Never applied to ON conditions. */
function joinRead(
  join: Extract<Rel, { kind: 'Join' }>,
  alias: string,
  sql: string,
  declared: CHType,
  physical: CHType,
  bare = false,
): string {
  const index = join.inputs.findIndex(([a]) => a === alias);

  // D21: a Tuple or JSON keeps its type and its default when unmatched (Decided, outer join row types),
  // but under join_use_nulls = 1 the server wraps it in Nullable and sends NULL, Tuple from 26.3 and JSON
  // from 25.3. The default and the CAST take the type from the column itself, never from the descriptor,
  // so a descriptor that lags the table cannot change a matched row: ifNull alone unifies its branches into
  // a supertype that drops LowCardinality members, SimpleAggregateFunction and Point, and the CAST restores
  // the column's type. Measured on 24.3 to 26.10; the identity on rows where the column is not NULL.
  if (nullExtended(join.joinKind, index, join.inputs.length)) {
    if (!keepsDefault(declared)) return sql;
    const type = physicalTypeName(sql);
    return `CAST(ifNull(${sql}, defaultValueOfTypeName(${type})), ${type})`;
  }

  if (same(declared, physical)) return sql;

  // Fix round 1 (m3): a WHERE or ORDER BY over total expressions exposes no type, and every value read here is
  // non-NULL, so the column is read bare: KeyCondition and PREWHERE see the key as a hand-written INNER join does.
  if (bare) {
    if (!same(declared, outerColumnType(physical)))
      throw new ValidationError(
        'invalid_output',
        declared,
        'join',
        `${print(declared)} does not null-extend ${print(physical)}`,
      );

    return sql;
  }

  if (!same(declared, outerColumnType(physical)))
    throw new ValidationError(
      'invalid_output',
      declared,
      'join',
      `${print(declared)} does not null-extend ${print(physical)}`,
    );

  return `toNullable(${sql})`;
}

/** Permanent one-subquery-per-node reference backend. Unsupported IR is rejected. */
export function emitNaive(root: Rel): CompiledQuery {
  const { input, settings } = peelSettings(root);
  return emitQuery(input, undefined, settings);
}

/** Transitional validation adapter: reuse the reference backend's complete checks.
 * Its SQL is discarded.
 */
export function validateRel(root: Rel): CompiledQuery {
  return emitQuery(root);
}

export function emitPlanned(plan: SqlPlan, settings: readonly string[] = []): CompiledQuery {
  return emitQuery(plan.root, plan, settings);
}

function emitQuery(root: Rel, plan?: SqlPlan, userSettings: readonly string[] = []): CompiledQuery {
  // Planned emission follows validateRel; preflight once per public compilation.
  if (!plan) validateStructure(root);
  const rendered = new Map<Rel, string>();
  const clauses = new Map<Rel, string>();
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  const parameterTypes: Record<string, CHType> = Object.create(null) as Record<string, CHType>;
  const nodes: Record<string, Rel> = Object.create(null) as Record<string, Rel>;
  const assigned = new Map<ExprNode, { name: string; type: CHType }>();
  const active = new Set<Rel>();
  let cteIndex = 0;
  let weekBucketing = false;
  let dateMembership = false;
  let outerJoin = false;
  // Set while rendering a total WHERE conjunct or ORDER BY key over a join block (see joinRead).
  let bareJoinReads = false;

  const bare = <T>(on: boolean, render: () => T): T => {
    const previous = bareJoinReads;
    bareJoinReads = on;

    try {
      return render();
    } finally {
      bareJoinReads = previous;
    }
  };

  // Each derived input owns this local SQL scope; ColumnRefs never bind SELECT aliases.
  const inputAlias = quoteIdentifier(plan?.ctes?.inputAlias ?? '__typedhouse_input');
  const defined = new Set<Rel>();

  const joinAlias = (rel: Rel, alias: string) =>
    quoteIdentifier(plan?.ctes?.aliases.get(rel)?.get(alias) ?? alias);

  // A physical-table block has no competing input or SELECT aliases. Derived
  // scopes retain qualification; logical ColumnRef binding stays unchanged.
  function blockQualifier(rel: Rel): string {
    const source = plan?.blocks.get(rel)?.source;
    if (source?.kind === 'cte') return quoteIdentifier(plan!.ctes!.names.get(source.rel)!);
    return source?.kind === 'table' ? '' : inputAlias;
  }

  function fail(code: string, node: unknown, path: string, detail = ''): never {
    throw new ValidationError(code, node, path, detail);
  }

  function resolvedType(e: ExprNode, expected?: CHType): CHType {
    if (e.kind === 'Subquery') {
      if (e.usage !== 'scalar') throw new Error('invalid_subquery_usage');
      const type = scalarDescriptor(e.rel);
      if (!same(type, e.type)) throw new Error('invalid_expression_type');
      return type;
    }

    if (e.kind === 'Raw') return resolveRaw(e, resolvedType);
    if (e.kind === 'Cast') return resolveCast(e, resolvedType);
    if (e.kind === 'Agg') return resolveAggregate(e, resolvedType).result;
    if (e.kind === 'Call') return resolveCall(e, resolvedType).result;
    const type = e.type ?? expected;
    if (!type) throw new Error('param_untyped');

    return e.kind === 'Param' && e.value === null && type.kind !== 'Nullable'
      ? { kind: 'Nullable', inner: type }
      : type;
  }

  function expression(
    e: ExprNode,
    input: Rel,
    path: string,
    expected?: CHType,
    index = false,
    scope: 'row' | 'aggregate' | 'operand' = 'row',
    qualifier = inputAlias,
    binding?: Extract<Rel, { kind: 'Join' }>,
  ): string {
    if (!e || typeof e !== 'object') return fail('invalid_expression', e, path);

    switch (e.kind) {
      case 'ColumnRef': {
        if (
          scope === 'aggregate' ||
          (e.mode === 'grouped' && scope !== 'operand') ||
          (e.mode === 'row' && scope === 'operand')
        )
          return fail('invalid_expression_mode', e, path);

        const scopeId =
          !binding && qualifier === '' && input.kind === 'Join'
            ? (input.scope ?? input.id)
            : input.id;

        if (e.rel !== scopeId)
          return fail('unbound_column', e, path, `reference ${e.rel}, input ${scopeId}`);

        const leaf = outputLeaves(input.output).find(
          l => JSON.stringify(l.path) === JSON.stringify(e.path),
        );

        if (!leaf || !same(e.type, leaf.type))
          return fail('unbound_column', e, path, JSON.stringify(e.path));

        if (binding || (qualifier === '' && input.kind === 'Join')) {
          const join = binding ?? input;
          if (join.kind !== 'Join') return fail('unbound_column', e, path);
          const side = join.inputs.find(([alias]) => alias === e.path[0]);

          const child =
            side &&
            (plan?.columns?.get(side[1]) ?? outputLeaves(side[1].output)).find(
              l => JSON.stringify(l.path) === JSON.stringify(e.path.slice(1)),
            );

          if (!side || !child) return fail('unbound_column', e, path);
          const sql = `${joinAlias(join, side[0])}.${quoteIdentifier(child.name)}`;
          return binding ? joinRead(join, side[0], sql, leaf.type, child.type, bareJoinReads) : sql;
        }

        const physical = plan?.columns?.get(input);

        if (physical && !physical.some(l => l.name === leaf.name))
          return fail('missing_physical_column', e, path);

        return `${qualifier ? `${qualifier}.` : ''}${quoteIdentifier(leaf.name)}`;
      }

      case 'Param': {
        const type = e.type ?? expected;
        if (!type) return fail('param_untyped', e, path);

        if (expected && !same(base(type), base(expected)))
          return fail('param_incompatible', e, path);

        let value: string;

        try {
          value = serializeParameter(
            index && typeof e.value === 'number' && Number.isSafeInteger(e.value)
              ? BigInt(e.value)
              : e.value,
            type,
          );
        } catch (error) {
          return fail('param_incompatible', e, path, String(error));
        }

        const previous = assigned.get(e);

        if (previous && !same(previous.type, type))
          return fail('param_incompatible', e, path, 'same Param used with different types');

        // Bare NULL is Nullable(Nothing), losing the operand's common-type evidence.
        if (e.value === null) return `CAST(NULL AS ${print(type)})`;
        const name = previous?.name ?? `p${assigned.size}`;
        assigned.set(e, { name, type });
        params[name] = value;
        parameterTypes[name] = parameterWireType(type);
        return parameterExpression(name, type);
      }

      case 'Subquery': {
        if (scope !== 'row') return fail('invalid_expression_mode', e, path);

        try {
          resolvedType(e);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid_subquery', e, path);
        }

        // Same allocator/active graph, but emit establishes a fresh inner column scope.
        return `(${emit(e.rel, `${path}.rel`)})`;
      }

      case 'Raw': {
        if (scope !== 'row') return fail('invalid_expression_mode', e, path);

        try {
          resolveRaw(e, resolvedType);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid_raw_expression', e, path);
        }

        let text = e.parts[0]!;

        for (let i = 0; i < e.args.length; i++)
          text += `(${expression(e.args[i]!, input, `${path}.args[${i}]`, undefined, false, 'row', qualifier, binding)})${e.parts[i + 1]!}`;

        return `(${text})`;
      }

      case 'Cast': {
        let target: CHType;

        try {
          target = resolveCast(e, resolvedType);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid_cast', e, path);
        }

        // The operand retains its own descriptor/Param identity and original scope.
        return `CAST(${expression(e.expr, input, `${path}.expr`, undefined, false, scope, qualifier, binding)} AS ${print(target)})`;
      }

      case 'Agg': {
        if (scope !== 'aggregate') return fail('invalid_aggregate_placement', e, path);
        let resolved: ReturnType<typeof resolveAggregate>;

        try {
          resolved = resolveAggregate(e, resolvedType);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid_aggregate', e, path);
        }

        const parameters = e.params.length
          ? `(${e.params.map((p, i) => expression(p, input, `${path}.params[${i}]`, undefined, false, 'operand', qualifier, binding)).join(', ')})`
          : '';

        const args = e.args.map((a, i) =>
          expression(
            a,
            input,
            `${path}.args[${i}]`,
            undefined,
            false,
            'operand',
            qualifier,
            binding,
          ),
        );

        // On ClickHouse 24.8, minIf/maxIf over UInt, Float, Date and DateTime values can count a row whose
        // computed predicate is NULL. Collapsing NULL to false excludes it for every value type.
        if (
          e.fn.origin === 'typed' &&
          (e.fn.name === 'min' || e.fn.name === 'max') &&
          e.combinators[0] === 'If' &&
          isNullable(resolvedType(e.args[e.args.length - 1]!))
        ) {
          args[args.length - 1] = `ifNull(${args[args.length - 1]!}, false)`;
        }

        return `${resolved.sqlName}${parameters}(${args.join(', ')})`;
      }

      case 'Call': {
        let resolved: ReturnType<typeof resolveCall>;

        try {
          resolved = resolveCall(e, resolvedType);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid_call', e, path);
        }

        const args = e.args.map((arg, i) => {
          // Only the authoritative membership resolver grants this set position.
          if (
            e.fn.origin === 'typed' &&
            (e.fn.name === 'in' || e.fn.name === 'notIn') &&
            i === 1 &&
            arg.kind === 'Subquery'
          ) {
            return `(${emit(arg.rel, `${path}.args[${i}].rel`)})`;
          }

          return expression(
            arg,
            input,
            `${path}.args[${i}]`,
            resolved.types[i],
            e.fn.origin === 'typed' &&
              e.fn.name === 'arrayElement' &&
              i === 1 &&
              arg.kind === 'Param' &&
              arg.type === null,
            scope,
            qualifier,
            binding,
          );
        });

        if (e.fn.origin === 'known') return `${resolved.sqlName}(${args.join(', ')})`;

        if (e.fn.name === 'in' || e.fn.name === 'notIn') {
          const receiver = resolved.types[0]!;
          const base = receiver.kind === 'Nullable' ? receiver.inner : receiver;
          if (base.kind === 'scalar' && base.name === 'Date') dateMembership = true;
        }

        // Parenthesize every operand: planned children may be infix expressions.
        // The catalog resolver has already checked arity, families and repeatability.
        if (e.fn.name === 'between') return `((${args[0]}) BETWEEN (${args[1]}) AND (${args[2]}))`;

        if (e.fn.name === 'toStartOfWeek') {
          weekBucketing = true;
          // Date32 preserves pre-epoch weeks for the explicit range check. Converting
          // to Date first would silently clamp/wrap. toDate32 retains the input's
          // calendar timezone; Date output represents that day at UTC midnight.
          const week = `toStartOfWeek(toDate32(${args[0]}), 0)`;
          return `addDays(toDate(${week}), throwIf(ifNull((${week} < toDate32('1970-01-01')) OR (${week} > toDate32('2149-06-06')), 0), 'typedhouse_date_out_of_range'))`;
        }

        if (plan) {
          const operators: Record<string, readonly [string, number]> = {
            or: ['OR', 1],
            and: ['AND', 2],
            eq: ['=', 3],
            ne: ['!=', 3],
            lt: ['<', 3],
            le: ['<=', 3],
            gt: ['>', 3],
            ge: ['>=', 3],
            plus: ['+', 4],
            minus: ['-', 4],
            multiply: ['*', 5],
            divide: ['/', 5],
          };

          const operator = operators[e.fn.name];

          if (operator)
            return args
              .map((sql, i) => {
                const child = e.args[i]!;

                const inner =
                  child.kind === 'Call' && child.fn.origin === 'typed'
                    ? operators[child.fn.name]
                    : undefined;

                // Preserve the expression tree, including floating point association.
                return inner &&
                  (inner[1] < operator[1] ||
                    (inner[1] === operator[1] &&
                      (operator[1] === 3 || (i > 0 && operator[1] >= 4))))
                  ? `(${sql})`
                  : sql;
              })
              .join(` ${operator[0]} `);
        }

        // Slice 4e: over a LowCardinality(Nullable(T)) receiver 24.8 keeps LowCardinality only for a constant
        // fallback; toLowCardinality (idempotent) pins the catalog's LowCardinality result for any other one.
        if (
          e.fn.name === 'ifNull' &&
          resolved.result.kind === 'LowCardinality' &&
          resolved.types[0]!.kind === 'LowCardinality' &&
          isNullable(resolved.types[0]!) &&
          e.args[1]!.kind !== 'Param'
        )
          return `toLowCardinality(ifNull(${args.join(', ')}))`;

        // Retain the permanent naive equality SQL contract.
        return e.fn.name === 'eq'
          ? `(${args[0]} = ${args[1]})`
          : `${resolved.sqlName}(${args.join(', ')})`;
      }

      default:
        return fail('unsupported_expression', e, path, e.kind);
    }
  }

  /** The server compares binary state contents where the row model has no value to compare (`WHERE total = total`,
   * `ORDER BY total`, `uniqExact(total)`), so a read is rejected unless it finalizes: a `-Merge`, whose function
   * `resolveAggregate` matches, or a known-tier or trusted call, whose result is the caller's declaration. */
  function stateOperands(e: ExprNode, path: string, top = false): void {
    if (!e || typeof e !== 'object') return;

    if (e.kind === 'Subquery') {
      if (outputLeaves(e.rel.output).some(l => isState(l.type)))
        fail('aggregate_state_selection', e, `${path}.rel`);

      return;
    }

    if (!top && isState(e.type)) fail('aggregate_state_operand', e, path);

    const finalizes =
      e.kind === 'Raw' ||
      ((e.kind === 'Call' || e.kind === 'Agg') && e.fn.origin === 'known') ||
      (e.kind === 'Agg' && e.combinators.length === 1 && e.combinators[0] === 'Merge');

    const operands = e.kind === 'Cast' ? [e.expr] : 'args' in e ? e.args : [];

    operands.forEach((operand, i) => {
      // Only a column read directly finalizes: `sumMerge(total.ifNull(total))` still reads the bytes.
      if (!finalizes || operand.kind !== 'ColumnRef')
        stateOperands(operand, `${path}.${e.kind === 'Cast' ? 'expr' : `args[${i}]`}`);
    });
  }

  function checkStateReads(rel: Rel, leaves: readonly { type: CHType }[], path: string): void {
    switch (rel.kind) {
      case 'Project':
        // A bare column carries the state on. An Agg here is a placement error, reported by its renderer.
        for (const [k, e] of Object.entries(rel.exprs ?? {}))
          if (e?.kind !== 'ColumnRef' && e?.kind !== 'Agg') stateOperands(e, `${path}.exprs.${k}`);

        break;
      case 'Filter':
      case 'Prewhere':
        stateOperands(rel.pred, `${path}.pred`);
        break;
      case 'Sort':
        rel.keys?.forEach((k, i) => stateOperands(k?.expr, `${path}.keys[${i}].expr`));
        break;
      case 'LimitBy':
        rel.keys?.forEach((k, i) => stateOperands(k, `${path}.keys[${i}]`));
        break;
      case 'ArrayJoin':
        stateOperands(rel.expr, `${path}.expr`);
        break;
      case 'Join':
        rel.on?.forEach((e, i) => stateOperands(e, `${path}.on[${i}]`));
        break;
      case 'Aggregate':
        for (const [k, e] of Object.entries(rel.keys ?? {})) stateOperands(e, `${path}.keys.${k}`);

        for (const [k, e] of Object.entries(rel.aggs ?? {}))
          stateOperands(e, `${path}.aggs.${k}`, true);

        break;
      case 'Distinct':
        if (leaves.some(l => isState(l.type))) fail('aggregate_state_operand', rel, path);
        break;
      case 'Union':
        if (rel.all === false && leaves.some(l => isState(l.type)))
          fail('aggregate_state_operand', rel, path);

        break;
    }
  }

  const scanHints = (scan: Extract<Rel, { kind: 'Scan' }>) =>
    `${scan.final ? ' FINAL' : ''}${scan.sample === undefined ? '' : ` SAMPLE ${scan.sample}`}`;

  /** Clause-level AND has the same precedence as expression-level AND. Only
   * planned OR is non-atomic here; naive calls retain their permanent spelling. */
  function conjunction(predicates: readonly { expr: ExprNode; sql: string }[]): string {
    return predicates
      .map(({ expr, sql }) =>
        plan &&
        predicates.length > 1 &&
        expr.kind === 'Call' &&
        expr.fn.origin === 'typed' &&
        expr.fn.name === 'or'
          ? `(${sql})`
          : sql,
      )
      .join(' AND ');
  }

  const limitClause = (node: { readonly n: number; readonly offset?: number }) =>
    `LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`;

  /** Physical occurrences retain source order and full child transport paths. */
  function joinSource(
    join: Extract<Rel, { kind: 'Join' }>,
    path: string,
    separator: string,
  ): string {
    if (join.joinKind !== 'inner' && join.joinKind !== 'cross') outerJoin = true;
    const conditions = join.inputs.map(() => [] as ExprNode[]);

    for (const e of join.on) {
      if (e.kind !== 'Call') return fail('invalid_join_condition', e, path);

      const indices = e.args.map(a =>
        a.kind === 'ColumnRef' ? join.inputs.findIndex(([alias]) => alias === a.path[0]) : -1,
      );

      const position = Math.max(...indices);
      if (position < 1) return fail('join_condition_arity', e, path);
      conditions[position]!.push(e);
    }

    return join.inputs
      .map(([alias, child], i) => {
        const cte = plan?.ctes?.names.get(child);
        if (cte && !defined.has(child)) return fail('cte_visibility', child, path);
        const full = outputLeaves(child.output);
        const physical = plan?.columns?.get(child) ?? full;

        const source = cte
          ? quoteIdentifier(cte)
          : child.kind === 'Scan' && physical.length === full.length
            ? quoteIdentifier(child.table.name)
            : `(${emit(child, `${path}.inputs[${i}]`)})`;

        const hints =
          !cte && child.kind === 'Scan' && physical.length === full.length
            ? `${child.final ? ' FINAL' : ''}${child.sample === undefined ? '' : ` SAMPLE ${child.sample}`}`
            : '';

        const on =
          i && join.joinKind !== 'cross'
            ? ` ON ${conditions[i]!.map((e, j) => expression(e, join, `${path}.on[${j}]`, undefined, false, 'row', '')).join(' AND ')}`
            : '';

        return `${i ? `${separator}${joinKeyword(join)} ` : ''}${source} AS ${joinAlias(join, alias)}${hints}${on}`;
      })
      .join('');
  }

  /** Written once, after FROM and any ARRAY JOIN and before WHERE. Qualified, so that no SELECT alias can capture a column. */
  function prewhereClause(
    node: Extract<Rel, { kind: 'Prewhere' }> | undefined,
    path: string,
  ): string {
    return node
      ? ` PREWHERE ${expression(node.pred, node.input, `${path}.source.pred`, undefined, false, 'row', inputAlias)}`
      : '';
  }

  function renderBlock(rel: Rel, physicalOrder: readonly string[], path = 'root'): string {
    const block = plan!.blocks.get(rel)!;
    const binding = block.source.kind === 'join' ? block.source.rel : undefined;
    const separator = binding && rel === root ? '\n' : ' ';
    const select = block.distinct ? 'SELECT DISTINCT ' : 'SELECT ';
    // DISTINCT applies to the Distinct node's full leaf set: a clause folded above it may be
    // pruned narrower by its consumer, and that demand must never become the DISTINCT list.
    // Every node folded above a Distinct keeps that set (a whole-row selection may reorder it).
    const distinctLeaves = block.distinct ? outputLeaves(rel.output) : undefined;
    const order = distinctLeaves?.map(l => l.name) ?? physicalOrder;

    if (block.aggregate) {
      const aggregate = block.aggregate;
      const expansion = block.arrayJoin;
      // An expanded block has no input alias: the expansion alias is a plain column of the FROM item.
      const qualifier = block.source.kind === 'cte' || expansion ? '' : inputAlias;

      // SELECT precedes even a derived FROM in final textual parameter order.
      // Qualify source references; HAVING/ORDER deliberately use output aliases.
      // Fix round 2 (D2): over a join block, a total key groups by its bare reads of converted columns, and its select
      // item wraps the whole key (`toNullable(b.e) AS e`, idempotent on Nullable/LowCardinality(Nullable)). Every select
      // item and every HAVING/ORDER BY alias reference then reads the grouping expression itself, or, when the alias binds
      // a same-named column under prefer_column_name_to_alias = 1, the grouped column itself.
      const keys = Object.entries(aggregate.keys).map(([name, e]) => {
        const keyPath = `${path}.keys.${name}`;

        const wrapped = expression(
          e,
          aggregate.input,
          keyPath,
          undefined,
          false,
          'row',
          qualifier,
          binding,
        );

        if (!binding || !totalExpression(e)) return [name, wrapped, wrapped] as const;

        const group = bare(true, () =>
          expression(e, aggregate.input, keyPath, undefined, false, 'row', qualifier, binding),
        );

        const declared = resolvedType(e);

        const carriesNull =
          declared.kind === 'Nullable' ||
          (declared.kind === 'LowCardinality' && declared.inner.kind === 'Nullable');

        return [
          name,
          group === wrapped ? wrapped : carriesNull ? `toNullable(${group})` : group,
          group,
        ] as const;
      });

      const items = [
        ...keys.map(([name, sql]) =>
          sql === quoteIdentifier(name) ? sql : `${sql} AS ${quoteIdentifier(name)}`,
        ),
        ...Object.entries(aggregate.aggs).map(
          ([name, e]) =>
            `${expression(e, aggregate.input, `${path}.aggs.${name}`, undefined, false, 'aggregate', qualifier, binding)} AS ${quoteIdentifier(name)}`,
        ),
      ];

      const hints = block.source.kind === 'table' ? scanHints(block.source.scan) : '';

      const source =
        block.source.kind === 'table'
          ? (expansion
              ? `${quoteIdentifier(block.source.scan.table.name)}${block.source.prewhere ? ` AS ${inputAlias}` : ''}${hints} ${expansion.left ? 'LEFT ' : ''}ARRAY JOIN ${expression(expansion.expr, expansion.input, `${path}.expr`, undefined, false, 'row', '')} AS ${quoteIdentifier(expansion.alias)}`
              : `${quoteIdentifier(block.source.scan.table.name)} AS ${inputAlias}${hints}`) +
            prewhereClause(block.source.prewhere, path)
          : block.source.kind === 'join'
            ? joinSource(block.source.rel, path, separator)
            : block.source.kind === 'cte'
              ? quoteIdentifier(plan!.ctes!.names.get(block.source.rel)!)
              : `(${emit(block.source.rel, `${path}.source`)}) AS ${inputAlias}`;

      const where = (block.where ?? []).map((node, i) => {
        if (node.kind !== 'Filter') throw new Error('invalid_aggregate_where');

        return {
          expr: node.pred,
          sql: bare(!!binding && totalPredicate(node.pred), () =>
            expression(
              node.pred,
              node.input,
              `${path}.where[${i}]`,
              undefined,
              false,
              'row',
              qualifier,
              binding,
            ),
          ),
        };
      });

      const having: { expr: ExprNode; sql: string }[] = [],
        tails: string[] = [];

      for (const [i, node] of block.clauses.entries()) {
        const p = `${path}.clauses[${i}]`;

        if (node.kind === 'Filter')
          having.push({
            expr: node.pred,
            sql: expression(node.pred, node.input, `${p}.pred`, undefined, false, 'row', ''),
          });
        else if (node.kind === 'Sort')
          tails.push(
            ` ORDER BY ${node.keys.map((k, j) => `${expression(k.expr, node.input, `${p}.keys[${j}]`, undefined, false, 'row', '')} ${k.dir.toUpperCase()}${k.nulls === undefined ? '' : ` NULLS ${k.nulls.toUpperCase()}`}`).join(', ')}`,
          );
        else if (node.kind === 'LimitBy')
          tails.push(
            ` ${limitClause(node)} BY ${node.keys.map((k, j) => expression(k, node.input, `${p}.keys[${j}]`, undefined, false, 'row', '')).join(', ')}`,
          );
        else
          tails.push(
            ` LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`,
          );
      }

      return `${select}${items.join(', ')}${separator}FROM ${source}${where.length ? `${separator}WHERE ${conjunction(where)}` : ''}${keys.length ? `${separator}GROUP BY ${keys.map(([, , group]) => group).join(', ')}` : ''}${having.length ? `${separator}HAVING ${conjunction(having)}` : ''}${tails.map(t => separator + t.slice(1)).join('')}`;
    }

    if (binding) {
      const selected = distinctLeaves ?? plan?.columns?.get(rel) ?? outputLeaves(rel.output);

      const items = selected.map(leaf => {
        if (block.project) {
          const e = block.project.exprs[leaf.name]!;
          return `${expression(e, block.project.input, `${path}.exprs.${leaf.name}`, undefined, false, 'row', inputAlias, binding)} AS ${quoteIdentifier(leaf.name)}`;
        }

        const side = binding.inputs.find(([alias]) => alias === leaf.path[0])!;

        const child = outputLeaves(side[1].output).find(
          l => JSON.stringify(l.path) === JSON.stringify(leaf.path.slice(1)),
        )!;

        return `${joinRead(binding, side[0], `${joinAlias(binding, side[0])}.${quoteIdentifier(child.name)}`, leaf.type, child.type)} AS ${quoteIdentifier(leaf.name)}`;
      });

      const source = joinSource(binding, path, separator);

      const predicates: string[] = [],
        tails: string[] = [];

      for (const node of block.clauses) {
        if (node.kind === 'Filter')
          predicates.push(
            `(${bare(totalPredicate(node.pred), () => expression(node.pred, node.input, path, undefined, false, 'row', inputAlias, binding))})`,
          );
        else if (node.kind === 'Sort')
          tails.push(
            `${separator}ORDER BY ${node.keys.map(k => `${bare(totalExpression(k.expr), () => expression(k.expr, node.input, path, undefined, false, 'row', inputAlias, binding))} ${k.dir.toUpperCase()}${k.nulls ? ` NULLS ${k.nulls.toUpperCase()}` : ''}`).join(', ')}`,
          );
        else if (node.kind === 'LimitBy')
          tails.push(
            `${separator}${limitClause(node)} BY ${node.keys.map(k => bare(totalExpression(k), () => expression(k, node.input, path, undefined, false, 'row', inputAlias, binding))).join(', ')}`,
          );
        else
          tails.push(
            `${separator}LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`,
          );
      }

      return `${select}${items.join(', ')}${separator}FROM ${source}${predicates.length ? `${separator}WHERE ${predicates.join(' AND ')}` : ''}${tails.join('')}`;
    }

    // Allocate projection Params before WHERE Params, matching textual SQL order.
    const qualifier = blockQualifier(rel);

    const items = order.map(k =>
      block.project
        ? `${expression(block.project.exprs[k]!, block.project.input, `${path}.exprs.${k}`, undefined, false, 'row', qualifier)} AS ${quoteIdentifier(k)}`
        : `${qualifier ? `${qualifier}.` : ''}${quoteIdentifier(k)}`,
    );

    let from: string;

    if (block.source.kind === 'table') {
      const scan = block.source.scan;
      // Bare select items must be columns the pruned scan provides (or the expansion alias).
      const physical = plan!.columns?.get(scan);

      if (physical && !block.project)
        for (const k of order)
          if (k !== block.arrayJoin?.alias && !physical.some(l => l.name === k))
            return fail('missing_physical_column', rel, path, k);

      from = `${quoteIdentifier(scan.table.name)}${block.source.prewhere ? ` AS ${inputAlias}` : ''}${scanHints(scan)}`;
      // FINAL/SAMPLE precede ARRAY JOIN; the user alias is a plain column of the block.
      const expansion = block.arrayJoin;

      if (expansion)
        from += ` ${expansion.left ? 'LEFT ' : ''}ARRAY JOIN ${expression(expansion.expr, expansion.input, `${path}.expr`, undefined, false, 'row', qualifier)} AS ${quoteIdentifier(expansion.alias)}`;

      from += prewhereClause(block.source.prewhere, path);
    } else if (block.source.kind === 'cte') {
      if (!defined.has(block.source.rel)) return fail('cte_visibility', block.source.rel, path);
      from = quoteIdentifier(plan!.ctes!.names.get(block.source.rel)!);
    } else {
      from = `(${emit(block.source.rel, `${path}.source`)}) AS ${inputAlias}`;
    }

    // Render only the final block, in textual order. Never eagerly emit folded
    // children: their discarded SELECTs could allocate Params out of order.
    const predicates: { expr: ExprNode; sql: string }[] = [];
    const tails: string[] = [];

    for (const [i, node] of block.clauses.entries()) {
      const p = `${path}.clauses[${i}]`;

      if (node.kind === 'Filter')
        predicates.push({
          expr: node.pred,
          sql: expression(node.pred, node.input, `${p}.pred`, undefined, false, 'row', qualifier),
        });
      else if (node.kind === 'Sort')
        tails.push(
          ` ORDER BY ${node.keys.map((key, j) => `${expression(key.expr, node.input, `${p}.keys[${j}].expr`, undefined, false, 'row', qualifier)} ${key.dir.toUpperCase()}${key.nulls === undefined ? '' : ` NULLS ${key.nulls.toUpperCase()}`}`).join(', ')}`,
        );
      else if (node.kind === 'LimitBy')
        tails.push(
          ` ${limitClause(node)} BY ${node.keys.map((key, j) => expression(key, node.input, `${p}.keys[${j}]`, undefined, false, 'row', qualifier)).join(', ')}`,
        );
      else
        tails.push(` LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`);
    }

    const where = predicates.length ? ` WHERE ${conjunction(predicates)}` : '';
    const tail = tails.join('');
    return `${select}${items.join(', ')} FROM ${from}${where}${tail}`;
  }

  function emit(rel: Rel, path: string): string {
    const name = plan?.ctes?.names.get(rel);

    if (name) {
      if (!defined.has(rel)) return fail('cte_visibility', rel, path);
      const leaves = plan?.columns?.get(rel) ?? outputLeaves(rel.output);
      return `SELECT ${leaves.map(l => `${quoteIdentifier(name)}.${quoteIdentifier(l.name)}`).join(', ')} FROM ${quoteIdentifier(name)}`;
    }

    const sql = emitNode(rel, path);
    rendered.set(rel, sql);
    return sql;
  }

  function emitNode(rel: Rel, path: string): string {
    if (!rel || typeof rel !== 'object') return fail('invalid_node', rel, path);
    if (active.has(rel)) return fail('cyclic_ir', rel, path);
    active.add(rel);

    try {
      if (rel.output.shape === 'deferred') return fail('unsupported_output', rel, path);
      const leaves = outputLeaves(rel.output);
      const columns = Object.fromEntries(leaves.map(l => [l.name, l.type]));
      const order = leaves.map(l => l.name);
      // Logical validation uses the full schema; SELECT lists use the explicit
      // physical interface, whose names retain full-schema transport ordinals.
      const physical = plan?.columns?.get(rel) ?? leaves;
      const physicalOrder = physical.map(l => l.name);

      if (
        new Set(order).size !== order.length ||
        order.length !== Object.keys(columns).length ||
        order.some(k => !Object.hasOwn(columns, k))
      )
        return fail('invalid_output', rel, path);

      // Only the query result is decoded: a raw state there is binary in a JSON string, and invalid UTF-8 is lost.
      if (rel === root && order.some(k => isState(columns[k]!)))
        return fail('aggregate_state_selection', rel, path);

      checkStateReads(rel, leaves, path);
      nodes[path] = rel;
      const list = physicalOrder.map(quoteIdentifier).join(', ');
      if (plan?.blocks.has(rel)) return renderBlock(rel, physicalOrder, path);

      switch (rel.kind) {
        case 'Union': {
          if (!Array.isArray(rel.inputs) || rel.inputs.length < 2)
            return fail('union_input_count', rel, `${path}.inputs`);

          if (typeof rel.all !== 'boolean') return fail('invalid_union_mode', rel, `${path}.all`);

          const branches = rel.inputs.map((child, i) => {
            const childPath = `${path}.inputs[${i}]`;
            // Emit each branch independently: malformed scopes cannot hide behind a matching schema.
            const source = emit(child, childPath);
            const childLeaves = outputLeaves(child.output);

            if (
              i === 0 &&
              JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !==
                JSON.stringify(childLeaves.map(l => [l.path, print(l.type)]))
            )
              return fail(
                'invalid_output',
                rel,
                path,
                'Union output must match first input order and descriptors',
              );

            if (childLeaves.length !== leaves.length)
              return fail('union_schema_mismatch', rel, `${childPath}.output`);

            const items = leaves.map(leaf => {
              const actual = childLeaves.find(
                candidate => JSON.stringify(candidate.path) === JSON.stringify(leaf.path),
              );

              if (!actual)
                return fail(
                  'union_schema_mismatch',
                  rel,
                  `${childPath}.output`,
                  JSON.stringify(leaf.path),
                );

              if (!same(actual.type, leaf.type))
                return fail(
                  'union_descriptor_mismatch',
                  rel,
                  `${childPath}.output`,
                  JSON.stringify(leaf.path),
                );

              return `${inputAlias}.${quoteIdentifier(actual.name)} AS ${quoteIdentifier(leaf.name)}`;
            });

            return `SELECT ${items.join(', ')} FROM (${source}) AS ${inputAlias}`;
          });

          return branches.join(rel.all ? ' UNION ALL ' : ' UNION DISTINCT ');
        }

        case 'Join': {
          if (!Object.hasOwn(joinKeywords, rel.joinKind))
            return fail('unsupported_join', rel, path);

          const outer = rel.joinKind !== 'inner' && rel.joinKind !== 'cross';
          if (!Array.isArray(rel.on)) return fail('invalid_join_condition', rel, `${path}.on`);

          const strictness: unknown = rel.strictness;
          const asof = strictness !== undefined;

          if (asof) {
            if (strictness !== 'asof')
              return fail('invalid_asof_condition', rel, `${path}.strictness`, 'expected asof');

            if ((rel.joinKind !== 'inner' && rel.joinKind !== 'left') || rel.inputs.length !== 2)
              return fail(
                'invalid_asof_condition',
                rel,
                path,
                'ASOF is INNER or LEFT, over exactly two inputs',
              );

            if (rel.on.length < 2)
              return fail(
                'invalid_asof_condition',
                rel,
                `${path}.on`,
                'ASOF needs at least one equality and the inequality',
              );
          }

          if (rel.joinKind === 'cross' && rel.on.length)
            return fail(
              'join_condition_arity',
              rel,
              `${path}.on`,
              'CROSS JOIN has no ON condition',
            );

          if (
            !Array.isArray(rel.inputs) ||
            rel.inputs.length < 2 ||
            new Set(rel.inputs.map(([a]) => a)).size !== rel.inputs.length
          )
            return fail('join_input_count', rel, `${path}.inputs`);

          // No rule rewrites an ASOF kind, so its output is its own kind's.
          if (
            !(asof ? [rel.joinKind] : outputKinds[rel.joinKind]).some(
              kind => JSON.stringify(joinOutput(kind, rel.inputs)) === JSON.stringify(rel.output),
            )
          )
            return fail('invalid_output', rel, path);

          const clauses = rel.inputs.map(() => [] as { e: ExprNode; path: string }[]);
          const residuals: { e: ExprNode; path: string }[] = [];
          const join = rel;

          function sides(e: ExprNode, p: string): Set<number> {
            if (e.kind === 'ColumnRef') {
              if (e.rel !== (join.scope ?? join.id)) return fail('unbound_column', e, p);
              const index = join.inputs.findIndex(([a]) => a === e.path[0]);
              if (index < 0) return fail('unbound_column', e, p);
              return new Set([index]);
            }

            if (e.kind === 'Call')
              return new Set(e.args.flatMap((a, i) => [...sides(a, `${p}.args[${i}]`)]));

            if (e.kind === 'Param') return new Set();

            if (asof && e.kind === 'Literal') return new Set();
            if (asof && e.kind === 'Cast') return sides(e.expr, `${p}.expr`);

            if (asof && e.kind === 'Raw')
              return new Set(e.args.flatMap((a, i) => [...sides(a, `${p}.args[${i}]`)]));

            return fail('join_condition_arity', e, p);
          }

          if (asof) {
            const at = rel.on.length - 1;
            const last: ExprNode = rel.on[at]!;
            const p = `${path}.on[${at}]`;

            if (
              last.kind !== 'Call' ||
              last.fn.origin !== 'typed' ||
              !['ge', 'gt', 'le', 'lt'].includes(last.fn.name)
            )
              return fail('invalid_asof_condition', last, p, 'the last element is the inequality');

            const read = (a: ExprNode | undefined, i: number): readonly number[] => {
              try {
                return a ? [...sides(a, `${p}.args[${i}]`)] : [];
              } catch (error) {
                // A form `sides` cannot follow (Case, Subquery) gives this condition's own code.
                if (error instanceof ValidationError && error.code === 'join_condition_arity')
                  return [];

                throw error;
              }
            };

            const left = read(last.args[0], 0),
              right = read(last.args[1], 1);

            if (
              last.args.length !== 2 ||
              left.length !== 1 ||
              right.length !== 1 ||
              left[0] === right[0]
            )
              return fail(
                'invalid_asof_condition',
                last,
                p,
                'the inequality reads one input on each side',
              );

            let types: readonly CHType[];

            try {
              types = last.args.map(a => resolvedType(a));
            } catch (error) {
              return fail(error instanceof Error ? error.message : 'invalid_call', last, p);
            }

            const operands = types.map(asofOperand);

            if (!operands.every(o => o.supported))
              return fail('invalid_asof_type', last, p, types.map(print).join(', '));

            if (operands.every(o => o.lowCardinality))
              return fail(
                'invalid_asof_type',
                last,
                p,
                'LowCardinality on both sides of the inequality',
              );
          }

          function conjuncts(e: ExprNode, p: string): { e: ExprNode; path: string }[] {
            if (e.kind !== 'Call' || e.fn.origin !== 'typed' || e.fn.name !== 'and')
              return [{ e, path: p }];

            // Validate the removed parent too, without assigning Params before SQL emission.
            try {
              resolvedType(e);
            } catch (error) {
              return fail(error instanceof Error ? error.message : 'invalid_call', e, p);
            }

            return e.args.flatMap((child, i) => conjuncts(child, `${p}.args[${i}]`));
          }

          // ASOF elements are never split or moved: the builder wrote them as they stay.
          const elements: readonly { e: ExprNode; path: string }[] = asof
            ? rel.on.slice(0, -1).map((e, i) => ({ e, path: `${path}.on[${i}]` }))
            : rel.on.flatMap((e, i) => conjuncts(e, `${path}.on[${i}]`));

          for (const { e, path: p } of elements) {
            if (e.kind !== 'Call' || e.fn.origin !== 'typed' || e.fn.name !== 'eq') {
              // An outer join's ON only decides null extension: a residual cannot move above it.
              if (outer || asof) return fail('join_condition_not_equi', e, p);
              const type = e.type && base(e.type);

              if (!type || type.kind !== 'scalar' || type.name !== 'Bool')
                return fail('invalid_predicate', e, p);

              residuals.push({ e, path: p });
              continue;
            }

            if (e.args.length !== 2 || (outer && !asof && e.args.some(a => a.kind !== 'ColumnRef')))
              return fail('join_condition_arity', e, p);

            const left = [...sides(e.args[0]!, `${p}.args[0]`)],
              right = [...sides(e.args[1]!, `${p}.args[1]`)];

            if (left.length !== 1 || right.length !== 1 || left[0] === right[0])
              return fail('join_condition_arity', e, p);

            clauses[Math.max(left[0]!, right[0]!)]!.push({ e, path: p });
          }

          if (asof)
            clauses[1]!.push({ e: rel.on.at(-1)!, path: `${path}.on[${rel.on.length - 1}]` });

          for (let i = 1; i < clauses.length; i++)
            if (rel.joinKind !== 'cross' && !clauses[i]!.length)
              return fail(
                'join_condition_arity',
                rel,
                `${path}.inputs[${i}]`,
                'no equality connects this input to an earlier input',
              );

          const items = physical.map(l => {
            const side = rel.inputs.find(([a]) => a === l.path[0])!;

            const child = (plan?.columns?.get(side[1]) ?? outputLeaves(side[1].output)).find(
              c => JSON.stringify(c.path) === JSON.stringify(l.path.slice(1)),
            );

            if (!child) return fail('missing_physical_column', rel, path, JSON.stringify(l.path));
            return `${joinRead(rel, side[0], `${joinAlias(rel, side[0])}.${quoteIdentifier(child.name)}`, l.type, child.type)} AS ${quoteIdentifier(l.name)}`;
          });

          if (outer) outerJoin = true;
          let source = '';

          for (const [i, [alias, child]] of rel.inputs.entries()) {
            source += `${i ? ` ${joinKeyword(rel)} ` : ''}(${emit(child, `${path}.inputs[${i}]`)}) AS ${joinAlias(rel, alias)}`;

            if (i && rel.joinKind !== 'cross')
              source += ` ON ${clauses[i]!.map(c => expression(c.e, rel, c.path, undefined, false, 'row', '')).join(' AND ')}`;
          }

          return `SELECT ${items.join(', ')} FROM ${source}${residuals.length ? ` WHERE ${conjunction(residuals.map(c => ({ expr: c.e, sql: expression(c.e, rel, c.path, undefined, false, 'row', '') })))}` : ''}`;
        }

        case 'Scan': {
          if (rel.final !== undefined && typeof rel.final !== 'boolean')
            return fail('invalid_scan_hint', rel, `${path}.final`);

          if (
            rel.sample !== undefined &&
            (typeof rel.sample !== 'number' ||
              !Number.isFinite(rel.sample) ||
              rel.sample <= 0 ||
              rel.sample > 1)
          )
            return fail('invalid_scan_hint', rel, `${path}.sample`, 'expected fraction in (0, 1]');

          if (
            order.some(
              k =>
                !Object.hasOwn(rel.table.columns, k) || !same(columns[k]!, rel.table.columns[k]!),
            )
          )
            return fail('invalid_output', rel, path);

          const table = quoteIdentifier(rel.table.name);
          const hints = `${rel.final ? ' FINAL' : ''}${rel.sample === undefined ? '' : ` SAMPLE ${rel.sample}`}`;
          return `SELECT ${list} FROM ${table}${hints}`;
        }

        case 'Prewhere': {
          if (rel.input?.kind !== 'Scan')
            return fail('invalid_prewhere_input', rel, `${path}.input`, 'expected a Scan');

          const inputLeaves = outputLeaves(rel.input.output);

          if (
            JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !==
            JSON.stringify(inputLeaves.map(l => [l.path, print(l.type)]))
          )
            return fail('invalid_output', rel, path);

          const type = rel.pred?.type && base(rel.pred.type);

          if (!type || type.kind !== 'scalar' || type.name !== 'Bool')
            return fail('invalid_predicate', rel, path);

          // Validates the Scan and its hints; the SQL is discarded because PREWHERE must read the table directly.
          emit(rel.input, `${path}.input`);
          const predicate = expression(rel.pred, rel.input, `${path}.pred`);
          return `SELECT ${list} FROM ${quoteIdentifier(rel.input.table.name)} AS ${inputAlias}${scanHints(rel.input)} PREWHERE ${predicate}`;
        }

        case 'ArrayJoin': {
          if (typeof rel.alias !== 'string' || rel.alias.includes('\0'))
            return fail('invalid_array_join_alias', rel, `${path}.alias`);

          if (typeof rel.left !== 'boolean') return fail('invalid_array_join', rel, `${path}.left`);
          const input = rel.input.output;
          if (input.shape === 'deferred') return fail('unsupported_output', rel, path);
          const inputLeaves = outputLeaves(input);

          if (inputLeaves.some(l => l.path[0] === rel.alias))
            return fail('duplicate_column', rel, `${path}.alias`);

          let type: CHType;

          try {
            type = resolvedType(rel.expr);
          } catch (error) {
            return fail('invalid_array_join_expression', rel, `${path}.expr`, String(error));
          }

          if (type.kind !== 'Array')
            return fail('invalid_array_join_expression', rel, `${path}.expr`);

          const expected = outputLeaves(expandedOutput(input, rel.alias, type.inner));

          if (
            JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !==
              JSON.stringify(expected.map(l => [l.path, print(l.type)])) ||
            Object.keys(rel.columns).length !== order.length ||
            order.some(k => !Object.hasOwn(rel.columns, k) || !same(rel.columns[k]!, columns[k]!))
          )
            return fail('invalid_output', rel, path);

          // Internal element aliases cannot capture a user column or the input table alias.
          let element = plan?.ctes?.elementAlias ?? '__typedhouse_element';

          while (Object.hasOwn(columns, element) || inputLeaves.some(l => l.name === element))
            element += '_';

          const quotedElement = quoteIdentifier(element);
          let sourceAlias = plan?.ctes?.inputAlias ?? '__typedhouse_input';

          while (
            Object.hasOwn(columns, sourceAlias) ||
            inputLeaves.some(l => l.name === sourceAlias)
          )
            sourceAlias += '_';

          const qualifier = quoteIdentifier(sourceAlias);

          const items = physical.map(leaf => {
            if (leaf.path.length === 1 && leaf.path[0] === rel.alias)
              return `${quotedElement} AS ${quoteIdentifier(leaf.name)}`;

            const source = (plan?.columns?.get(rel.input) ?? inputLeaves).find(
              l => JSON.stringify(l.path) === JSON.stringify(leaf.path),
            );

            if (!source)
              return fail('missing_physical_column', rel, path, JSON.stringify(leaf.path));

            return `${qualifier}.${quoteIdentifier(source.name)} AS ${quoteIdentifier(leaf.name)}`;
          });

          // FROM precedes ARRAY JOIN in emitted text, hence its Params are assigned first.
          const source = emit(rel.input, `${path}.input`);

          const expr = expression(
            rel.expr,
            rel.input,
            `${path}.expr`,
            undefined,
            false,
            'row',
            qualifier,
          );

          return `SELECT ${items.join(', ')} FROM (${source}) AS ${qualifier} ${rel.left ? 'LEFT ' : ''}ARRAY JOIN ${expr} AS ${quotedElement}`;
        }

        case 'Aggregate': {
          const keys = Object.entries(rel.keys),
            aggs = Object.entries(rel.aggs);

          const entries = [...keys, ...aggs];

          if (new Set(entries.map(([k]) => k)).size !== entries.length)
            return fail('duplicate_column', rel, path);

          if (JSON.stringify(entries.map(([k]) => k)) !== JSON.stringify(order))
            return fail('invalid_output', rel, path);

          if (
            Object.keys(rel.columns).length !== order.length ||
            order.some(k => !rel.columns[k] || !same(rel.columns[k]!, columns[k]!))
          )
            return fail('invalid_output', rel, path);

          for (const [k, e] of aggs)
            if (!hasAggregate(e))
              return fail('invalid_aggregate_placement', e, `${path}.aggs.${k}`);

          const keySql = keys.map(([k, e]) => expression(e, rel.input, `${path}.keys.${k}`));

          const items = entries.map(([k, e], i) => {
            if (!e.type || !same(e.type, columns[k]!))
              return fail('invalid_output', e, `${path}.${k}`);

            return `${i < keys.length ? keySql[i] : expression(e, rel.input, `${path}.aggs.${k}`, undefined, false, 'aggregate')} AS ${quoteIdentifier(k)}`;
          });

          return `SELECT ${items.join(', ')} FROM (${emit(rel.input, `${path}.input`)}) AS ${inputAlias}${keys.length ? ` GROUP BY ${keySql.join(', ')}` : ''}`;
        }

        case 'Project': {
          if (Object.keys(rel.exprs).length !== order.length)
            return fail('nested_projection', rel, path);

          const items = order.flatMap(k => {
            const e = rel.exprs[k];

            if (!e || !e.type || !same(e.type, columns[k]!))
              return fail('nested_projection', rel, `${path}.exprs.${k}`);

            if (!physicalOrder.includes(k)) return [];
            return [`${expression(e, rel.input, `${path}.exprs.${k}`)} AS ${quoteIdentifier(k)}`];
          });

          const source = emit(rel.input, `${path}.input`);
          if (plan?.blocks.has(rel)) return renderBlock(rel, physicalOrder);
          return `SELECT ${items.join(', ')} FROM (${source}) AS ${inputAlias}`;
        }

        case 'Filter':
        case 'LimitBy':
        case 'Limit':
        case 'Sort':
        case 'Distinct':
        case 'Materialize': {
          const inputLeaves = outputLeaves(rel.input.output);

          if (
            JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !==
            JSON.stringify(inputLeaves.map(l => [l.path, print(l.type)]))
          )
            return fail('invalid_output', rel, path);

          const source = emit(rel.input, `${path}.input`);

          if (rel.kind === 'Materialize') {
            if (plan?.ctes) return source;
            // The local WITH is visible throughout its input. Avoid every quoted
            // identifier in that subtree, including physical tables and nested CTEs.
            let name: string;

            do {
              name = quoteIdentifier(`t${cteIndex++}`);
            } while (source.includes(name) || order.some(k => quoteIdentifier(k) === name));

            return `WITH ${name} AS (${source}) SELECT ${order.map(k => `${name}.${quoteIdentifier(k)}`).join(', ')} FROM ${name}`;
          }

          if (rel.kind === 'Distinct')
            return `SELECT DISTINCT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias}`;

          function renderClause(clause: string): string {
            clauses.set(rel, clause);
            return renderBlock(rel, physicalOrder);
          }

          if (rel.kind === 'Sort') {
            if (!Array.isArray(rel.keys) || rel.keys.length === 0)
              return fail('invalid_sort_key', rel, `${path}.keys`);

            const keys = rel.keys.map((key, i) => {
              const keyPath = `${path}.keys[${i}]`;

              if (
                !key ||
                (key.dir !== 'asc' && key.dir !== 'desc') ||
                (key.nulls !== undefined && key.nulls !== 'first' && key.nulls !== 'last')
              )
                return fail('invalid_sort_key', rel, keyPath);

              return `${expression(key.expr, rel.input, `${keyPath}.expr`, undefined, false, 'row', blockQualifier(rel))} ${key.dir.toUpperCase()}${key.nulls === undefined ? '' : ` NULLS ${key.nulls.toUpperCase()}`}`;
            });

            if (plan) return renderClause(` ORDER BY ${keys.join(', ')}`);
            return `SELECT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias} ORDER BY ${keys.join(', ')}`;
          }

          if (rel.kind === 'Filter') {
            const type = rel.pred?.type && base(rel.pred.type);

            if (!type || type.kind !== 'scalar' || type.name !== 'Bool')
              return fail('invalid_predicate', rel, path);

            const predicate = expression(
              rel.pred,
              rel.input,
              `${path}.pred`,
              undefined,
              false,
              'row',
              blockQualifier(rel),
            );

            if (plan) return renderClause(predicate);
            return `SELECT ${list} FROM (${source}) AS ${inputAlias} WHERE ${predicate}`;
          }

          if (
            !Number.isSafeInteger(rel.n) ||
            rel.n < 0 ||
            (rel.offset !== undefined && (!Number.isSafeInteger(rel.offset) || rel.offset < 0))
          )
            return fail('invalid_limit', rel, path);

          const limit = ` ${limitClause(rel)}`;

          if (rel.kind === 'LimitBy') {
            if (rel.keys.length === 0)
              return fail('invalid_limit_by_key', rel, `${path}.keys`, 'expected at least one key');

            // `LIMIT 1 BY 2` is positional, a constant Param makes one group, and a column-free Raw could print a bare number.
            const keys = rel.keys
              .map((key, i) => {
                const keyPath = `${path}.keys[${i}]`;

                if (references(key).length === 0)
                  return fail(
                    'invalid_limit_by_key',
                    key,
                    keyPath,
                    'a key must read a column of the row',
                  );

                return expression(
                  key,
                  rel.input,
                  keyPath,
                  undefined,
                  false,
                  'row',
                  blockQualifier(rel),
                );
              })
              .join(', ');

            if (plan) return renderClause(`${limit} BY ${keys}`);
            return `SELECT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias}${limit} BY ${keys}`;
          }

          if (plan) return renderClause(limit);
          return `SELECT ${list} FROM (${source})${limit}`;
        }

        default:
          return fail('unsupported_node', rel, path, rel.kind);
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      return fail('invalid_ir', rel, path, String(error));
    } finally {
      active.delete(rel);
    }
  }

  const definitions: string[] = [];

  for (const rel of plan?.ctes?.definitions ?? []) {
    const sql = emitNode(rel, `cte[${definitions.length}]`);
    definitions.push(`${quoteIdentifier(plan!.ctes!.names.get(rel)!)} AS (${sql})`);
    defined.add(rel);
  }

  const body = `${definitions.length ? `WITH ${definitions.join(', ')}${plan?.blocks.get(root)?.source.kind === 'join' ? '\n' : ' '}` : ''}${emit(root, 'root')}`;

  const settings = [
    ...userSettings,
    ...(weekBucketing ? ['enable_extended_results_for_datetime_functions = 1'] : []),
    // Nullable membership's declared result requires the server's default NULL policy.
    ...(dateMembership ? ['transform_null_in = 0'] : []),
    // Query-global: an outer join's unmatched columns are NULL, not type defaults (spec, Emission details).
    ...(outerJoin ? ['join_use_nulls = 1'] : []),
  ];

  const sql =
    body +
    (settings.length ? ` SETTINGS ${settings.join(', ')}` : '') +
    (outerJoin
      ? ' /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */'
      : '');

  const leaves = outputLeaves(root.output);

  return Object.freeze({
    sql,
    params: Object.freeze(params),
    parameterTypes: Object.freeze(parameterTypes),
    columns: Object.freeze(Object.fromEntries(leaves.map(l => [l.name, l.type]))),
    ...(root.output.shape === 'nested'
      ? {
          columnPaths: Object.freeze(
            Object.fromEntries(leaves.map(l => [l.name, Object.freeze(l.path)])),
          ),
        }
      : {}),
    nodes: Object.freeze(nodes),
  });
}
