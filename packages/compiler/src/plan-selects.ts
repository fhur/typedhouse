import { outputLeaves, type ExprNode, type Rel } from '@typedhouse/core';
import { deterministicExpression, safePredicate, totalPredicate } from './rewrite-expressions.js';
import { directSelection, type ColumnDemand } from './prune-columns.js';
import type { CtePlan } from './plan-ctes.js';

export type SelectClause = Extract<Rel, { kind: 'Filter' | 'Sort' | 'Limit' }>;
export interface SelectBlock {
  readonly source: { readonly kind: 'table'; readonly scan: Extract<Rel, { kind: 'Scan' }> }
    | { readonly kind: 'derived'; readonly rel: Rel }
    | { readonly kind: 'cte'; readonly rel: Rel }
    | { readonly kind: 'join'; readonly rel: Extract<Rel, { kind: 'Join' }> };
  readonly project?: Extract<Rel, { kind: 'Project' }>;
  /** Original nodes retain their expression bindings and diagnostic paths. */
  readonly clauses: readonly SelectClause[];
  readonly aggregate?: Extract<Rel, { kind: 'Aggregate' }>;
  readonly where?: readonly SelectClause[];
  /** DISTINCT flag; the select list is the node's full input leaf set. */
  readonly distinct?: Extract<Rel, { kind: 'Distinct' }>;
  /** One `[LEFT] ARRAY JOIN expr AS alias` directly after a single-scan FROM. */
  readonly arrayJoin?: Extract<Rel, { kind: 'ArrayJoin' }>;
}
export interface SqlPlan {
  readonly root: Rel;
  readonly blocks: ReadonlyMap<Rel, SelectBlock>;
  readonly columns?: ColumnDemand;
  readonly ctes?: CtePlan;
}
const rank = { Filter: 1, Sort: 2, Limit: 3 } as const;
function referencesName(e: import('@typedhouse/core').ExprNode, name: string): boolean {
  if (e.kind === 'ColumnRef') return e.path.length === 1 && e.path[0] === name;
  if (e.kind === 'Call' || e.kind === 'Agg') return e.args.some(a => referencesName(a, name));
  if (e.kind === 'Cast') return referencesName(e.expr, name);
  return e.kind !== 'Param'; // Unknown computations retain the fence.
}

/** Slice 4c: whether `e` can resolve `name` in a join-bound aggregate block. Qualified side references count (any path
 * element), as do `Raw`, `Subquery` and `Case`, conservatively; Params and Literals read nothing. */
function readsName(e: ExprNode, name: string): boolean {
  if (e.kind === 'ColumnRef') return e.path.includes(name);
  if (e.kind === 'Param' || e.kind === 'Literal') return false;
  if (e.kind === 'Call') return e.args.some(a => readsName(a, name));
  if (e.kind === 'Agg') return [...e.args, ...e.params].some(a => readsName(a, name));
  if (e.kind === 'Cast') return readsName(e.expr, name);
  return true; // Raw, Subquery, Case: unknown computations read every name.
}
const relInputs = (rel: Rel): readonly Rel[] => 'input' in rel ? [rel.input] : rel.kind === 'Join' ? rel.inputs.map(([, input]) => input) : rel.kind === 'Union' ? rel.inputs : [];
/** Slice 4c: every physical column name a join input can carry, whatever pruning keeps: the flat output of every
 * relational node in its subtree, nested join sides and derived/CTE inputs included, and each scan's full table schema. */
function physicalNames(rel: Rel, into = new Set<string>(), seen = new Set<Rel>()): Set<string> {
  if (seen.has(rel)) return into;
  seen.add(rel);
  if (rel.output.shape === 'flat') for (const leaf of outputLeaves(rel.output)) into.add(leaf.name);
  if (rel.kind === 'Scan') for (const name of Object.keys(rel.table.columns)) into.add(name);
  for (const input of relInputs(rel)) physicalNames(input, into, seen);
  return into;
}

/** Identity selections need no alias substitution and cannot duplicate evaluation. */
function isColumnSelection(rel: Extract<Rel, { kind: 'Project' }>): boolean {
  return rel.input.output.shape === 'flat' && Object.entries(rel.exprs).every(([name, expr]) =>
    expr.kind === 'ColumnRef' && expr.rel === rel.input.id && expr.path.length === 1 && expr.path[0] === name);
}

