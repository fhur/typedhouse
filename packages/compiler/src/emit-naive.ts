import { print, scalarDescriptor, outputLeaves, expandedOutput, type CHType, type CompiledQuery, type ExprNode, type Rel } from '@chql/core';
import type { SqlPlan } from './plan-selects.js';
import { parameterExpression, parameterWireType, serializeParameter } from './parameters.js';
import { resolveAggregate, resolveCall, resolveCast } from './resolve.js';

import { validateStructure } from './validate-structure.js';
import { ValidationError } from './validation-error.js';
export { ValidationError } from './validation-error.js';
export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name.includes('\0')) throw new Error('invalid_identifier');
  return '`' + name.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`';
}
const same = (a: CHType, b: CHType) => print(a) === print(b);
function hasAggregate(e: ExprNode): boolean {
  return e.kind === 'Agg' || (e.kind === 'Call' && e.args.some(hasAggregate)) || (e.kind === 'Cast' && hasAggregate(e.expr));
}
function base(t: CHType): CHType { return t.kind === 'Nullable' || t.kind === 'LowCardinality' ? base(t.inner) : t; }
/** Permanent one-subquery-per-node reference backend. Unsupported IR is rejected. */
export function emitNaive(root: Rel): CompiledQuery {
  return emitQuery(root);
}

/** Transitional validation adapter: reuse the reference backend's complete checks.
 * Its SQL is discarded.
 */
export function validateRel(root: Rel): CompiledQuery {
  return emitQuery(root);
}

export function emitPlanned(plan: SqlPlan): CompiledQuery {
  return emitQuery(plan.root, plan);
}

function emitQuery(root: Rel, plan?: SqlPlan): CompiledQuery {
  // Planned emission follows validateRel; preflight once per public compilation.
  if (!plan) validateStructure(root);
  const rendered = new Map<Rel, string>();
  const clauses = new Map<Rel, string>();
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  const parameterTypes: Record<string, CHType> = Object.create(null) as Record<string, CHType>;
  const nodes: Record<string, Rel> = Object.create(null) as Record<string, Rel>;
  const assigned = new Map<ExprNode, { name: string; type: CHType }>();
  const active = new Set<Rel>();
  let cteIndex = 0;
  let weekBucketing = false;
  let dateMembership = false;
  // Each derived input owns this local SQL scope; ColumnRefs never bind SELECT aliases.
  const inputAlias = quoteIdentifier(plan?.ctes?.inputAlias ?? '__chql_input');
  const defined = new Set<Rel>();
  const joinAlias = (rel: Rel, alias: string) => quoteIdentifier(plan?.ctes?.aliases.get(rel)?.get(alias) ?? alias);
  // A physical-table block has no competing input or SELECT aliases. Derived
  // scopes retain qualification; logical ColumnRef binding stays unchanged.
  function blockQualifier(rel: Rel): string {
    const source = plan?.blocks.get(rel)?.source;
    if (source?.kind === 'cte') return quoteIdentifier(plan!.ctes!.names.get(source.rel)!);
    return source?.kind === 'table' ? '' : inputAlias;
  }
  function fail(code: string, node: unknown, path: string, detail = ''): never { throw new ValidationError(code, node, path, detail); }
  function resolvedType(e: ExprNode, expected?: CHType): CHType {
    if (e.kind === 'Subquery') {
      if (e.usage !== 'scalar') throw new Error('invalid_subquery_usage');
      const type = scalarDescriptor(e.rel);
      if (!same(type, e.type)) throw new Error('invalid_expression_type');
      return type;
    }
    if (e.kind === 'Cast') return resolveCast(e, resolvedType);
    if (e.kind === 'Agg') return resolveAggregate(e, resolvedType).result;
    if (e.kind === 'Call') return resolveCall(e, resolvedType).result;
    const type = e.type ?? expected;
    if (!type) throw new Error('param_untyped');
    return e.kind === 'Param' && e.value === null && type.kind !== 'Nullable' ? { kind: 'Nullable', inner: type } : type;
  }
  function expression(e: ExprNode, input: Rel, path: string, expected?: CHType, index = false, scope: 'row' | 'aggregate' | 'operand' = 'row', qualifier = inputAlias, binding?: Extract<Rel, { kind: 'Join' }>): string {
    if (!e || typeof e !== 'object') return fail('invalid_expression', e, path);
    switch (e.kind) {
      case 'ColumnRef': {
        if (scope === 'aggregate' || (e.mode === 'grouped' && scope !== 'operand') || (e.mode === 'row' && scope === 'operand')) return fail('invalid_expression_mode', e, path);
        const scopeId = !binding && qualifier === '' && input.kind === 'Join' ? input.scope ?? input.id : input.id;
        if (e.rel !== scopeId) return fail('unbound_column', e, path, `reference ${e.rel}, input ${scopeId}`);
        const leaf = outputLeaves(input.output).find(l => JSON.stringify(l.path) === JSON.stringify(e.path));
        if (!leaf || !same(e.type, leaf.type)) return fail('unbound_column', e, path, JSON.stringify(e.path));
        if (binding || (qualifier === '' && input.kind === 'Join')) {
          const join = binding ?? input;
          if (join.kind !== 'Join') return fail('unbound_column', e, path);
          const side = join.inputs.find(([alias]) => alias === e.path[0]);
          const child = side && (plan?.columns?.get(side[1]) ?? outputLeaves(side[1].output)).find(l => JSON.stringify(l.path) === JSON.stringify(e.path.slice(1)));
          if (!side || !child) return fail('unbound_column', e, path);
          return `${joinAlias(join, side[0])}.${quoteIdentifier(child.name)}`;
        }
        const physical = plan?.columns?.get(input);
        if (physical && !physical.some(l => l.name === leaf.name)) return fail('missing_physical_column', e, path);
        return `${qualifier ? `${qualifier}.` : ''}${quoteIdentifier(leaf.name)}`;
      }
      case 'Param': {
        const type = e.type ?? expected;
        if (!type) return fail('param_untyped', e, path);
        if (expected && !same(base(type), base(expected))) return fail('param_incompatible', e, path);
        let value: string;
        try { value = serializeParameter(index && typeof e.value === 'number' && Number.isSafeInteger(e.value) ? BigInt(e.value) : e.value, type); } catch (error) { return fail('param_incompatible', e, path, String(error)); }
        const previous = assigned.get(e);
        if (previous && !same(previous.type, type)) return fail('param_incompatible', e, path, 'same Param used with different types');
        // Bare NULL is Nullable(Nothing), losing the operand's common-type evidence.
        if (e.value === null) return `CAST(NULL AS ${print(type)})`;
        const name = previous?.name ?? `p${assigned.size}`;
        assigned.set(e, { name, type }); params[name] = value; parameterTypes[name] = parameterWireType(type);
        return parameterExpression(name, type);
      }
      case 'Subquery': {
        if (scope !== 'row') return fail('invalid_expression_mode', e, path);
        try { resolvedType(e); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_subquery', e, path); }
        // Same allocator/active graph, but emit establishes a fresh inner column scope.
        return `(${emit(e.rel, `${path}.rel`)})`;
      }
      case 'Cast': {
        let target: CHType;
        try { target = resolveCast(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_cast', e, path); }
        // The operand retains its own descriptor/Param identity and original scope.
        return `CAST(${expression(e.expr, input, `${path}.expr`, undefined, false, scope, qualifier, binding)} AS ${print(target)})`;
      }
      case 'Agg': {
        if (scope !== 'aggregate') return fail('invalid_aggregate_placement', e, path);
        let resolved: ReturnType<typeof resolveAggregate>;
        try { resolved = resolveAggregate(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_aggregate', e, path); }
        const parameters = e.params.length ? `(${e.params.map((p, i) => expression(p, input, `${path}.params[${i}]`, undefined, false, 'operand', qualifier, binding)).join(', ')})` : '';
        return `${resolved.sqlName}${parameters}(${e.args.map((a, i) => expression(a, input, `${path}.args[${i}]`, undefined, false, 'operand', qualifier, binding)).join(', ')})`;
      }
      case 'Call': {
        let resolved: ReturnType<typeof resolveCall>;
        try { resolved = resolveCall(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_call', e, path); }
        const args = e.args.map((arg, i) => {
          // Only the authoritative membership resolver grants this set position.
          if ((e.fn.name === 'in' || e.fn.name === 'notIn') && i === 1 && arg.kind === 'Subquery') {
            return `(${emit(arg.rel, `${path}.args[${i}].rel`)})`;
          }
          return expression(arg, input, `${path}.args[${i}]`, resolved.types[i], e.fn.name === 'arrayElement' && i === 1 && arg.kind === 'Param' && arg.type === null, scope, qualifier, binding);
        });
        if (e.fn.name === 'in' || e.fn.name === 'notIn') {
          const receiver = resolved.types[0]!;
          const base = receiver.kind === 'Nullable' ? receiver.inner : receiver;
          if (base.kind === 'scalar' && base.name === 'Date') dateMembership = true;
        }
        // Parenthesize every operand: planned children may be infix expressions.
        // The catalog resolver has already checked arity, families and repeatability.
        if (e.fn.name === 'between') return `((${args[0]}) BETWEEN (${args[1]}) AND (${args[2]}))`;
        if (e.fn.name === 'toStartOfWeek') {
          weekBucketing = true;
          // Date32 preserves pre-epoch weeks for the explicit range check. Converting
          // to Date first would silently clamp/wrap. toDate32 retains the input's
          // calendar timezone; Date output represents that day at UTC midnight.
          const week = `toStartOfWeek(toDate32(${args[0]}), 0)`;
          return `addDays(toDate(${week}), throwIf(ifNull((${week} < toDate32('1970-01-01')) OR (${week} > toDate32('2149-06-06')), 0), 'chql_date_out_of_range'))`;
        }
        if (plan) {
          const operators: Record<string, readonly [string, number]> = { or: ['OR', 1], and: ['AND', 2], eq: ['=', 3], ne: ['!=', 3], lt: ['<', 3], le: ['<=', 3], gt: ['>', 3], ge: ['>=', 3], plus: ['+', 4], minus: ['-', 4], multiply: ['*', 5], divide: ['/', 5] };
          const operator = operators[e.fn.name];
          if (operator) return args.map((sql, i) => {
            const child = e.args[i]!;
            const inner = child.kind === 'Call' ? operators[child.fn.name] : undefined;
            // Preserve the expression tree, including floating point association.
            return inner && (inner[1] < operator[1] || inner[1] === operator[1] && (operator[1] === 3 || i > 0 && operator[1] >= 4)) ? `(${sql})` : sql;
          }).join(` ${operator[0]} `);
        }
        // Retain the permanent naive equality SQL contract.
        return e.fn.name === 'eq' ? `(${args[0]} = ${args[1]})` : `${resolved.sqlName}(${args.join(', ')})`;
      }
      default: return fail('unsupported_expression', e, path, e.kind);
    }
  }
  /** Clause-level AND has the same precedence as expression-level AND. Only
   * planned OR is non-atomic here; naive calls retain their permanent spelling. */
  function conjunction(predicates: readonly { expr: ExprNode; sql: string }[]): string {
    return predicates.map(({ expr, sql }) => plan && predicates.length > 1 && expr.kind === 'Call' && expr.fn.name === 'or' ? `(${sql})` : sql).join(' AND ');
  }
  /** Physical occurrences retain source order and full child transport paths. */
  function joinSource(join: Extract<Rel, { kind: 'Join' }>, path: string, separator: string): string {
    const conditions = join.inputs.map(() => [] as ExprNode[]);
    for (const e of join.on) {
      if (e.kind !== 'Call') return fail('invalid_join_condition', e, path);
      const indices = e.args.map(a => a.kind === 'ColumnRef' ? join.inputs.findIndex(([alias]) => alias === a.path[0]) : -1);
      const position = Math.max(...indices);
      if (position < 1) return fail('join_condition_arity', e, path);
      conditions[position]!.push(e);
    }
    return join.inputs.map(([alias, child], i) => {
      const cte = plan?.ctes?.names.get(child);
      if (cte && !defined.has(child)) return fail('cte_visibility', child, path);
      const full = outputLeaves(child.output);
      const physical = plan?.columns?.get(child) ?? full;
      const source = cte ? quoteIdentifier(cte) : child.kind === 'Scan' && physical.length === full.length
        ? quoteIdentifier(child.table.name)
        : `(${emit(child, `${path}.inputs[${i}]`)})`;
      const hints = !cte && child.kind === 'Scan' && physical.length === full.length ? `${child.final ? ' FINAL' : ''}${child.sample === undefined ? '' : ` SAMPLE ${child.sample}`}` : '';
      const on = i && join.joinKind !== 'cross' ? ` ON ${conditions[i]!.map((e, j) => expression(e, join, `${path}.on[${j}]`, undefined, false, 'row', '')).join(' AND ')}` : '';
      return `${i ? `${separator}${join.joinKind === 'cross' ? 'CROSS JOIN' : 'INNER ALL JOIN'} ` : ''}${source} AS ${joinAlias(join, alias)}${hints}${on}`;
    }).join('');
  }
  function renderBlock(rel: Rel, order: readonly string[], path = 'root'): string {
    const block = plan!.blocks.get(rel)!;
    const binding = block.source.kind === 'join' ? block.source.rel : undefined;
    const separator = binding && rel === root ? '\n' : ' ';
    if (block.aggregate) {
      const aggregate = block.aggregate;
      const qualifier = block.source.kind === 'cte' ? '' : inputAlias;
      // SELECT precedes even a derived FROM in final textual parameter order.
      // Qualify source references; HAVING/ORDER deliberately use output aliases.
      const keys = Object.entries(aggregate.keys).map(([name, e]) => [name, expression(e, aggregate.input, `${path}.keys.${name}`, undefined, false, 'row', qualifier, binding)] as const);
      const items = [...keys.map(([name, sql]) => sql === quoteIdentifier(name) ? sql : `${sql} AS ${quoteIdentifier(name)}`),
        ...Object.entries(aggregate.aggs).map(([name, e]) => `${expression(e, aggregate.input, `${path}.aggs.${name}`, undefined, false, 'aggregate', qualifier, binding)} AS ${quoteIdentifier(name)}`)];
      const source = block.source.kind === 'table'
        ? `${quoteIdentifier(block.source.scan.table.name)} AS ${inputAlias}${block.source.scan.final ? ' FINAL' : ''}${block.source.scan.sample === undefined ? '' : ` SAMPLE ${block.source.scan.sample}`}`
        : block.source.kind === 'join' ? joinSource(block.source.rel, path, separator)
        : block.source.kind === 'cte' ? quoteIdentifier(plan!.ctes!.names.get(block.source.rel)!)
        : `(${emit(block.source.rel, `${path}.source`)}) AS ${inputAlias}`;
      const where = (block.where ?? []).map((node, i) => {
        if (node.kind !== 'Filter') throw new Error('invalid_aggregate_where');
        return { expr: node.pred, sql: expression(node.pred, node.input, `${path}.where[${i}]`, undefined, false, 'row', qualifier, binding) };
      });
      const having: { expr: ExprNode; sql: string }[] = [], tails: string[] = [];
      for (const [i, node] of block.clauses.entries()) {
        const p = `${path}.clauses[${i}]`;
        if (node.kind === 'Filter') having.push({ expr: node.pred, sql: expression(node.pred, node.input, `${p}.pred`, undefined, false, 'row', '') });
        else if (node.kind === 'Sort') tails.push(` ORDER BY ${node.keys.map((k, j) => `${expression(k.expr, node.input, `${p}.keys[${j}]`, undefined, false, 'row', '')} ${k.dir.toUpperCase()}${k.nulls === undefined ? '' : ` NULLS ${k.nulls.toUpperCase()}`}`).join(', ')}`);
        else tails.push(` LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`);
      }
      return `SELECT ${items.join(', ')}${separator}FROM ${source}${where.length ? `${separator}WHERE ${conjunction(where)}` : ''}${keys.length ? `${separator}GROUP BY ${keys.map(([, sql]) => sql).join(', ')}` : ''}${having.length ? `${separator}HAVING ${conjunction(having)}` : ''}${tails.map(t => separator + t.slice(1)).join('')}`;
    }
    if (binding) {
      const selected = plan?.columns?.get(rel) ?? outputLeaves(rel.output);
      const items = selected.map(leaf => {
        if (block.project) {
          const e = block.project.exprs[leaf.name]!;
          return `${expression(e, block.project.input, `${path}.exprs.${leaf.name}`, undefined, false, 'row', inputAlias, binding)} AS ${quoteIdentifier(leaf.name)}`;
        }
        const side = binding.inputs.find(([alias]) => alias === leaf.path[0])!;
        const child = outputLeaves(side[1].output).find(l => JSON.stringify(l.path) === JSON.stringify(leaf.path.slice(1)))!;
        return `${joinAlias(binding, side[0])}.${quoteIdentifier(child.name)} AS ${quoteIdentifier(leaf.name)}`;
      });
      const source = joinSource(binding, path, separator);
      const predicates: string[] = [], tails: string[] = [];
      for (const node of block.clauses) {
        if (node.kind === 'Filter') predicates.push(`(${expression(node.pred, node.input, path, undefined, false, 'row', inputAlias, binding)})`);
        else if (node.kind === 'Sort') tails.push(`${separator}ORDER BY ${node.keys.map(k => `${expression(k.expr, node.input, path, undefined, false, 'row', inputAlias, binding)} ${k.dir.toUpperCase()}${k.nulls ? ` NULLS ${k.nulls.toUpperCase()}` : ''}`).join(', ')}`);
        else tails.push(`${separator}LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`);
      }
      return `SELECT ${items.join(', ')}${separator}FROM ${source}${predicates.length ? `${separator}WHERE ${predicates.join(' AND ')}` : ''}${tails.join('')}`;
    }
    // Allocate projection Params before WHERE Params, matching textual SQL order.
    const qualifier = blockQualifier(rel);
    const items = order.map(k => block.project
      ? `${expression(block.project.exprs[k]!, block.project.input, `${path}.exprs.${k}`, undefined, false, 'row', qualifier)} AS ${quoteIdentifier(k)}`
      : `${qualifier ? `${qualifier}.` : ''}${quoteIdentifier(k)}`);
    let from: string;
    if (block.source.kind === 'table') {
      const scan = block.source.scan;
      from = `${quoteIdentifier(scan.table.name)}${scan.final ? ' FINAL' : ''}${scan.sample === undefined ? '' : ` SAMPLE ${scan.sample}`}`;
    } else if (block.source.kind === 'cte') {
      if (!defined.has(block.source.rel)) return fail('cte_visibility', block.source.rel, path);
      from = quoteIdentifier(plan!.ctes!.names.get(block.source.rel)!);
    } else {
      from = `(${emit(block.source.rel, `${path}.source`)}) AS ${inputAlias}`;
    }
    // Render only the final block, in textual order. Never eagerly emit folded
    // children: their discarded SELECTs could allocate Params out of order.
    const predicates: { expr: ExprNode; sql: string }[] = [];
    const tails: string[] = [];
    for (const [i, node] of block.clauses.entries()) {
      const p = `${path}.clauses[${i}]`;
      if (node.kind === 'Filter') predicates.push({ expr: node.pred, sql: expression(node.pred, node.input, `${p}.pred`, undefined, false, 'row', qualifier) });
      else if (node.kind === 'Sort') tails.push(` ORDER BY ${node.keys.map((key, j) => `${expression(key.expr, node.input, `${p}.keys[${j}].expr`, undefined, false, 'row', qualifier)} ${key.dir.toUpperCase()}${key.nulls === undefined ? '' : ` NULLS ${key.nulls.toUpperCase()}`}`).join(', ')}`);
      else tails.push(` LIMIT ${node.n}${node.offset === undefined ? '' : ` OFFSET ${node.offset}`}`);
    }
    const where = predicates.length ? ` WHERE ${conjunction(predicates)}` : '';
    const tail = tails.join('');
    return `SELECT ${items.join(', ')} FROM ${from}${where}${tail}`;
  }
  function emit(rel: Rel, path: string): string {
    const name = plan?.ctes?.names.get(rel);
    if (name) {
      if (!defined.has(rel)) return fail('cte_visibility', rel, path);
      const leaves = plan?.columns?.get(rel) ?? outputLeaves(rel.output);
      return `SELECT ${leaves.map(l => `${quoteIdentifier(name)}.${quoteIdentifier(l.name)}`).join(', ')} FROM ${quoteIdentifier(name)}`;
    }
    const sql = emitNode(rel, path);
    rendered.set(rel, sql);
    return sql;
  }
  function emitNode(rel: Rel, path: string): string {
    if (!rel || typeof rel !== 'object') return fail('invalid_node', rel, path);
    if (active.has(rel)) return fail('cyclic_ir', rel, path);
    active.add(rel);
    try {
      if (rel.output.shape === 'deferred') return fail('unsupported_output', rel, path);
      const leaves = outputLeaves(rel.output);
      const columns = Object.fromEntries(leaves.map(l => [l.name, l.type]));
      const order = leaves.map(l => l.name);
      // Logical validation uses the full schema; SELECT lists use the explicit
      // physical interface, whose names retain full-schema transport ordinals.
      const physical = plan?.columns?.get(rel) ?? leaves;
      const physicalOrder = physical.map(l => l.name);
      if (new Set(order).size !== order.length || order.length !== Object.keys(columns).length || order.some(k => !Object.hasOwn(columns, k))) return fail('invalid_output', rel, path);
      if (order.some(k => base(columns[k]!).kind === 'AggregateFunction')) return fail('aggregate_state_selection', rel, path);
      nodes[path] = rel;
      const list = physicalOrder.map(quoteIdentifier).join(', ');
      if (plan?.blocks.has(rel)) return renderBlock(rel, physicalOrder, path);
      switch (rel.kind) {
        case 'Union': {
          if (!Array.isArray(rel.inputs) || rel.inputs.length < 2) return fail('union_input_count', rel, `${path}.inputs`);
          if (typeof rel.all !== 'boolean') return fail('invalid_union_mode', rel, `${path}.all`);
          const branches = rel.inputs.map((child, i) => {
            const childPath = `${path}.inputs[${i}]`;
            // Emit each branch independently: malformed scopes cannot hide behind a matching schema.
            const source = emit(child, childPath);
            const childLeaves = outputLeaves(child.output);
            if (i === 0 && JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !== JSON.stringify(childLeaves.map(l => [l.path, print(l.type)]))) return fail('invalid_output', rel, path, 'Union output must match first input order and descriptors');
            if (childLeaves.length !== leaves.length) return fail('union_schema_mismatch', rel, `${childPath}.output`);
            const items = leaves.map(leaf => {
              const actual = childLeaves.find(candidate => JSON.stringify(candidate.path) === JSON.stringify(leaf.path));
              if (!actual) return fail('union_schema_mismatch', rel, `${childPath}.output`, JSON.stringify(leaf.path));
              if (!same(actual.type, leaf.type)) return fail('union_descriptor_mismatch', rel, `${childPath}.output`, JSON.stringify(leaf.path));
              return `${inputAlias}.${quoteIdentifier(actual.name)} AS ${quoteIdentifier(leaf.name)}`;
            });
            return `SELECT ${items.join(', ')} FROM (${source}) AS ${inputAlias}`;
          });
          return branches.join(rel.all ? ' UNION ALL ' : ' UNION DISTINCT ');
        }
        case 'Join': {
          if (rel.joinKind !== 'inner' && rel.joinKind !== 'cross') return fail('unsupported_join', rel, path);
          if (!Array.isArray(rel.on)) return fail('invalid_join_condition', rel, `${path}.on`);
          if (rel.joinKind === 'cross' && rel.on.length) return fail('join_condition_arity', rel, `${path}.on`, 'CROSS JOIN has no ON condition');
          if (!Array.isArray(rel.inputs) || rel.inputs.length < 2 || new Set(rel.inputs.map(([a]) => a)).size !== rel.inputs.length) return fail('join_input_count', rel, `${path}.inputs`);
          const expected = { shape: 'nested', inputs: rel.inputs.map(([a, r]) => [a, r.output]) };
          if (JSON.stringify(expected) !== JSON.stringify(rel.output)) return fail('invalid_output', rel, path);
          const clauses = rel.inputs.map(() => [] as { e: ExprNode; path: string }[]);
          const residuals: { e: ExprNode; path: string }[] = [];
          const join = rel;
          function sides(e: ExprNode, p: string): Set<number> {
            if (e.kind === 'ColumnRef') {
              if (e.rel !== (join.scope ?? join.id)) return fail('unbound_column', e, p);
              const index = join.inputs.findIndex(([a]) => a === e.path[0]);
              if (index < 0) return fail('unbound_column', e, p);
              return new Set([index]);
            }
            if (e.kind === 'Call') return new Set(e.args.flatMap((a, i) => [...sides(a, `${p}.args[${i}]`)]));
            if (e.kind === 'Param') return new Set();
            return fail('join_condition_arity', e, p);
          }
          function conjuncts(e: ExprNode, p: string): { e: ExprNode; path: string }[] {
            if (e.kind !== 'Call' || e.fn.name !== 'and') return [{ e, path: p }];
            // Validate the removed parent too, without assigning Params before SQL emission.
            try { resolvedType(e); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_call', e, p); }
            return e.args.flatMap((child, i) => conjuncts(child, `${p}.args[${i}]`));
          }
          for (const { e, path: p } of rel.on.flatMap((e, i) => conjuncts(e, `${path}.on[${i}]`))) {
            if (e.kind !== 'Call' || e.fn.name !== 'eq') {
              const type = e.type && base(e.type);
              if (!type || type.kind !== 'scalar' || type.name !== 'Bool') return fail('invalid_predicate', e, p);
              residuals.push({ e, path: p });
              continue;
            }
            if (e.args.length !== 2) return fail('join_condition_arity', e, p);
            const left = [...sides(e.args[0]!, `${p}.args[0]`)], right = [...sides(e.args[1]!, `${p}.args[1]`)];
            if (left.length !== 1 || right.length !== 1 || left[0] === right[0]) return fail('join_condition_arity', e, p);
            clauses[Math.max(left[0]!, right[0]!)]!.push({ e, path: p });
          }
          for (let i = 1; i < clauses.length; i++) if (rel.joinKind !== 'cross' && !clauses[i]!.length) return fail('join_condition_arity', rel, `${path}.inputs[${i}]`, 'no equality connects this input to an earlier input');
          const items = physical.map(l => {
            const side = rel.inputs.find(([a]) => a === l.path[0])!;
            const child = (plan?.columns?.get(side[1]) ?? outputLeaves(side[1].output)).find(c => JSON.stringify(c.path) === JSON.stringify(l.path.slice(1)));
            if (!child) return fail('missing_physical_column', rel, path, JSON.stringify(l.path));
            return `${joinAlias(rel, side[0])}.${quoteIdentifier(child.name)} AS ${quoteIdentifier(l.name)}`;
          });
          let source = '';
          for (const [i, [alias, child]] of rel.inputs.entries()) {
            source += `${i ? (rel.joinKind === 'cross' ? ' CROSS JOIN ' : ' INNER ALL JOIN ') : ''}(${emit(child, `${path}.inputs[${i}]`)}) AS ${joinAlias(rel, alias)}`;
            if (i && rel.joinKind !== 'cross') source += ` ON ${clauses[i]!.map(c => expression(c.e, rel, c.path, undefined, false, 'row', '')).join(' AND ')}`;
          }
          return `SELECT ${items.join(', ')} FROM ${source}${residuals.length ? ` WHERE ${conjunction(residuals.map(c => ({ expr: c.e, sql: expression(c.e, rel, c.path, undefined, false, 'row', '') })))}` : ''}`;
        }
        case 'Scan': {
          if (rel.final !== undefined && typeof rel.final !== 'boolean') return fail('invalid_scan_hint', rel, `${path}.final`);
          if (rel.sample !== undefined && (typeof rel.sample !== 'number' || !Number.isFinite(rel.sample) || rel.sample <= 0 || rel.sample > 1)) return fail('invalid_scan_hint', rel, `${path}.sample`, 'expected fraction in (0, 1]');
          if (order.some(k => !Object.hasOwn(rel.table.columns, k) || !same(columns[k]!, rel.table.columns[k]!))) return fail('invalid_output', rel, path);
          const table = quoteIdentifier(rel.table.name);
          const hints = `${rel.final ? ' FINAL' : ''}${rel.sample === undefined ? '' : ` SAMPLE ${rel.sample}`}`;
          return `SELECT ${list} FROM ${table}${hints}`;
        }
        case 'ArrayJoin': {
          if (typeof rel.alias !== 'string' || rel.alias.includes('\0')) return fail('invalid_array_join_alias', rel, `${path}.alias`);
          if (typeof rel.left !== 'boolean') return fail('invalid_array_join', rel, `${path}.left`);
          const input = rel.input.output;
          if (input.shape === 'deferred') return fail('unsupported_output', rel, path);
          const inputLeaves = outputLeaves(input);
          if (inputLeaves.some(l => l.path[0] === rel.alias)) return fail('duplicate_column', rel, `${path}.alias`);
          let type: CHType;
          try { type = resolvedType(rel.expr); } catch (error) { return fail('invalid_array_join_expression', rel, `${path}.expr`, String(error)); }
          if (type.kind !== 'Array') return fail('invalid_array_join_expression', rel, `${path}.expr`);
          const expected = outputLeaves(expandedOutput(input, rel.alias, type.inner));
          if (JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !== JSON.stringify(expected.map(l => [l.path, print(l.type)])) || Object.keys(rel.columns).length !== order.length || order.some(k => !Object.hasOwn(rel.columns, k) || !same(rel.columns[k]!, columns[k]!))) return fail('invalid_output', rel, path);
          // Internal element aliases cannot capture a user column or the input table alias.
          let element = plan?.ctes?.elementAlias ?? '__chql_element';
          while (Object.hasOwn(columns, element) || inputLeaves.some(l => l.name === element)) element += '_';
          const quotedElement = quoteIdentifier(element);
          let sourceAlias = plan?.ctes?.inputAlias ?? '__chql_input';
          while (Object.hasOwn(columns, sourceAlias) || inputLeaves.some(l => l.name === sourceAlias)) sourceAlias += '_';
          const qualifier = quoteIdentifier(sourceAlias);
          const items = physical.map(leaf => {
            if (leaf.path.length === 1 && leaf.path[0] === rel.alias) return `${quotedElement} AS ${quoteIdentifier(leaf.name)}`;
            const source = (plan?.columns?.get(rel.input) ?? inputLeaves).find(l => JSON.stringify(l.path) === JSON.stringify(leaf.path));
            if (!source) return fail('missing_physical_column', rel, path, JSON.stringify(leaf.path));
            return `${qualifier}.${quoteIdentifier(source.name)} AS ${quoteIdentifier(leaf.name)}`;
          });
          // FROM precedes ARRAY JOIN in emitted text, hence its Params are assigned first.
          const source = emit(rel.input, `${path}.input`);
          const expr = expression(rel.expr, rel.input, `${path}.expr`, undefined, false, 'row', qualifier);
          return `SELECT ${items.join(', ')} FROM (${source}) AS ${qualifier} ${rel.left ? 'LEFT ' : ''}ARRAY JOIN ${expr} AS ${quotedElement}`;
        }
        case 'Aggregate': {
          const keys = Object.entries(rel.keys), aggs = Object.entries(rel.aggs);
          const entries = [...keys, ...aggs];
          if (new Set(entries.map(([k]) => k)).size !== entries.length) return fail('duplicate_column', rel, path);
          if (JSON.stringify(entries.map(([k]) => k)) !== JSON.stringify(order)) return fail('invalid_output', rel, path);
          if (Object.keys(rel.columns).length !== order.length || order.some(k => !rel.columns[k] || !same(rel.columns[k]!, columns[k]!))) return fail('invalid_output', rel, path);
          for (const [k, e] of aggs) if (!hasAggregate(e)) return fail('invalid_aggregate_placement', e, `${path}.aggs.${k}`);
          const keySql = keys.map(([k, e]) => expression(e, rel.input, `${path}.keys.${k}`));
          const items = entries.map(([k, e], i) => {
            if (!e.type || !same(e.type, columns[k]!)) return fail('invalid_output', e, `${path}.${k}`);
            return `${i < keys.length ? keySql[i] : expression(e, rel.input, `${path}.aggs.${k}`, undefined, false, 'aggregate')} AS ${quoteIdentifier(k)}`;
          });
          return `SELECT ${items.join(', ')} FROM (${emit(rel.input, `${path}.input`)}) AS ${inputAlias}${keys.length ? ` GROUP BY ${keySql.join(', ')}` : ''}`;
        }
        case 'Project': {
          if (Object.keys(rel.exprs).length !== order.length) return fail('nested_projection', rel, path);
          const items = order.flatMap(k => {
            const e = rel.exprs[k];
            if (!e || !e.type || !same(e.type, columns[k]!)) return fail('nested_projection', rel, `${path}.exprs.${k}`);
            if (!physicalOrder.includes(k)) return [];
            return [`${expression(e, rel.input, `${path}.exprs.${k}`)} AS ${quoteIdentifier(k)}`];
          });
          const source = emit(rel.input, `${path}.input`);
          if (plan?.blocks.has(rel)) return renderBlock(rel, physicalOrder);
          return `SELECT ${items.join(', ')} FROM (${source}) AS ${inputAlias}`;
        }
        case 'Filter': case 'Limit': case 'Sort': case 'Distinct': case 'Materialize': {
          const inputLeaves = outputLeaves(rel.input.output);
          if (JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !== JSON.stringify(inputLeaves.map(l => [l.path, print(l.type)]))) return fail('invalid_output', rel, path);
          const source = emit(rel.input, `${path}.input`);
          if (rel.kind === 'Materialize') {
            if (plan?.ctes) return source;
            // The local WITH is visible throughout its input. Avoid every quoted
            // identifier in that subtree, including physical tables and nested CTEs.
            let name: string;
            do { name = quoteIdentifier(`t${cteIndex++}`); } while (source.includes(name) || order.some(k => quoteIdentifier(k) === name));
            return `WITH ${name} AS (${source}) SELECT ${order.map(k => `${name}.${quoteIdentifier(k)}`).join(', ')} FROM ${name}`;
          }
          if (rel.kind === 'Distinct') return `SELECT DISTINCT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias}`;
          function renderClause(clause: string): string {
            clauses.set(rel, clause);
            return renderBlock(rel, physicalOrder);
          }
          if (rel.kind === 'Sort') {
            if (!Array.isArray(rel.keys) || rel.keys.length === 0) return fail('invalid_sort_key', rel, `${path}.keys`);
            const keys = rel.keys.map((key, i) => {
              const keyPath = `${path}.keys[${i}]`;
              if (!key || (key.dir !== 'asc' && key.dir !== 'desc') || (key.nulls !== undefined && key.nulls !== 'first' && key.nulls !== 'last')) return fail('invalid_sort_key', rel, keyPath);
              return `${expression(key.expr, rel.input, `${keyPath}.expr`, undefined, false, 'row', blockQualifier(rel))} ${key.dir.toUpperCase()}${key.nulls === undefined ? '' : ` NULLS ${key.nulls.toUpperCase()}`}`;
            });
            if (plan) return renderClause(` ORDER BY ${keys.join(', ')}`);
            return `SELECT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias} ORDER BY ${keys.join(', ')}`;
          }
          if (rel.kind === 'Filter') {
            const type = rel.pred?.type && base(rel.pred.type);
            if (!type || type.kind !== 'scalar' || type.name !== 'Bool') return fail('invalid_predicate', rel, path);
            const predicate = expression(rel.pred, rel.input, `${path}.pred`, undefined, false, 'row', blockQualifier(rel));
            if (plan) return renderClause(predicate);
            return `SELECT ${list} FROM (${source}) AS ${inputAlias} WHERE ${predicate}`;
          }
          if (!Number.isSafeInteger(rel.n) || rel.n < 0 || (rel.offset !== undefined && (!Number.isSafeInteger(rel.offset) || rel.offset < 0))) return fail('invalid_limit', rel, path);
          const limit = ` LIMIT ${rel.n}${rel.offset === undefined ? '' : ` OFFSET ${rel.offset}`}`;
          if (plan) return renderClause(limit);
          return `SELECT ${list} FROM (${source})${limit}`;
        }
        default: return fail('unsupported_node', rel, path, rel.kind);
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      return fail('invalid_ir', rel, path, String(error));
    } finally { active.delete(rel); }
  }
  const definitions: string[] = [];
  for (const rel of plan?.ctes?.definitions ?? []) {
    const sql = emitNode(rel, `cte[${definitions.length}]`);
    definitions.push(`${quoteIdentifier(plan!.ctes!.names.get(rel)!)} AS (${sql})`);
    defined.add(rel);
  }
  const body = `${definitions.length ? `WITH ${definitions.join(', ')}${plan?.blocks.get(root)?.source.kind === 'join' ? '\n' : ' '}` : ''}${emit(root, 'root')}`;
  const settings = [
    ...(weekBucketing ? ['enable_extended_results_for_datetime_functions = 1'] : []),
    // Nullable membership's declared result requires the server's default NULL policy.
    ...(dateMembership ? ['transform_null_in = 0'] : []),
  ];
  const sql = body + (settings.length ? ` SETTINGS ${settings.join(', ')}` : '');
  const leaves = outputLeaves(root.output);
  return Object.freeze({ sql, params: Object.freeze(params), parameterTypes: Object.freeze(parameterTypes), columns: Object.freeze(Object.fromEntries(leaves.map(l => [l.name, l.type]))), ...(root.output.shape === 'nested' ? { columnPaths: Object.freeze(Object.fromEntries(leaves.map(l => [l.name, Object.freeze(l.path)]))) } : {}), nodes: Object.freeze(nodes) });
}
