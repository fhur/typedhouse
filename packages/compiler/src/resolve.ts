import {
  isDayDescriptor,
  setDescriptor,
  membershipBase,
  aggregateDefinitions,
  aggregateMergeType,
  aggregateStateType,
  functionCatalog,
  isNullable,
  nullable,
  unwrap,
  print,
  numeric,
  stringLike,
  dateLike,
  type CHType,
  type ExprNode,
} from '@typedhouse/core';

import { resolveKnown } from './resolve-known.js';

/** Closed descriptor grammar: no raw/Unknown type text ever reaches CAST syntax.
 * Nullable -> non-null is deliberately unsupported: cast_keep_nullable changes
 * that conversion's descriptor, and NULL removal must never be implicit here.
 */
function castDescriptor(type: CHType): CHType {
  const inner = type?.kind === 'Nullable' ? type.inner : type;

  if (
    !inner ||
    inner.kind !== 'scalar' ||
    typeof inner.name !== 'string' ||
    !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool)$/.test(inner.name)
  )
    throw new Error('unsupported_cast_type');

  return type;
}

export function resolveCast(
  e: Extract<ExprNode, { kind: 'Cast' }>,
  resolve: (e: ExprNode) => CHType,
): CHType {
  const target = castDescriptor(e.to);
  if (print(castDescriptor(e.type)) !== print(target)) throw new Error('invalid_expression_type');
  const source = resolve(e.expr);
  const sourceInner = source.kind === 'Nullable' ? source.inner : source;

  // Decimal inputs can be converted to the supported scalar targets. This does
  // not widen the target grammar (which is interpolated into CAST syntax).
  if (sourceInner.kind !== 'Decimal') castDescriptor(source);
  else if (
    !Number.isInteger(sourceInner.precision) ||
    sourceInner.precision < 1 ||
    sourceInner.precision > 76 ||
    !Number.isInteger(sourceInner.scale) ||
    sourceInner.scale < 0 ||
    sourceInner.scale > sourceInner.precision
  )
    throw new Error('unsupported_cast_type');

  if (source.kind === 'Nullable' && target.kind !== 'Nullable')
    throw new Error('cast_nullable_removal');

  return target;
}

/** Merged results that are UInt64 whatever the state stores, with the argument counts 24.8 allows such a state:
 * measured for numeric, Nullable, multi-argument, LowCardinality, Tuple, temporal, Decimal and Array arguments.
 * Merging `AggregateFunction(uniq, UInt64)` reads no value, so the base function's narrower operands do not apply. */
const anyStoredArguments: Readonly<Record<string, readonly [number, number]>> = {
  count: [0, 1],
  uniq: [1, Infinity],
  uniqExact: [1, Infinity],
};

