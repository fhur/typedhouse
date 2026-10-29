import { setDescriptor, membershipBase, aggregateDefinitions, methodCatalog, isNullable, nullable, unwrap, print, numeric, stringLike, dateLike, type CHType, type ExprNode } from '@chql/core';

/** Closed descriptor grammar: no raw/Unknown type text ever reaches CAST syntax.
 * Nullable -> non-null is deliberately unsupported: cast_keep_nullable changes
 * that conversion's descriptor, and NULL removal must never be implicit here.
 */
function castDescriptor(type: CHType): CHType {
  const inner = type?.kind === 'Nullable' ? type.inner : type;
  if (!inner || inner.kind !== 'scalar' || typeof inner.name !== 'string' || !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool)$/.test(inner.name)) throw new Error('unsupported_cast_type');
  return type;
}
export function resolveCast(e: Extract<ExprNode, { kind: 'Cast' }>, resolve: (e: ExprNode) => CHType): CHType {
  const target = castDescriptor(e.to);
  if (print(castDescriptor(e.type)) !== print(target)) throw new Error('invalid_expression_type');
  const source = castDescriptor(resolve(e.expr));
  if (source.kind === 'Nullable' && target.kind !== 'Nullable') throw new Error('cast_nullable_removal');
  return target;
}

export function resolveAggregate(e: Extract<ExprNode, { kind: 'Agg' }>, resolve: (e: ExprNode, expected?: CHType) => CHType): { result: CHType; sqlName: string } {
  const def = aggregateDefinitions.find(d => d.name === e.fn.name);
  if (!def || e.fn.origin !== 'typed') throw new Error('unsupported_aggregate');
  if (e.fn.sqlName !== def.sqlName || e.fn.deterministic !== def.deterministic || e.fn.linear !== def.linear || e.fn.argumentPolicies !== undefined) throw new Error('invalid_function_metadata');
  if ((!def.params && e.params.length) || e.combinators.length > 1 || e.combinators.some(c => c !== 'If')) throw new Error('unsupported_aggregate_combinator');
  if (e.params.length !== (def.params?.length ?? 0)) throw new Error('invalid_aggregate_parameters');
  for (let i = 0; i < e.params.length; i++) {
    const param = e.params[i]!;
    if (param.kind !== 'Param' || !param.type || print(param.type) !== print(def.params![i]!.type)) throw new Error('invalid_aggregate_parameter_type');
    if (typeof param.value !== 'number' || !Number.isFinite(param.value) || param.value < 0 || param.value > 1) throw new Error('invalid_quantile_level');
    resolve(param);
  }
  const conditional = e.combinators[0] === 'If';
  if (e.args.length !== def.args.length + Number(conditional)) throw new Error('invalid_argument_arity');
  const types = e.args.map(a => resolve(a));
  for (let i = 0; i < def.args.length; i++) {
    const matcher = def.args[i]!;
    if (!('match' in matcher ? matcher.match(types[i]!) : print(matcher.type) === print(types[i]!))) throw new Error('incompatible_operands');
  }
  if (conditional) { const t = unwrap(types[types.length - 1]!); if (t.kind !== 'scalar' || t.name !== 'Bool') throw new Error('invalid_predicate'); }
  const args = types.slice(0, def.args.length);
  const returns = def.returns;
  let result = typeof returns === 'function' ? returns(args, []) : returns === 'arg0' ? args[0]! : returns.type;
  if (def.nullable !== 'never' && args.some(isNullable)) result = nullable(result);
  if (print(result) !== print(e.type)) throw new Error('invalid_expression_type');
  return { result, sqlName: (def.sqlName ?? def.name) + (conditional ? 'If' : '') };
}

function compatible(a: CHType, b: CHType): boolean {
  const left = unwrap(a), right = unwrap(b);
  if (print(left) === print(right)) return true;
  if (left.kind === 'Array' && right.kind === 'Array') return compatible(left.inner, right.inner);
  return [numeric, stringLike, dateLike].some(family => family.match(left) && family.match(right));
}

