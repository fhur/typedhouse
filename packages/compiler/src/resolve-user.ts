import { aggregateDefinitions, functionCatalog, isNullable, nullable, print, type CHType, type ExprNode, type UserArgumentContract } from '@typedhouse/core';

const safeName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
const base = (t: CHType) => t.kind === 'Nullable' ? t.inner : t;
function argumentType(t: CHType): boolean {
  const b = base(t);
  return b.kind === 'scalar' && (b.name === 'String' || b.name === 'UInt64');
}
function matches(c: UserArgumentContract, t: CHType): boolean {
  if (!argumentType(t)) return false;
  return c.kind === 'stringLike' ? print(base(t)) === 'String' : print(base(c.type)) === print(base(t));
}
/** ASCII-only folding leaves ordinary SQL spelling untouched and is locale-independent. */
const foldName = (name: string) => name.replace(/[A-Z]/g, c => c.toLowerCase());
/** Reserve the actual typed catalog and its implemented If combinators, not all server names. */
function reserved(name: string): boolean {
  const folded = foldName(name);
  const matches = (candidate: string | undefined) => candidate !== undefined && foldName(candidate) === folded;
  return functionCatalog.some(d => matches(d.name) || matches(d.sqlName)) ||
    aggregateDefinitions.some(d => matches(d.name) || matches(d.sqlName) || matches(`${d.name}If`) || d.sqlName !== undefined && matches(`${d.sqlName}If`));
}
/** Caller-supplied consistency evidence, never server authentication/signature discovery. */
export function resolveUser(e: Extract<ExprNode, { kind: 'Call' | 'Agg' }>, resolve: (e: ExprNode, expected?: CHType) => CHType): { types: CHType[]; result: CHType; sqlName: string } {
  if (reserved(e.fn.name) || e.fn.sqlName !== undefined && reserved(e.fn.sqlName)) throw new Error('duplicate_function');
  if (e.fn.known !== undefined || e.fn.argumentPolicies !== undefined || e.fn.repeatedArgs !== undefined || e.fn.js !== undefined) throw new Error('invalid_function_metadata');
  if (e.kind !== 'Call') throw new Error('unsupported_user_aggregate');
  const c = e.fn.user;
  if (!c) throw new Error('unsupported_user_function');
  if (c.version !== 1 || c.classification !== 'scalar' || c.name !== e.fn.name || c.sqlName !== e.fn.sqlName || c.deterministic !== e.fn.deterministic) throw new Error('invalid_user_contract');
  if (!safeName(c.name) || c.sqlName !== undefined && !safeName(c.sqlName)) throw new Error('invalid_function_name');
  const r = base(c.returns);
  if (r.kind !== 'scalar' || !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|Bool|String)$/.test(r.name)) throw new Error('unsupported_user_result');
  if (c.args.some(a => a.kind === 'column' && !argumentType(a.type))) throw new Error('unsupported_user_argument');
  if (c.args.length !== e.args.length) throw new Error('invalid_argument_arity');
  const types = e.args.map((a, i) => {
    const contract = c.args[i]!;
    // Each position has its own declared type. Never infer a number from the first String.
    const expected: CHType = contract.kind === 'column' ? base(contract.type) : { kind: 'scalar', name: 'String' };
    const type = resolve(a, a.kind === 'Param' && a.type === null ? expected : undefined);
    if (!matches(contract, type)) throw new Error('unsupported_user_argument');
    return type;
  });
  const result = c.nullable === 'propagate' && types.some(isNullable) ? nullable(c.returns) : c.returns;
  if (print(e.type) !== print(result)) throw new Error('invalid_expression_type');
  return { types, result, sqlName: c.sqlName ?? c.name };
}
