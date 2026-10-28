import type { CompiledQuery, Rel } from '@chql/core';
import { emitPlanned, validateRel } from './emit-naive.js';
import { planSelects } from './plan-selects.js';

/** Validation → SQL-block planning → emission.
 * Future equivalence-preserving relational rewrites belong between validation
 * and planning; SQL nesting decisions belong exclusively to the planner.
 */
export function compile(root: Rel): CompiledQuery {
  const validated = validateRel(root);
  const plan = planSelects(root, Object.values(validated.nodes));
  return emitPlanned(plan);
}
