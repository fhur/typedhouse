import { print, scalarDescriptor, outputLeaves, expandedOutput, type CHType, type CompiledQuery, type ExprNode, type Rel } from '@chql/core';
import { parameterWireType, serializeParameter } from './parameters.js';
import { resolveAggregate, resolveCall, resolveCast } from './resolve.js';

export class ValidationError extends Error {
  constructor(readonly code: string, readonly node: unknown, readonly path: string, detail = '') {
    super(`${code} at ${path}: ${detail}`); this.name = 'ValidationError';
  }
}
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
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  const parameterTypes: Record<string, CHType> = Object.create(null) as Record<string, CHType>;
  const nodes: Record<string, Rel> = Object.create(null) as Record<string, Rel>;
  const assigned = new Map<ExprNode, { name: string; type: CHType }>();
  const active = new Set<Rel>();
  const materialized = new Set<Rel>();
  let cteIndex = 0;
  // Each derived input owns this local SQL scope; ColumnRefs never bind SELECT aliases.
  const inputAlias = quoteIdentifier('__chql_input');
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
  function expression(e: ExprNode, input: Rel, path: string, expected?: CHType, index = false, scope: 'row' | 'aggregate' | 'operand' = 'row', qualifier = inputAlias): string {
    if (!e || typeof e !== 'object') return fail('invalid_expression', e, path);
    switch (e.kind) {
      case 'ColumnRef': {
        if (scope === 'aggregate' || (e.mode === 'grouped' && scope !== 'operand') || (e.mode === 'row' && scope === 'operand')) return fail('invalid_expression_mode', e, path);
        const scopeId = qualifier === '' && input.kind === 'Join' ? input.scope ?? input.id : input.id;
        if (e.rel !== scopeId) return fail('unbound_column', e, path, `reference ${e.rel}, input ${scopeId}`);
        const leaf = outputLeaves(input.output).find(l => JSON.stringify(l.path) === JSON.stringify(e.path));
        if (!leaf || !same(e.type, leaf.type)) return fail('unbound_column', e, path, JSON.stringify(e.path));
        if (qualifier === '' && input.kind === 'Join') {
          const side = input.inputs.find(([alias]) => alias === e.path[0]);
          const child = side && outputLeaves(side[1].output).find(l => JSON.stringify(l.path) === JSON.stringify(e.path.slice(1)));
          if (!side || !child) return fail('unbound_column', e, path);
          return `${quoteIdentifier(side[0])}.${quoteIdentifier(child.name)}`;
        }
        return `${qualifier}.${quoteIdentifier(leaf.name)}`;
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
        return `{${name}:${print(parameterWireType(type))}}`;
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
        return `CAST(${expression(e.expr, input, `${path}.expr`, undefined, false, scope, qualifier)} AS ${print(target)})`;
      }
      case 'Agg': {
        if (scope !== 'aggregate') return fail('invalid_aggregate_placement', e, path);
        let resolved: ReturnType<typeof resolveAggregate>;
        try { resolved = resolveAggregate(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_aggregate', e, path); }
        return `${resolved.sqlName}(${e.args.map((a, i) => expression(a, input, `${path}.args[${i}]`, undefined, false, 'operand', qualifier)).join(', ')})`;
      }
      case 'Call': {
        let resolved: ReturnType<typeof resolveCall>;
        try { resolved = resolveCall(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_call', e, path); }
        const args = e.args.map((arg, i) => {
          // Only the authoritative membership resolver grants this set position.
          if ((e.fn.name === 'in' || e.fn.name === 'notIn') && i === 1 && arg.kind === 'Subquery') {
            return `(${emit(arg.rel, `${path}.args[${i}].rel`)})`;
          }
          return expression(arg, input, `${path}.args[${i}]`, resolved.types[i], e.fn.name === 'arrayElement' && i === 1 && arg.kind === 'Param' && arg.type === null, scope, qualifier);
        });
        // Retain the established equality SQL contract; all other names come from the catalog.
        return e.fn.name === 'eq' ? `(${args[0]} = ${args[1]})` : `${resolved.sqlName}(${args.join(', ')})`;
      }
      default: return fail('unsupported_expression', e, path, e.kind);
    }
  }
  function emit(rel: Rel, path: string): string {
    if (!rel || typeof rel !== 'object') return fail('invalid_node', rel, path);
    if (active.has(rel)) return fail('cyclic_ir', rel, path);
    active.add(rel);
    try {
      if (rel.output.shape === 'deferred') return fail('unsupported_output', rel, path);
      const leaves = outputLeaves(rel.output);
      const columns = Object.fromEntries(leaves.map(l => [l.name, l.type]));
      const order = leaves.map(l => l.name);
      if (new Set(order).size !== order.length || order.length !== Object.keys(columns).length || order.some(k => !Object.hasOwn(columns, k))) return fail('invalid_output', rel, path);
      if (order.some(k => base(columns[k]!).kind === 'AggregateFunction')) return fail('aggregate_state_selection', rel, path);
      nodes[path] = rel;
      const list = order.map(quoteIdentifier).join(', ');
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
          const items = leaves.map(l => {
            const side = rel.inputs.find(([a]) => a === l.path[0])!;
            const child = outputLeaves(side[1].output).find(c => JSON.stringify(c.path) === JSON.stringify(l.path.slice(1)))!;
            return `${quoteIdentifier(side[0])}.${quoteIdentifier(child.name)} AS ${quoteIdentifier(l.name)}`;
          });
          let source = '';
          for (const [i, [alias, child]] of rel.inputs.entries()) {
            source += `${i ? (rel.joinKind === 'cross' ? ' CROSS JOIN ' : ' INNER ALL JOIN ') : ''}(${emit(child, `${path}.inputs[${i}]`)}) AS ${quoteIdentifier(alias)}`;
            if (i && rel.joinKind !== 'cross') source += ` ON ${clauses[i]!.map(c => expression(c.e, rel, c.path, undefined, false, 'row', '')).join(' AND ')}`;
          }
          return `SELECT ${items.join(', ')} FROM ${source}${residuals.length ? ` WHERE ${residuals.map(c => expression(c.e, rel, c.path, undefined, false, 'row', '')).join(' AND ')}` : ''}`;
        }
        case 'Scan':
          if (rel.final !== undefined && typeof rel.final !== 'boolean') return fail('invalid_scan_hint', rel, `${path}.final`);
          if (rel.sample !== undefined && (typeof rel.sample !== 'number' || !Number.isFinite(rel.sample) || rel.sample <= 0 || rel.sample > 1)) return fail('invalid_scan_hint', rel, `${path}.sample`, 'expected fraction in (0, 1]');
          if (order.some(k => !Object.hasOwn(rel.table.columns, k) || !same(columns[k]!, rel.table.columns[k]!))) return fail('invalid_output', rel, path);
          return `SELECT ${list} FROM ${quoteIdentifier(rel.table.name)}${rel.final ? ' FINAL' : ''}${rel.sample === undefined ? '' : ` SAMPLE ${rel.sample}`}`;
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
          let element = '__chql_element';
          while (Object.hasOwn(columns, element) || inputLeaves.some(l => l.name === element)) element += '_';
          const quotedElement = quoteIdentifier(element);
          let sourceAlias = '__chql_input';
          while (Object.hasOwn(columns, sourceAlias) || inputLeaves.some(l => l.name === sourceAlias)) sourceAlias += '_';
          const qualifier = quoteIdentifier(sourceAlias);
          const items = leaves.map(leaf => {
            if (leaf.path.length === 1 && leaf.path[0] === rel.alias) return `${quotedElement} AS ${quoteIdentifier(leaf.name)}`;
            const source = inputLeaves.find(l => JSON.stringify(l.path) === JSON.stringify(leaf.path))!;
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
          const items = order.map(k => {
            const e = rel.exprs[k];
            if (!e || !e.type || !same(e.type, columns[k]!)) return fail('nested_projection', rel, `${path}.exprs.${k}`);
            return `${expression(e, rel.input, `${path}.exprs.${k}`)} AS ${quoteIdentifier(k)}`;
          });
          return `SELECT ${items.join(', ')} FROM (${emit(rel.input, `${path}.input`)}) AS ${inputAlias}`;
        }
        case 'Filter': case 'Limit': case 'Sort': case 'Distinct': case 'Materialize': {
          const inputLeaves = outputLeaves(rel.input.output);
          if (JSON.stringify(leaves.map(l => [l.path, print(l.type)])) !== JSON.stringify(inputLeaves.map(l => [l.path, print(l.type)]))) return fail('invalid_output', rel, path);
          const source = emit(rel.input, `${path}.input`);
          if (rel.kind === 'Materialize') {
            // The local WITH is visible throughout its input. Avoid every quoted
            // identifier in that subtree, including physical tables and nested CTEs.
            let name: string;
            do { name = quoteIdentifier(`t${cteIndex++}`); } while (source.includes(name) || order.some(k => quoteIdentifier(k) === name));
            materialized.add(rel);
            return `WITH ${name} AS (${source}) SELECT ${order.map(k => `${name}.${quoteIdentifier(k)}`).join(', ')} FROM ${name}`;
          }
          if (rel.kind === 'Distinct') return `SELECT DISTINCT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias}`;
          if (rel.kind === 'Sort') {
            if (!Array.isArray(rel.keys) || rel.keys.length === 0) return fail('invalid_sort_key', rel, `${path}.keys`);
            const keys = rel.keys.map((key, i) => {
              const keyPath = `${path}.keys[${i}]`;
              if (!key || (key.dir !== 'asc' && key.dir !== 'desc') || (key.nulls !== undefined && key.nulls !== 'first' && key.nulls !== 'last')) return fail('invalid_sort_key', rel, keyPath);
              return `${expression(key.expr, rel.input, `${keyPath}.expr`)} ${key.dir.toUpperCase()}${key.nulls === undefined ? '' : ` NULLS ${key.nulls.toUpperCase()}`}`;
            });
            return `SELECT ${order.map(k => `${inputAlias}.${quoteIdentifier(k)}`).join(', ')} FROM (${source}) AS ${inputAlias} ORDER BY ${keys.join(', ')}`;
          }
          if (rel.kind === 'Filter') {
            const type = rel.pred?.type && base(rel.pred.type);
            if (!type || type.kind !== 'scalar' || type.name !== 'Bool') return fail('invalid_predicate', rel, path);
            return `SELECT ${list} FROM (${source}) AS ${inputAlias} WHERE ${expression(rel.pred, rel.input, `${path}.pred`)}`;
          }
          if (!Number.isSafeInteger(rel.n) || rel.n < 0 || (rel.offset !== undefined && (!Number.isSafeInteger(rel.offset) || rel.offset < 0))) return fail('invalid_limit', rel, path);
          return `SELECT ${list} FROM (${source}) LIMIT ${rel.n}${rel.offset === undefined ? '' : ` OFFSET ${rel.offset}`}`;
        }
        default: return fail('unsupported_node', rel, path, rel.kind);
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      return fail('invalid_ir', rel, path, String(error));
    } finally { active.delete(rel); }
  }
  const sql = emit(root, 'root');
  // Warn only after successful validation, once per distinct hint per compile.
  for (const _rel of materialized) console.warn('chql: materialization is not yet implemented; materialize() emits an ordinary CTE, which ClickHouse may inline and evaluate repeatedly.');
  const leaves = outputLeaves(root.output);
  return Object.freeze({ sql, params: Object.freeze(params), parameterTypes: Object.freeze(parameterTypes), columns: Object.freeze(Object.fromEntries(leaves.map(l => [l.name, l.type]))), ...(root.output.shape === 'nested' ? { columnPaths: Object.freeze(Object.fromEntries(leaves.map(l => [l.name, Object.freeze(l.path)]))) } : {}), nodes: Object.freeze(nodes) });
}
export const compile = emitNaive;
