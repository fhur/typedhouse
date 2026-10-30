import { print, type CHType, type ExprNode } from '@chql/core';

/** Decoder-backed bounded result grammar. No Unknown-to-String fallback. */
function supported(type: CHType): boolean {
  switch (type.kind) {
    case 'scalar': return /^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool|Date|DateTime)$/.test(type.name);
    case 'FixedString': return Number.isSafeInteger(type.n) && type.n > 0;
    case 'DateTime': return type.tz === undefined || typeof type.tz === 'string';
    case 'DateTime64': return Number.isInteger(type.precision) && type.precision >= 0 && type.precision <= 3;
    case 'Nullable': case 'LowCardinality': case 'Array': return supported(type.inner);
    case 'Tuple': return type.items.every(i => supported(i.type)) && (type.items.every(i => i.name === undefined) || type.items.every(i => typeof i.name === 'string')) && new Set(type.items.filter(i => i.name !== undefined).map(i => i.name)).size === type.items.filter(i => i.name !== undefined).length;
    default: return false;
  }
}

/** Consistency with supplied immutable catalog evidence, not authentication of
 * a caller or proof of a current server catalog/result signature. */
export function resolveKnown(e: Extract<ExprNode, { kind: 'Call' | 'Agg' }>, resolve: (e: ExprNode) => CHType): { types: CHType[]; result: CHType; sqlName: string } {
  const evidence = e.fn.known;
  if (!evidence || evidence.name !== e.fn.name || !Object.hasOwn(evidence.catalog, e.fn.name)) throw new Error('invalid_known_evidence');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.fn.name)) throw new Error('invalid_function_name');
  const entry = evidence.catalog[e.fn.name]!;
  if (entry.isAggregate !== (e.kind === 'Agg') || e.fn.deterministic !== (entry.deterministic === true) || e.fn.sqlName !== undefined || e.fn.argumentPolicies !== undefined || e.fn.repeatedArgs !== undefined || e.fn.js !== undefined) throw new Error('invalid_function_metadata');
  if (entry.aliasTo !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.aliasTo)) throw new Error('invalid_function_alias');
  if (e.kind === 'Agg' && (e.fn.linear !== false || e.params.length || e.combinators.length)) throw new Error('unsupported_known_aggregate_parameters');
  const declaration = evidence.declaration;
  if (!declaration) throw new Error('known_result_undeclared');
  if (declaration.origin !== 'as' || print(declaration.type) !== print(e.type)) throw new Error('invalid_known_declaration');
  if (!supported(e.type)) throw new Error('unsupported_known_result');
  return { types: e.args.map(a => resolve(a)), result: e.type, sqlName: e.fn.name };
}
