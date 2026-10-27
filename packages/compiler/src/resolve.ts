import { methodCatalog, isNullable, nullable, unwrap, print, numeric, stringLike, dateLike, type CHType, type ExprNode } from '@chql/core';

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
