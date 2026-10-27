import { print, type CHType, type CompiledQuery, type ExprNode, type Rel } from '@chql/core';
import { parameterWireType, serializeParameter } from './parameters.js';
import { resolveAggregate, resolveCall } from './resolve.js';

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
  return e.kind === 'Agg' || (e.kind === 'Call' && e.args.some(hasAggregate));
}
function base(t: CHType): CHType { return t.kind === 'Nullable' || t.kind === 'LowCardinality' ? base(t.inner) : t; }
/** Permanent one-subquery-per-node reference backend. Unsupported IR is rejected. */
export function emitNaive(root: Rel): CompiledQuery {
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  const parameterTypes: Record<string, CHType> = Object.create(null) as Record<string, CHType>;
  const nodes: Record<string, Rel> = Object.create(null) as Record<string, Rel>;
  const assigned = new Map<ExprNode, { name: string; type: CHType }>();
  const active = new Set<Rel>();
  // Each derived input owns this local SQL scope; ColumnRefs never bind SELECT aliases.
  const inputAlias = quoteIdentifier('__chql_input');
  function fail(code: string, node: unknown, path: string, detail = ''): never { throw new ValidationError(code, node, path, detail); }
  function resolvedType(e: ExprNode, expected?: CHType): CHType {
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
        if (e.rel !== input.id || e.path.length !== 1 || input.output.shape !== 'flat') return fail('unbound_column', e, path, `reference ${e.rel}, input ${input.id}`);
        const name = e.path[0]!;
        if (!Object.hasOwn(input.output.columns, name) || !same(e.type, input.output.columns[name]!)) return fail('unbound_column', e, path, name);
        return `${qualifier}.${quoteIdentifier(name)}`;
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
      case 'Agg': {
        if (scope !== 'aggregate') return fail('invalid_aggregate_placement', e, path);
        let resolved: ReturnType<typeof resolveAggregate>;
        try { resolved = resolveAggregate(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_aggregate', e, path); }
        return `${resolved.sqlName}(${e.args.map((a, i) => expression(a, input, `${path}.args[${i}]`, undefined, false, 'operand', qualifier)).join(', ')})`;
      }
      case 'Call': {
        let resolved: ReturnType<typeof resolveCall>;
        try { resolved = resolveCall(e, resolvedType); } catch (error) { return fail(error instanceof Error ? error.message : 'invalid_call', e, path); }
        const args = e.args.map((arg, i) => expression(arg, input, `${path}.args[${i}]`, resolved.types[i], e.fn.name === 'arrayElement' && i === 1 && arg.kind === 'Param' && arg.type === null, scope, qualifier));
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
      if (rel.output.shape !== 'flat' || !rel.output.order.length) return fail('unsupported_output', rel, path);
      const { columns, order } = rel.output;
      if (new Set(order).size !== order.length || order.length !== Object.keys(columns).length || order.some(k => !Object.hasOwn(columns, k))) return fail('invalid_output', rel, path);
      if (order.some(k => base(columns[k]!).kind === 'AggregateFunction')) return fail('aggregate_state_selection', rel, path);
      nodes[path] = rel;
      const list = order.map(quoteIdentifier).join(', ');
      switch (rel.kind) {
        case 'Scan':
          if (rel.final !== undefined && typeof rel.final !== 'boolean') return fail('invalid_scan_hint', rel, `${path}.final`);
          if (rel.sample !== undefined && (typeof rel.sample !== 'number' || !Number.isFinite(rel.sample) || rel.sample <= 0 || rel.sample > 1)) return fail('invalid_scan_hint', rel, `${path}.sample`, 'expected fraction in (0, 1]');
          if (order.some(k => !Object.hasOwn(rel.table.columns, k) || !same(columns[k]!, rel.table.columns[k]!))) return fail('invalid_output', rel, path);
          return `SELECT ${list} FROM ${quoteIdentifier(rel.table.name)}${rel.final ? ' FINAL' : ''}${rel.sample === undefined ? '' : ` SAMPLE ${rel.sample}`}`;
        case 'ArrayJoin': {
          if (typeof rel.alias !== 'string' || rel.alias.includes('\0')) return fail('invalid_array_join_alias', rel, `${path}.alias`);
          if (typeof rel.left !== 'boolean') return fail('invalid_array_join', rel, `${path}.left`);
          const input = rel.input.output;
          if (input.shape !== 'flat') return fail('unsupported_output', rel, path);
          if (Object.hasOwn(input.columns, rel.alias)) return fail('duplicate_column', rel, `${path}.alias`);
          let type: CHType;
          try { type = resolvedType(rel.expr); } catch (error) { return fail('invalid_array_join_expression', rel, `${path}.expr`, String(error)); }
          if (type.kind !== 'Array') return fail('invalid_array_join_expression', rel, `${path}.expr`);
          const expected = [...input.order, rel.alias];
          if (JSON.stringify(order) !== JSON.stringify(expected) || order.some(k => !same(columns[k]!, k === rel.alias ? type.inner : input.columns[k]!)) || Object.keys(rel.columns).length !== order.length || order.some(k => !Object.hasOwn(rel.columns, k) || !same(rel.columns[k]!, columns[k]!))) return fail('invalid_output', rel, path);
          // Internal element aliases cannot capture a user column or the input table alias.
          let element = '__chql_element';
          while (Object.hasOwn(columns, element)) element += '_';
          const quotedElement = quoteIdentifier(element);
          let sourceAlias = '__chql_input';
          while (Object.hasOwn(columns, sourceAlias)) sourceAlias += '_';
          const qualifier = quoteIdentifier(sourceAlias);
          const items = [...input.order.map(k => `${qualifier}.${quoteIdentifier(k)}`), `${quotedElement} AS ${quoteIdentifier(rel.alias)}`];
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
        case 'Filter': case 'Limit': case 'Sort': case 'Distinct': {
          if (rel.input.output.shape !== 'flat' || JSON.stringify(order) !== JSON.stringify(rel.input.output.order) || order.some(k => !same(columns[k]!, rel.input.output.shape === 'flat' ? rel.input.output.columns[k]! : columns[k]!))) return fail('invalid_output', rel, path);
          const source = emit(rel.input, `${path}.input`);
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
  if (root.output.shape !== 'flat') throw new ValidationError('unsupported_output', root, 'root');
  return Object.freeze({ sql, params: Object.freeze(params), parameterTypes: Object.freeze(parameterTypes), columns: root.output.columns, nodes: Object.freeze(nodes) });
}
export const compile = emitNaive;