export function resolveAggregate(
  e: Extract<ExprNode, { kind: 'Agg' }>,
  resolve: (e: ExprNode, expected?: CHType) => CHType,
): { result: CHType; sqlName: string } {
  if ('user' in e.fn) throw new Error('invalid_function_metadata');
  if (e.fn.origin === 'known') return resolveKnown(e, resolve);
  if (e.fn.known !== undefined) throw new Error('invalid_function_metadata');
  const def = aggregateDefinitions.find(d => d.name === e.fn.name);
  if (!def || e.fn.origin !== 'typed') throw new Error('unsupported_aggregate');

  if (
    e.fn.sqlName !== def.sqlName ||
    e.fn.deterministic !== def.deterministic ||
    e.fn.linear !== def.linear ||
    e.fn.argumentPolicies !== undefined ||
    e.fn.repeatedArgs !== undefined
  )
    throw new Error('invalid_function_metadata');

  if (
    (!def.params && e.params.length) ||
    e.combinators.length > 1 ||
    e.combinators.some(c => c !== 'If' && c !== 'State' && c !== 'Merge')
  )
    throw new Error('unsupported_aggregate_combinator');

  if (e.params.length !== (def.params?.length ?? 0))
    throw new Error('invalid_aggregate_parameters');

  for (let i = 0; i < e.params.length; i++) {
    const param = e.params[i]!;

    if (param.kind !== 'Param' || !param.type || print(param.type) !== print(def.params![i]!.type))
      throw new Error('invalid_aggregate_parameter_type');

    if (
      typeof param.value !== 'number' ||
      !Number.isFinite(param.value) ||
      param.value < 0 ||
      param.value > 1
    )
      throw new Error('invalid_quantile_level');

    resolve(param);
  }

  const combinator = e.combinators[0];
  const conditional = combinator === 'If';
  const sqlName = (def.sqlName ?? def.name) + (combinator ?? '');

  if (e.args.length !== (combinator === 'Merge' ? 1 : def.args.length + Number(conditional)))
    throw new Error('invalid_argument_arity');

  const types = e.args.map(a => resolve(a));

  const accepts = (operands: readonly CHType[]) =>
    def.args.every((matcher, i) =>
      'match' in matcher
        ? matcher.match(operands[i]!)
        : print(matcher.type) === print(operands[i]!),
    );

  let result: CHType;

  if (combinator === 'Merge') {
    const state = types[0]!;

    if (
      state.kind !== 'AggregateFunction' ||
      !(Object.hasOwn(anyStoredArguments, def.name)
        ? state.args.length >= anyStoredArguments[def.name]![0] &&
          state.args.length <= anyStoredArguments[def.name]![1]
        : state.args.length === def.args.length && accepts(state.args))
    )
      throw new Error('invalid_merge_state');

    const stored = storedLevel(def.name, state.fn, def.params !== undefined);
    if (stored === undefined) throw new Error('invalid_merge_state');

    // A nullable state wraps its function, and the server then compares parameters: only the stored level merges (code 43).
    // The comparison includes the field's type. The merge level is a Float64 parameter, so a stored `quantile(1)` never
    // equals it, while `quantile(1.)` does.
    if (
      e.params.length &&
      state.args.some(isNullable) &&
      ((e.params[0] as Extract<ExprNode, { kind: 'Param' }>).value !== stored ||
        /\(\s*\d+\s*\)$/.test(state.fn))
    )
      throw new Error('invalid_merge_state');

    result = aggregateMergeType(def, state.args);
  } else {
    if (!accepts(types)) throw new Error('incompatible_operands');

    if (conditional) {
      const t = unwrap(types[types.length - 1]!);
      if (t.kind !== 'scalar' || t.name !== 'Bool') throw new Error('invalid_predicate');
    }

    const args = types.slice(0, def.args.length);

    if (combinator === 'State')
      result = aggregateStateType(
        def,
        args,
        e.params.map(p => (p as Extract<ExprNode, { kind: 'Param' }>).value),
      );
    else {
      const returns = def.returns;

      result =
        typeof returns === 'function'
          ? returns(args, [])
          : returns === 'arg0'
            ? args[0]!
            : returns.type;

      if (def.nullable !== 'never' && args.some(isNullable)) result = nullable(result);
    }
  }

  if (print(result) !== print(e.type)) throw new Error('invalid_expression_type');
  return { result, sqlName };
}

/** The level a state's function name stores: `null` for none, `undefined` when the name is another function's. */
function storedLevel(name: string, fn: string, parametric: boolean): number | null | undefined {
  if (fn === name) return null;
  if (!parametric || !fn.startsWith(`${name}(`) || !fn.endsWith(')')) return undefined;
  const text = fn.slice(name.length + 1, -1).trim();
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return undefined;
  const level = Number(text);
  return level >= 0 && level <= 1 ? level : undefined;
}

function compatible(a: CHType, b: CHType): boolean {
  const left = unwrap(a),
    right = unwrap(b);

  if (print(left) === print(right)) return true;
  if (left.kind === 'Array' && right.kind === 'Array') return compatible(left.inner, right.inner);
  return [numeric, stringLike, dateLike].some(family => family.match(left) && family.match(right));
}