/** Lower validated IR into SELECT blocks without changing relational identities.
 * Every unhandled operator is a fence. Repeated total filters share WHERE; a filter
 * outside the total fragment keeps its own block over earlier filters, and repeated
 * sorts/limits and earlier clauses start new blocks. Identity selections can
 * fold before sorting/limiting without changing expression scopes; any selection
 * folds over a scan or join block whose clauses are Filters. Distinct sets
 * a flag before ORDER BY/LIMIT; one ArrayJoin folds directly after a scan FROM.
 */
export function planSelects(root: Rel, nodes: Iterable<Rel>, columns?: ColumnDemand, ctes?: CtePlan): SqlPlan {
  const blocks = new Map<Rel, SelectBlock>();
  const all = [...nodes];
  const parents = new Map<Rel, Set<Rel>>();
  for (const node of all) for (const input of relInputs(node)) parents.set(input, (parents.get(input) ?? new Set()).add(node));
  // Slice 4c: HAVING and ORDER BY name the aggregate's outputs unqualified. Any Filter or Sort reachable from the
  // Aggregate through Filter/Sort/Limit/Distinct parents may fold into its block, so each counts (conservatively).
  function clausesRead(rel: Rel, name: string): boolean {
    const seen = new Set<Rel>(), queue = [rel];
    for (let cur = queue.pop(); cur; cur = queue.pop()) for (const parent of parents.get(cur) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      if (parent.kind === 'Filter' ? readsName(parent.pred, name) : parent.kind === 'Sort' && parent.keys.some(k => readsName(k.expr, name))) return true;
      if (parent.kind === 'Filter' || parent.kind === 'Sort' || parent.kind === 'Limit' || parent.kind === 'Distinct') queue.push(parent);
    }
    return false;
  }
  // Slice 4c: under prefer_column_name_to_alias = 1 an unqualified output alias that equals a column of any join input
  // binds that column (or is ambiguous) instead of the alias. N is every physical column of every input. An output in N
  // keeps the Aggregate off the join block when HAVING, ORDER BY, another key or aggregate, the ON or the folded WHERE can
  // resolve its name. Identity reads (`name: side.name`) are exempt when no other input carries the name: the column the
  // name binds is then the grouped column itself. When another input carries it too, 24.8 binds the first input's column
  // (two inputs) or reports an ambiguous identifier (three), so only the unqualified positions, HAVING and ORDER BY, fence
  // it: the alias equals the side's own column, and a qualified reference is never captured (probed in every join kind).
  function joinShadow(rel: Extract<Rel, { kind: 'Aggregate' }>, join: Extract<Rel, { kind: 'Join' }>, where: readonly SelectClause[]): boolean {
    const sides = join.inputs.map(([, input]) => physicalNames(input));
    const outputs = [...Object.entries(rel.keys), ...Object.entries(rel.aggs)];
    return outputs.some(([name, e]) => {
      if (!sides.some(names => names.has(name))) return false;
      if (e.kind === 'ColumnRef' && e.path.length === 2 && e.path[1] === name) {
        const own = join.inputs.findIndex(([alias]) => alias === e.path[0]);
        return sides.some((names, i) => i !== own && names.has(name)) && clausesRead(rel, name);
      }
      return outputs.some(([other, expr]) => other !== name && readsName(expr, name)) || join.on.some(expr => readsName(expr, name))
        || where.some(n => n.kind === 'Filter' && readsName(n.pred, name)) || clausesRead(rel, name);
    });
  }
  function plan(rel: Rel): SelectBlock | undefined {
    const cached = blocks.get(rel);
    if (cached) return cached;
    let block: SelectBlock;
    if (rel.kind === 'Scan') {
      block = { source: Object.freeze({ kind: 'table', scan: rel }), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Join' && rel.on.every(
      // Every kind: a WHERE, select list or GROUP BY folded into a join block is evaluated over the
      // joined (null-extended) rows, exactly like the nested Filter/Project/Aggregate above the Join.
      e => e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'eq' && e.args.every(a => a.kind === 'ColumnRef'))) {
      block = { source: Object.freeze({ kind: 'join', rel }), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Project' && rel.input.output.shape === 'nested' && directSelection(rel)) {
      // A direct selection over a join block (or its folded WHERE clauses) is its select list. Over a derived
      // nested block with Filter-only clauses (a fallible filter above a join block) it folds the same way:
      // its qualified references read the derived table's leaves by name, so no alias can capture them.
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      if (!child || (child.source.kind !== 'join' && child.source.kind !== 'derived') || child.aggregate || child.project || child.distinct || child.clauses.some(n => n.kind !== 'Filter')) return undefined;
      block = { ...child, project: rel };
    } else if (rel.kind === 'Project' && isColumnSelection(rel)) {
      // A CTE already provides a scope: select its columns directly rather than
      // wrapping its reference in another SELECT. Do not fold its definition.
      const child: SelectBlock | undefined = ctes?.names.has(rel.input)
        ? { source: { kind: 'cte', rel: rel.input }, clauses: [] }
        : plan(rel.input);
      // Over a folded DISTINCT only a selection of the whole row folds: the DISTINCT list stays
      // the Distinct node's full leaf set, which a narrower selection would change.
      if (!child || child.aggregate || child.project || child.clauses.some(node => node.kind !== 'Filter')
        || child.distinct && Object.getOwnPropertyNames(rel.exprs).length !== outputLeaves(rel.input.output).length) return undefined;
      block = { ...child, source: Object.freeze(child.source), clauses: Object.freeze(child.clauses) };
    } else if (rel.kind === 'Project' && rel.input.output.shape === 'flat') {
      // Any selection folds over a scan block with Filter-only clauses: the select list is
      // evaluated on exactly the rows WHERE passes in both forms, so fallible or volatile
      // expressions keep their evaluation set (and their failures).
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      if (!child || child.source.kind !== 'table' || child.aggregate || child.project || child.distinct || child.clauses.some(n => n.kind !== 'Filter')) return undefined;
      // Alias shadowing is checked against the full physical schema, not the pruned
      // interface: under the default prefer_column_name_to_alias = 0 an output alias
      // replaces that name in every other expression of the SELECT, so a computed alias
      // equal to a column that a WHERE clause, the expansion or another select item reads
      // keeps its own scope (an expression may read the column it is itself aliased as).
      // The ARRAY JOIN alias is itself an alias: redefining it is always a fence.
      const names = new Set(outputLeaves(child.source.scan.output).map(l => l.name));
      const entries = Object.entries(rel.exprs);
      const identity = (name: string, e: ExprNode) => e.kind === 'ColumnRef' && e.path.length === 1 && e.path[0] === name;
      const others = [...child.clauses.map(n => n.kind === 'Filter' ? n.pred : undefined), child.arrayJoin?.expr].filter((e): e is ExprNode => !!e);
      if (entries.some(([name, e]) => !identity(name, e) && (name === child.arrayJoin?.alias || names.has(name)
        && [...others, ...entries.filter(([other]) => other !== name).map(([, expr]) => expr)].some(expr => referencesName(expr, name))))) return undefined;
      block = { ...child, project: rel };
    } else if (rel.kind === 'Distinct') {
      // The select list precedes ORDER BY/LIMIT, so DISTINCT folds over any block whose
      // clauses are Filters (WHERE, or HAVING on an aggregate block) and that has no flag yet.
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      block = child && !child.distinct && child.clauses.every(n => n.kind === 'Filter')
        ? { ...child, distinct: rel }
        : { source: Object.freeze({ kind: ctes?.names.has(rel.input) ? 'cte' : 'derived', rel: rel.input }), distinct: rel, clauses: Object.freeze([]) };
    } else if (rel.kind === 'ArrayJoin') {
      // ClickHouse allows one ARRAY JOIN per SELECT, written after the FROM item. A
      // WHERE in the same block runs after expansion: that is the same row set only
      // when every earlier Filter is total (an inner ARRAY JOIN drops empty-array rows
      // first) or the expansion is LEFT (every input row survives) and the Filter is
      // deterministic, since the text now evaluates it once per expanded row. A CTE
      // reference and a derived table are not folded; they keep the nested emission.
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      if (!child || child.source.kind !== 'table' || child.arrayJoin || child.aggregate || child.project || child.distinct
        || !child.clauses.every(n => n.kind === 'Filter' && (rel.left ? deterministicExpression(n.pred) : safePredicate(n.pred)))) return undefined;
      block = { ...child, arrayJoin: rel };
    } else if (rel.kind === 'Aggregate') {
      const sourceNames = new Set(outputLeaves(rel.input.output).map(l => l.name));
      // Alias substitution is server-setting-sensitive if an output shadows a
      // different source expression. Keep the explicit scope in that case. Over a CTE,
      // `name: agg(name)` keeps the block only while no HAVING/ORDER BY can name it
      // (slice 4c probe: under prefer_column_name_to_alias = 1 `HAVING n` binds `t0`.`n`, code 215).
      if ([...Object.entries(rel.keys), ...Object.entries(rel.aggs)].some(([name, e]) =>
        sourceNames.has(name) && !(e.kind === 'ColumnRef' && e.path.length === 1 && e.path[0] === name) &&
        !(ctes?.names.has(rel.input) && e.kind === 'Agg' && e.args.length === 1 && e.args[0]?.kind === 'ColumnRef' && e.args[0].path.length === 1 && e.args[0].path[0] === name &&
          [...Object.entries(rel.keys), ...Object.entries(rel.aggs)].every(([other, expression]) => other === name || !referencesName(expression, name)) && !clausesRead(rel, name)))) return undefined;
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      // An expanded scan block folds too: that block is emitted unqualified, so the
      // expansion alias and the source columns resolve alike in the aggregate clauses.
      // A join block folds unless an output alias can capture a side column (joinShadow): then the join block becomes a
      // derived table whose leaves are `__typedhouse_leaf_N`, which no alias can equal.
      const fold = child && !child.aggregate && !child.project && !child.distinct && (child.source.kind === 'table' || child.source.kind === 'join') && child.clauses.every(n => n.kind === 'Filter')
        && !(child.source.kind === 'join' && joinShadow(rel, child.source.rel, child.clauses));
      block = { source: fold ? child.source : Object.freeze({ kind: ctes?.names.has(rel.input) ? 'cte' : 'derived', rel: rel.input }),
        aggregate: rel, where: fold ? child.clauses : Object.freeze([]), clauses: Object.freeze([]), ...(fold && child.arrayJoin ? { arrayJoin: child.arrayJoin } : {}) };
    } else if (rel.kind === 'Filter' || rel.kind === 'Sort' || rel.kind === 'Limit') {
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      const last = child?.clauses.at(-1);
      const safe = !child?.aggregate || (rel.kind === 'Filter' ? safePredicate(rel.pred) : rel.kind === 'Sort' ? rel.keys.every(k => k.expr.kind === 'ColumnRef') : true);
      // Consecutive Filters share one WHERE (or HAVING) only when every predicate is total, exactly what
      // MergeFilter merges: the server evaluates the conjuncts of one clause in its own order (multi-step
      // PREWHERE, push-down below a join), so a predicate outside the total fragment must only ever see the
      // rows the earlier filters pass, and a later total conjunct must not be AND-ed into it either. The
      // first Filter of a block always folds; nothing can be reordered against it.
      const together = rel.kind !== 'Filter' || last?.kind !== 'Filter'
        || (totalPredicate(rel.pred) && child!.clauses.every(n => n.kind !== 'Filter' || totalPredicate(n.pred)));
      // WHERE precedes DISTINCT; a Filter above a folded Distinct opens a new block.
      block = child && !child.project && safe && together && !(child.distinct && rel.kind === 'Filter') && (!last || rank[last.kind] < rank[rel.kind] || (last.kind === 'Filter' && rel.kind === 'Filter'))
        ? { ...child, clauses: Object.freeze([...child.clauses, rel]) }
        : { source: Object.freeze({ kind: ctes?.names.has(rel.input) ? 'cte' : 'derived', rel: rel.input }), clauses: Object.freeze([rel]) };
    } else return undefined;
    blocks.set(rel, Object.freeze(block));
    return block;
  }
  // The validated node index includes branches and expression subqueries.
  for (const node of all) plan(node);
  return Object.freeze({ root, blocks, ...(columns ? { columns } : {}), ...(ctes ? { ctes } : {}) });
}