/** Catalog evidence, not caller-supplied Call metadata, determines argument/result types. */
export function resolveCall(e: Extract<ExprNode, { kind: 'Call' }>, resolve: (e: ExprNode, expected?: CHType) => CHType): { types: CHType[]; result: CHType; sqlName: string } {
  const def = methodCatalog.find(d => d.name === e.fn.name);
  if (!def || e.fn.origin !== 'typed') throw new Error('unsupported_expression');
  if (e.fn.sqlName !== def.sqlName || e.fn.deterministic !== def.deterministic || JSON.stringify(e.fn.argumentPolicies) !== JSON.stringify(def.argumentPolicies)) throw new Error('invalid_function_metadata');
  if (e.args.length !== def.args.length) throw new Error('invalid_argument_arity');
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
      if (array.kind !== 'Array' || array.inner.kind === 'Nullable') throw new Error('invalid_set_operand');
      right = array.inner;
    }
    const family = (t: CHType) => {
      const b = membershipBase(t);
      if (b.kind !== 'scalar') throw new Error('unsupported_membership_type');
      return /^U?Int(64|128|256)$/.test(b.name) ? 'bigint' : /^(U?Int|Float)/.test(b.name) ? 'number' : b.name;
    };
    if (family(left) !== family(right)) throw new Error('incompatible_operands');
    const result: CHType = left.kind === 'Nullable' ? nullable({ kind: 'scalar', name: 'Bool' }) : { kind: 'scalar', name: 'Bool' };
    if (print(result) !== print(e.type)) throw new Error('invalid_expression_type');
    return { types: [left, set.kind === 'Subquery' ? right : { kind: 'Array', inner: base }], result, sqlName: def.name };
  }
  const sibling = e.args.find(a => a.type !== null);
  const siblingType = sibling ? resolve(sibling) : undefined;
  const types = e.args.map((a, i) => {
    const policy = def.argumentPolicies?.[i];
    let expected = siblingType && unwrap(siblingType);
    if (policy === 'numericIndex') expected = { kind: 'scalar', name: 'Int64' };
    if (policy === 'constantSelector') {
      if (a.kind !== 'Param' || typeof a.value !== 'string') throw new Error('invalid_tuple_selector');
      expected = { kind: 'scalar', name: 'String' };
    }
    if (policy === 'arrayElement') {
      if (expected?.kind !== 'Array') throw new Error('incompatible_operands');
      expected = expected.inner;
    }
    const type = resolve(a, a.kind === 'Param' && a.type === null ? expected : undefined);
    const matcher = def.args[i]!;
    if (!('match' in matcher ? matcher.match(type) : print(matcher.type) === print(type))) throw new Error('incompatible_operands');
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
      if (t.kind === 'FixedString' || t.kind === 'scalar' && t.name === 'String') return 'string';
      return t.kind === 'scalar' && /^U?Int(64|128|256)$/.test(t.name) ? 'bigint' : 'number';
    };
    if (types.some(t => family(t) !== family(types[0]!))) throw new Error('incompatible_operands');
    // ClickHouse lowers BETWEEN into two comparisons. Never duplicate an
    // opaque, scalar-subquery or volatile receiver, even if future catalogs grow.
    const repeatable = (arg: ExprNode): boolean => arg.kind === 'ColumnRef' || arg.kind === 'Param' ||
      (arg.kind === 'Cast' && repeatable(arg.expr)) ||
      ((arg.kind === 'Call' || arg.kind === 'Agg') && arg.fn.deterministic === true && arg.args.every(repeatable));
    if (!repeatable(e.args[0]!)) throw new Error('unsupported_between_receiver');
  }
  if (def.surface === 'comparison' && !compatible(types[0]!, types[1]!)) throw new Error('incompatible_operands');
  if (def.surface === 'has' || def.surface === 'hasAny') {
    const a = unwrap(types[0]!);
    const b = def.surface === 'hasAny' ? unwrap(types[1]!) : types[1]!;
    if (a.kind !== 'Array' || !compatible(a.inner, def.surface === 'hasAny' && b.kind === 'Array' ? b.inner : b)) throw new Error('incompatible_operands');
  }
  const returns = def.returns;
  let result = typeof returns === 'function' ? returns(types, e.args.map(a => a.kind === 'Param' ? a.value : undefined)) : returns === 'arg0' ? types[0]! : returns.type;
  if (def.nullable !== 'never' && types.some(isNullable)) result = nullable(result);
  if (result.kind === 'Unknown' || print(result) !== print(e.type)) throw new Error('invalid_expression_type');
  return { types, result, sqlName: def.sqlName ?? def.name };
}
