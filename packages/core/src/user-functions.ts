import type { CHType } from './ch-type.js';
import type { UserArgumentContract, UserFunctionContract } from './ir.js';
import { stringLike, type Argument } from './catalog/matchers.js';

/** Initial execution subset, not the full stringLike construction family. */
export function userArgumentType(type: CHType): boolean {
  const base = type.kind === 'Nullable' ? type.inner : type;
  return base.kind === 'scalar' && (base.name === 'String' || base.name === 'UInt64');
}
/** Concrete decoder-backed results. No transparent LowCardinality erasure. */
export function userResultType(type: CHType): boolean {
  const base = type.kind === 'Nullable' ? type.inner : type;
  return base.kind === 'scalar' && /^(U?Int(8|16|32|64|128|256)|Float(32|64)|Bool|String)$/.test(base.name);
}
function copy(type: CHType): CHType {
  return Object.freeze(type.kind === 'Nullable' ? { kind: 'Nullable', inner: copy(type.inner) } : { ...type });
}
/** Only the library singleton is recognized; arbitrary match callbacks/tags are not evidence. */
export function userContract(def: { name: string; sqlName?: string; args: readonly Argument[]; returns: unknown; nullable?: 'never' | 'propagate'; deterministic: boolean; argumentPolicies?: unknown; repeatedArgs?: unknown }): UserFunctionContract | undefined {
  if (def.argumentPolicies !== undefined || def.repeatedArgs !== undefined || !def.returns || typeof def.returns !== 'object' || !('type' in def.returns)) return undefined;
  const result = def.returns.type as CHType;
  if (!userResultType(result)) return undefined;
  const args: UserArgumentContract[] = [];
  for (const arg of def.args) {
    if (arg === stringLike) args.push(Object.freeze({ kind: 'stringLike' }));
    else if (!('match' in arg) && 'type' in arg && userArgumentType(arg.type)) args.push(Object.freeze({ kind: 'column', type: copy(arg.type) }));
    else return undefined;
  }
  return Object.freeze({ version: 1, classification: 'scalar', name: def.name, ...(def.sqlName === undefined ? {} : { sqlName: def.sqlName }), args: Object.freeze(args), returns: copy(result), nullable: def.nullable ?? 'propagate', deterministic: def.deterministic });
}
