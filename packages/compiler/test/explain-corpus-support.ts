import { outputLeaves, type ExprNode, type Rel } from '@typedhouse/core';
import { validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { planSelects, type SelectBlock, type SqlPlan } from '../src/plan-selects.js';
import { pruneColumns, type ColumnDemand } from '../src/prune-columns.js';
import { mapExpression } from '../src/rewrite-expressions.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import type { FenceKind } from './fixtures/corpus/explain-corpus.js';

/** IR kinds that justify a SELECT boundary; `CTE` and `Subquery` are emission roles. */
const fenceNodes = new Set<string>(['Aggregate', 'Sort', 'Limit', 'Distinct', 'Union', 'Join', 'ArrayJoin', 'RawRel', 'Materialize']);
export type Role = 'root' | 'cte' | 'cte-ref' | 'subquery' | 'union-branch' | 'union-input' | 'join-input' | 'derived';
export interface EmittedSelect { readonly rel: Rel; readonly role: Role; readonly consumer?: Rel; readonly fence: FenceKind | 'unfenced' | 'root' }
export interface Structure {
  readonly rewritten: Rel;
  readonly plan: SqlPlan;
  readonly columns: ColumnDemand;
  /** One entry per SELECT the planned emission writes, in emission order. */
  readonly selects: readonly EmittedSelect[];
  /** Fence kinds present anywhere in the graph (CTE bodies and subquery scopes included). */
  readonly fences: ReadonlySet<FenceKind>;
  /** Fence kinds ClickHouse plans in the main pipeline (subquery scopes excluded). */
  readonly planned: ReadonlySet<FenceKind>;
  /** Scan occurrences per table as ClickHouse plans them: CTE bodies once per reference, subquery scopes excluded. */
  readonly scans: ReadonlyMap<string, number>;
  /** Pruned column names of every Scan node per table. */
  readonly demand: ReadonlyMap<string, readonly (readonly string[])[]>;
}
function expressions(rel: Rel): readonly ExprNode[] {
  const values = (r: Readonly<Record<string, ExprNode>>) => Object.getOwnPropertyNames(r).map(k => r[k]!);
  switch (rel.kind) {
    case 'Filter': return [rel.pred];
    case 'Project': return values(rel.exprs);
    case 'Aggregate': return [...values(rel.keys), ...values(rel.aggs)];
    case 'Join': return rel.on;
    case 'Sort': return rel.keys.map(k => k.expr);
    case 'ArrayJoin': return [rel.expr];
    case 'RawRel': return rel.args;
    default: return [];
  }
}
function subqueries(es: readonly ExprNode[]): Rel[] {
  const out: Rel[] = [];
  for (const e of es) mapExpression(e, r => r, sub => { out.push(sub); return sub; });
  return out;
}
const children = (rel: Rel): readonly Rel[] => 'input' in rel ? [rel.input] : rel.kind === 'Join' ? rel.inputs.map(([, r]) => r) : rel.kind === 'Union' ? rel.inputs : [];

/** Mirror `emitPlanned`: which nodes open a SELECT, and which fence justifies each boundary. */
export function structure(root: Rel): Structure {
  const rewritten = rewriteRel(root).root;
  const columns = pruneColumns(rewritten), ctes = planCtes(rewritten);
  const plan = planSelects(rewritten, Object.values(validateRel(rewritten).nodes), columns, ctes);
  const selects: EmittedSelect[] = [];
  const fenceOf = (rel: Rel, role: Role, consumer?: Rel): EmittedSelect['fence'] => {
    switch (role) {
      case 'root': return 'root';
      case 'cte': case 'cte-ref': return 'CTE';
      case 'subquery': return 'Subquery';
      case 'union-branch': case 'union-input': return 'Union';
      case 'join-input': return 'Join';
      case 'derived': return fenceNodes.has(consumer!.kind) ? consumer!.kind as FenceKind : fenceNodes.has(rel.kind) ? rel.kind as FenceKind : 'unfenced';
    }
  };
  const push = (rel: Rel, role: Role, consumer?: Rel) => selects.push({ rel, role, ...(consumer ? { consumer } : {}), fence: fenceOf(rel, role, consumer) });
  const scoped = (es: readonly ExprNode[], consumer: Rel) => { for (const sub of subqueries(es)) emit(sub, 'subquery', consumer); };
  function emit(rel: Rel, role: Role, consumer?: Rel): void {
    if (ctes.names.has(rel)) { push(rel, 'cte-ref', consumer); return; }
    node(rel, role, consumer);
  }
  function node(rel: Rel, role: Role, consumer?: Rel): void {
    const block = plan.blocks.get(rel);
    if (block) { emitBlock(rel, block, role, consumer); return; }
    switch (rel.kind) {
      case 'Union':
        for (const input of rel.inputs) { push(input, 'union-branch', rel); emit(input, 'union-input', rel); }
        return;
      case 'Join':
        push(rel, role, consumer);
        for (const [, child] of rel.inputs) emit(child, 'join-input', rel);
        scoped(rel.on, rel);
        return;
      case 'Materialize': emit(rel.input, role, consumer); return; // Planned CTE definitions render their input directly.
      default:
        push(rel, role, consumer);
        if ('input' in rel) emit(rel.input, 'derived', rel);
        scoped(expressions(rel), rel);
    }
  }
  function emitBlock(rel: Rel, block: SelectBlock, role: Role, consumer?: Rel): void {
    push(rel, role, consumer);
    const stop = block.source.kind === 'table' ? block.source.scan : block.source.rel;
    let opener: Rel = rel;
    const es: ExprNode[] = [];
    for (let cur: Rel = rel; cur !== stop; cur = (cur as Extract<Rel, { input: Rel }>).input) { opener = cur; es.push(...expressions(cur)); }
    if (block.source.kind === 'derived') emit(block.source.rel, 'derived', opener);
    if (block.source.kind === 'join') {
      const join = block.source.rel;
      for (const [, child] of join.inputs) {
        if (ctes.names.has(child)) continue; // The CTE name is the FROM item.
        if (child.kind === 'Scan' && (columns.get(child) ?? outputLeaves(child.output)).length === outputLeaves(child.output).length) continue;
        emit(child, 'join-input', join);
      }
      es.push(...join.on);
    }
    scoped(es, rel);
  }
  for (const def of ctes.definitions) node(def, 'cte');
  emit(rewritten, 'root');
  // Fence kinds, scan occurrences and demand, from the rewritten graph.
  const fences = new Set<FenceKind>(), planned = new Set<FenceKind>();
  const scans = new Map<string, number>(), demand = new Map<string, (readonly string[])[]>();
  if (ctes.definitions.length) { fences.add('CTE'); planned.add('CTE'); }
  const seen = new Set<Rel>();
  function visit(rel: Rel, main: boolean): void {
    if (fenceNodes.has(rel.kind)) { fences.add(rel.kind as FenceKind); if (main) planned.add(rel.kind as FenceKind); }
    if (rel.kind === 'Scan' && main) scans.set(rel.table.name, (scans.get(rel.table.name) ?? 0) + 1);
    if (!seen.has(rel)) {
      seen.add(rel);
      if (rel.kind === 'Scan') demand.set(rel.table.name, [...(demand.get(rel.table.name) ?? []), (columns.get(rel) ?? outputLeaves(rel.output)).map(l => l.name)]);
    }
    for (const child of children(rel)) visit(child, main);
    const subs = subqueries(expressions(rel));
    if (subs.length) { fences.add('Subquery'); if (main) planned.add('Subquery'); }
    for (const sub of subs) visit(sub, false);
  }
  visit(rewritten, true);
  return { rewritten, plan, columns, selects, fences, planned, scans, demand };
}

/** EXPLAIN PLAN step types of clickhouse/clickhouse-server:24.8, pinned. Base steps need no fence; every other
 * type must be justified by a fence kind present in the IR. */
export const stepTypes = Object.freeze({
  base: Object.freeze(['Expression', 'Filter', 'ReadFromMergeTree', 'ReadFromMemoryStorage', 'ReadFromStorage']),
  byFence: Object.freeze<Record<FenceKind, readonly string[]>>({
    Aggregate: ['Aggregating', 'MergingAggregated'], Sort: ['Sorting'], Limit: ['Limit', 'Offset'], Distinct: ['Distinct'], Union: ['Union'],
    Join: ['Join'], ArrayJoin: ['ArrayJoin'], Subquery: ['CreatingSets', 'CreatingSet'], CTE: [], RawRel: [], Materialize: [],
  }),
});
export interface PlanStep { readonly type: string; readonly description: string; readonly header: readonly string[]; readonly children: readonly PlanStep[] }
/** `EXPLAIN PLAN json = 1, header = 1` output. */
export function parseExplainJson(text: string): PlanStep[] {
  type Node = { 'Node Type': string; Description?: string; Header?: { Name: string }[]; Plans?: Node[] };
  const step = (n: Node): PlanStep => ({ type: n['Node Type'], description: n.Description ?? '', header: (n.Header ?? []).map(h => h.Name), children: (n.Plans ?? []).map(step) });
  return (JSON.parse(text) as { Plan: Node }[]).map(p => step(p.Plan));
}
/** Indented `EXPLAIN PLAN header = 1` text, for servers without json output. */
export function parseExplainText(text: string): PlanStep[] {
  const roots: PlanStep[] = [], stack: { depth: number; step: PlanStep & { children: PlanStep[]; header: string[] } }[] = [];
  let inHeader = false;
  for (const line of text.split('\n')) {
    const step = /^(\s*)([A-Za-z]+)(?: \((.*)\))?\s*$/.exec(line);
    const header = /^\s*Header: (.*)$/.exec(line);
    if (header) { inHeader = true; stack.at(-1)!.step.header.push(header[1]!.trim().split(/\s+/)[0]!); continue; }
    if (step) {
      inHeader = false;
      const depth = step[1]!.length, node = { type: step[2]!, description: step[3] ?? '', header: [] as string[], children: [] as PlanStep[] };
      while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
      (stack.length ? stack.at(-1)!.step.children : roots).push(node);
      stack.push({ depth, step: node });
    } else if (inHeader && line.trim()) stack.at(-1)!.step.header.push(line.trim().split(/\s+/)[0]!);
  }
  return roots;
}
export function flatten(steps: readonly PlanStep[]): PlanStep[] { return steps.flatMap(s => [s, ...flatten(s.children)]); }
/** The analyzer qualifies header columns as `__tableN.name`; MergeTree reads print bare names. */
export const columnName = (header: string) => header.replace(/^__table\d+\./, '');
/** Physical columns a MergeTree read header stands for: a PREWHERE expression kept in the header (`plus(__table1.x, …)`)
 * reads the identifiers it names; a subcolumn (`ids.size0`, `n.null`) reads part of its parent `known` column. */
export function headerColumns(header: readonly string[], known: readonly string[]): string[] {
  return [...new Set(header.flatMap(entry => {
    if (entry.includes('(')) return [...entry.matchAll(/__table\d+\.([A-Za-z_]\w*)/g)].map(m => m[1]!);
    const name = columnName(entry), parent = name.split('.')[0]!;
    return [known.includes(name) || !known.includes(parent) ? name : parent];
  }))];
}
export const readTable = (step: PlanStep) => step.type === 'ReadFromMergeTree' ? /^default\.(.+)$/.exec(step.description)?.[1] : undefined;