/** Catalog evidence, not caller-supplied Call metadata, determines argument/result types. */
export function resolveCall(
  e: Extract<ExprNode, { kind: 'Call' }>,
  resolve: (e: ExprNode, expected?: CHType) => CHType,
): { types: CHType[]; result: CHType; sqlName: string } {
  if ('user' in e.fn) throw new Error('invalid_function_metadata');
  if (e.fn.origin === 'known') return resolveKnown(e, resolve);
  if (e.fn.known !== undefined) throw new Error('invalid_function_metadata');
  const def = functionCatalog.find(d => d.name === e.fn.name);
  if (!def || e.fn.origin !== 'typed') throw new Error('unsupported_expression');

  if (
    e.fn.sqlName !== def.sqlName ||
    e.fn.deterministic !== def.deterministic ||
    JSON.stringify(e.fn.argumentPolicies) !== JSON.stringify(def.argumentPolicies) ||
    e.fn.repeatedArgs !== def.repeatedArgs
  )
    throw new Error('invalid_function_metadata');

  const repeated = def.name === 'greatest' && def.repeatedArgs === 'temporalGreatest';
  const conditional = def.name === 'multiIf' && def.repeatedArgs === 'stringMultiIf';

  if (
    conditional
      ? e.args.length < 3 || e.args.length % 2 !== 1
      : repeated
        ? e.args.length < 2
        : e.args.length !== def.args.length
  )
    throw new Error('invalid_argument_arity');

  // Heterogeneous signatures must resolve before generic sibling inference.
  if (conditional || def.name === 'dateDiff') {
    const string: CHType = { kind: 'scalar', name: 'String' };

    const types = e.args.map((arg, i) => {
      if (def.name === 'dateDiff') {
        if (i === 0 || i === 3) {
          if (arg.kind !== 'Param' || arg.value !== (i === 0 ? 'day' : 'UTC'))
            throw new Error('incompatible_operands');

          const type = resolve(arg, string);
          if (print(type) !== 'String') throw new Error('incompatible_operands');
          return type;
        }

        if (!arg.type || !isDayDescriptor(arg.type)) throw new Error('incompatible_operands');
        const type = resolve(arg);
        if (!isDayDescriptor(type)) throw new Error('incompatible_operands');
        return type;
      }

      const branch = i % 2 === 1 || i === e.args.length - 1;
      if (!branch && arg.type === null) throw new Error('invalid_predicate');
      const type = resolve(arg, branch ? string : undefined);
      const base = unwrap(type);

      if (branch ? print(type) !== 'String' : base.kind !== 'scalar' || base.name !== 'Bool')
        throw new Error('incompatible_operands');

      return type;
    });

    const result: CHType = conditional ? string : { kind: 'scalar', name: 'Int64' };
    if (print(result) !== print(e.type)) throw new Error('invalid_expression_type');
    return { types, result, sqlName: def.name };
  }

  if (repeated && e.args.some(arg => arg.type === null)) throw new Error('incompatible_operands');

  if (def.surface === 'membership') {
    const left = resolve(e.args[0]!);
    const base = membershipBase(left);
    const set = e.args[1]!;
    let right: CHType;

    if (set.kind === 'Subquery') {
      if (set.usage !== 'in') throw new Error('invalid_subquery_usage');
      right = setDescriptor(set.rel);
      if (print(right) !== print(set.type)) throw new Error('invalid_expression_type');
    } else {
      if (set.kind !== 'Param' || !Array.isArray(set.value)) throw new Error('invalid_set_operand');
      const array = resolve(set, { kind: 'Array', inner: base });

      if (array.kind !== 'Array' || array.inner.kind === 'Nullable')
        throw new Error('invalid_set_operand');

      right = array.inner;
    }

    const family = (t: CHType) => {
      const b = membershipBase(t);
      // FixedString compares with String on the server; Enum sets only match Enum receivers.
      if (b.kind === 'FixedString') return 'String';
      if (b.kind === 'Enum') return 'Enum';
      if (b.kind !== 'scalar') throw new Error('unsupported_membership_type');

      return /^U?Int(64|128|256)$/.test(b.name)
        ? 'bigint'
        : /^(U?Int|Float)/.test(b.name)
          ? 'number'
          : b.name;
    };

    if (family(left) !== family(right)) throw new Error('incompatible_operands');

    const result: CHType = isNullable(left)
      ? nullable({ kind: 'scalar', name: 'Bool' })
      : { kind: 'scalar', name: 'Bool' };

    if (print(result) !== print(e.type)) throw new Error('invalid_expression_type');

    return {
      types: [left, set.kind === 'Subquery' ? right : { kind: 'Array', inner: base }],
      result,
      sqlName: def.name,
    };
  }

  const sibling = e.args.find(a => a.type !== null);
  const siblingType = sibling ? resolve(sibling) : undefined;

  const types = e.args.map((a, i) => {
    const policy = def.argumentPolicies?.[i];
    let expected = siblingType && unwrap(siblingType);
    if (policy === 'numericIndex') expected = { kind: 'scalar', name: 'Int64' };

    if (policy === 'constantSelector') {
      if (a.kind !== 'Param' || typeof a.value !== 'string')
        throw new Error('invalid_tuple_selector');

      expected = { kind: 'scalar', name: 'String' };
    }

    if (policy === 'arrayElement') {
      if (expected?.kind !== 'Array') throw new Error('incompatible_operands');
      expected = expected.inner;
    }

    const type = resolve(a, a.kind === 'Param' && a.type === null ? expected : undefined);
    const matcher = def.args[repeated ? 0 : i]!;

    if (!('match' in matcher ? matcher.match(type) : print(matcher.type) === print(type)))
      throw new Error('incompatible_operands');

    if (policy === 'numericIndex') {
      const t = unwrap(type);
      if (t.kind !== 'scalar' || !/^U?Int/.test(t.name)) throw new Error('invalid_array_index');
    }

    return type;
  });

  if (def.surface === 'between') {
    // Do not admit decoded number/bigint mixing through hand-built IR either.
    const family = (type: CHType) => {
      const t = unwrap(type);
      if (dateLike.match(t)) return 'date';
      if (t.kind === 'FixedString' || (t.kind === 'scalar' && t.name === 'String')) return 'string';
      return t.kind === 'scalar' && /^U?Int(64|128|256)$/.test(t.name) ? 'bigint' : 'number';
    };

    if (types.some(t => family(t) !== family(types[0]!))) throw new Error('incompatible_operands');

    // ClickHouse lowers BETWEEN into two comparisons. Never duplicate an
    // opaque, scalar-subquery or volatile receiver, even if future catalogs grow.
    const repeatable = (arg: ExprNode): boolean =>
      arg.kind === 'ColumnRef' ||
      arg.kind === 'Param' ||
      (arg.kind === 'Cast' && repeatable(arg.expr)) ||
      ((arg.kind === 'Call' || arg.kind === 'Agg') &&
        arg.fn.origin === 'typed' &&
        arg.fn.deterministic === true &&
        arg.args.every(repeatable));

    if (!repeatable(e.args[0]!)) throw new Error('unsupported_between_receiver');
  }

  if (def.surface === 'comparison' && !compatible(types[0]!, types[1]!))
    throw new Error('incompatible_operands');

  if (def.surface === 'has' || def.surface === 'hasAny') {
    const a = unwrap(types[0]!);
    const b = def.surface === 'hasAny' ? unwrap(types[1]!) : types[1]!;

    if (
      a.kind !== 'Array' ||
      !compatible(a.inner, def.surface === 'hasAny' && b.kind === 'Array' ? b.inner : b)
    )
      throw new Error('incompatible_operands');
  }

  const returns = def.returns;

  let result =
    typeof returns === 'function'
      ? returns(
          types,
          e.args.map(a => (a.kind === 'Param' ? a.value : undefined)),
        )
      : returns === 'arg0'
        ? types[0]!
        : returns.type;

  if (def.nullable !== 'never' && types.some(isNullable)) result = nullable(result);

  if (result.kind === 'Unknown' || print(result) !== print(e.type))
    throw new Error('invalid_expression_type');

  return { types, result, sqlName: def.sqlName ?? def.name };
}
