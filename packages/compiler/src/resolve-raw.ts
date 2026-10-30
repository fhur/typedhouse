import type { CHType, ExprNode } from '@chql/core';
import { supportedResultDescriptor } from './resolve-known.js';

/** Shape safety precedes this semantic guard. Text remains an author assertion. */
export function resolveRaw(e: Extract<ExprNode, { kind: 'Raw' }>, resolve: (e: ExprNode) => CHType): CHType {
  if (e.resolution !== 'declared' || e.type === null) throw new Error('raw_result_undeclared');
  if (e.opaque !== true || e.provenance.origin !== 'sql' || e.parts.length !== e.args.length + 1) throw new Error('invalid_raw_expression');
  if (!supportedResultDescriptor(e.type)) throw new Error('unsupported_raw_result');
  for (const arg of e.args) resolve(arg);
  return e.type;
}
