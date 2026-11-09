import type { CompiledQuery, Rel } from '@typedhouse/core';
import { emitPlanned, validateRel } from './emit-naive.js';
import { planSelects } from './plan-selects.js';
import { peelSettings } from './settings.js';
import { rewriteRel } from './rewrite-rel.js';
import { pruneColumns } from './prune-columns.js';
import { planCtes } from './plan-ctes.js';

/** Validate original diagnostics before rewriting; plan the rewritten node index. */
export function compile(query: Rel): CompiledQuery {
  const { input: root, settings } = peelSettings(query);
  const original = validateRel(root);
  const rewritten = rewriteRel(root).root;
  const validated = rewritten === root ? original : validateRel(rewritten);

  const plan = planSelects(
    rewritten,
    Object.values(validated.nodes),
    pruneColumns(rewritten),
    planCtes(rewritten),
  );

  const emitted = emitPlanned(plan, settings);
  // Public diagnostics describe the caller's graph, not synthetic rewrite nodes.
  return Object.freeze({ ...emitted, nodes: original.nodes });
}
