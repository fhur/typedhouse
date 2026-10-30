import type { Rel } from '@chql/core';
import { ValidationError } from './validation-error.js';

type Role = 'rel' | 'expr' | 'output' | 'flatOutput' | 'nestedOutput' | 'type' | 'castType' | 'table' | 'fn' | 'aggregateFn' | 'sort' | 'branch' | 'tupleItem' | 'enumItem' | 'provenance' | 'knownEvidence' | 'knownEntry' | 'knownDeclaration' | 'userContract' | 'userArgument';
type Shape = Role | 'string' | 'number' | 'boolean' | { array: Shape } | { record: Shape } | { pair: Shape };
interface Visit { value: unknown; shape: Shape; path: string; exit?: boolean }
const array = (shape: Shape): Shape => ({ array: shape });
const record = (shape: Shape): Shape => ({ record: shape });
const pair = (shape: Shape): Shape => ({ pair: shape });

/** Structural boundary only. No constructor registry, ID registry, value traversal,
 * type coercion or semantic resolution. The explicit DFS distinguishes active
 * ancestors from completed shared nodes, including cross-domain subquery edges.
 * Completed checks are role-specific: an object used in two roles must pass both.
 */
export function validateStructure(root: Rel): void {
  const stack: Visit[] = [{ value: root, shape: 'rel', path: 'root' }];
  const active = new WeakSet<object>();
  const complete = new WeakMap<object, Set<Shape>>();
  while (stack.length) {
    const task = stack.pop()!;
    const { value, shape, path } = task;
    const fail = (detail: string): never => { throw new ValidationError(shape === 'sort' ? 'invalid_sort_key' : shape === 'castType' ? 'unsupported_cast_type' : 'invalid_structure', value, path, detail); };
    if (typeof shape === 'string' && ['string', 'number', 'boolean'].includes(shape)) {
      if (typeof value !== shape) fail(`expected ${shape}`);
      continue;
    }
    if (!value || typeof value !== 'object') fail('expected object');
    const object = value as Record<string, unknown>;
    if (task.exit) {
      active.delete(object);
      const roles = complete.get(object) ?? new Set<Shape>();
      roles.add(shape); complete.set(object, roles);
      continue;
    }
    if (active.has(object)) throw new ValidationError('cyclic_ir', value, path, 'active graph edge');
    if (complete.get(object)?.has(shape)) continue;
    active.add(object);
    stack.push({ ...task, exit: true });
    const children: Visit[] = [];
    const add = (value: unknown, shape: Shape, path: string) => { children.push({ value, shape, path }); };
    const field = (name: string, shape: Shape, optional = false) => {
      if (!optional || object[name] !== undefined) add(object[name], shape, `${path}.${name}`);
    };
    const choice = (name: string, choices: readonly unknown[]) => {
      if (!choices.includes(object[name])) throw new ValidationError('invalid_structure', object[name], `${path}.${name}`, `expected ${choices.join('|')}`);
    };
    if (typeof shape !== 'string') {
      if ('record' in shape) {
        if (Array.isArray(object)) fail('expected record');
        // Semantic checks also index records by output name (not only enumerable
        // entries), notably Scan table descriptors and Project expressions.
        // Symbols are not column names; parameter data never enters this role.
        for (const name of Object.getOwnPropertyNames(object)) add(object[name], shape.record, `${path}.${name}`);
      } else {
        if (!Array.isArray(value)) fail('expected array');
        const items = value as unknown[];
        if ('pair' in shape && items.length !== 2) fail('expected alias/child pair');
        for (let i = 0; i < items.length; i++) {
          if (!Object.hasOwn(items, i)) throw new ValidationError('invalid_structure', undefined, `${path}[${i}]`, 'sparse array');
          add(items[i], 'array' in shape ? shape.array : i === 0 ? 'string' : shape.pair, `${path}[${i}]`);
        }
      }
    } else {
      if (Array.isArray(object)) fail('expected record');
      switch (shape) {
        case 'rel': {
          field('id', 'number'); field('output', object.kind === 'Join' ? 'nestedOutput' : ['Scan', 'Project', 'Aggregate'].includes(String(object.kind)) ? 'flatOutput' : 'output');
          switch (object.kind) {
            case 'Scan': field('columns', record('type')); field('table', 'table'); break;
            case 'RawRel': field('parts', array('string')); field('args', array('expr')); field('provenance', 'provenance'); choice('opaque', [true]); break;
            case 'Filter': field('input', 'rel'); field('pred', 'expr'); break;
            case 'Project': field('input', 'rel'); field('columns', record('type')); field('exprs', record('expr')); break;
            case 'Aggregate': field('input', 'rel'); field('columns', record('type')); field('keys', record('expr')); field('aggs', record('expr')); break;
            case 'Join': field('inputs', array(pair('rel'))); field('on', array('expr')); field('joinKind', 'string'); field('scope', 'number', true); break;
            case 'ArrayJoin': field('input', 'rel'); field('expr', 'expr'); field('columns', record('type')); break;
            case 'Sort': field('input', 'rel'); field('keys', array('sort')); break;
            case 'Limit': case 'Distinct': case 'Materialize': field('input', 'rel'); break;
            case 'Union': field('inputs', array('rel')); break;
            default: choice('kind', ['Scan', 'RawRel', 'Filter', 'Project', 'Aggregate', 'Join', 'ArrayJoin', 'Sort', 'Limit', 'Distinct', 'Union', 'Materialize']);
          }
          // Hints, alias/left, sort directions, limits and union mode already have
          // precise semantic checks. Leave those diagnostics at their old paths.
          break;
        }
        case 'expr': {
          field('id', 'number');
          if (!(object.type === null && (object.kind === 'Param' || object.kind === 'Raw'))) field('type', 'type');
          switch (object.kind) {
            case 'ColumnRef': field('rel', 'number'); field('path', array('string')); field('mode', 'string', true); break;
            case 'Param': case 'Literal': break; // value is serializer-owned data, never an IR edge
            case 'Call': field('fn', 'fn'); field('args', array('expr')); break;
            case 'Agg': field('fn', 'aggregateFn'); field('args', array('expr')); field('params', array('expr')); field('combinators', array('string')); break;
            case 'Raw': field('parts', array('string')); field('args', array('expr')); field('provenance', 'provenance'); choice('opaque', [true]); choice('resolution', ['declared', 'deferred']); break;
            case 'Case': field('branches', array('branch')); field('otherwise', 'expr'); break;
            case 'Cast': field('expr', 'expr'); field('to', 'castType'); break;
            case 'Subquery': field('rel', 'rel'); field('usage', 'string'); break;
            default: choice('kind', ['ColumnRef', 'Param', 'Literal', 'Call', 'Agg', 'Raw', 'Case', 'Cast', 'Subquery']);
          }
          break;
        }
        case 'flatOutput': case 'nestedOutput': case 'output':
          if (shape === 'flatOutput') choice('shape', ['flat']);
          if (shape === 'nestedOutput') choice('shape', ['nested']);
          switch (object.shape) {
            case 'flat': field('columns', record('type')); field('order', array('string')); break;
            case 'nested': field('inputs', array(pair('output'))); field('fields', 'flatOutput', true); break;
            case 'deferred': choice('reason', ['raw']); field('declaredNames', array('string')); break;
            default: choice('shape', ['flat', 'nested', 'deferred']);
          }
          break;
        case 'castType': case 'type':
          switch (object.kind) {
            case 'scalar': field('name', 'string'); break; // vocabulary/operand semantics stay with existing resolvers
            case 'FixedString': field('n', 'number'); break;
            case 'DateTime': field('tz', 'string', true); break;
            case 'DateTime64': field('precision', 'number'); field('tz', 'string', true); break;
            case 'Decimal': field('precision', 'number'); field('scale', 'number'); break;
            case 'Enum': choice('bits', [8, 16]); field('values', array('enumItem')); break;
            case 'Nullable': case 'LowCardinality': case 'Array': field('inner', 'type'); break;
            case 'Map': field('key', 'type'); field('value', 'type'); break;
            case 'Tuple': field('items', array('tupleItem')); break;
            case 'Variant': field('items', array('type')); break;
            case 'AggregateFunction': field('fn', 'string'); field('args', array('type')); break;
            case 'SimpleAggregateFunction': field('fn', 'string'); field('inner', 'type'); break;
            case 'Unknown': field('raw', 'string'); break;
            case 'Dynamic': break;
            default: choice('kind', ['scalar', 'FixedString', 'DateTime', 'DateTime64', 'Decimal', 'Enum', 'Nullable', 'LowCardinality', 'Array', 'Map', 'Tuple', 'Variant', 'Dynamic', 'AggregateFunction', 'SimpleAggregateFunction', 'Unknown']);
          }
          break;
        case 'table': field('name', 'string'); field('columns', record('type')); field('engine', 'string'); field('sortingKey', array('string')); field('partitionKey', array('string')); field('primaryKey', array('string'), true); break;
        case 'knownEvidence': field('catalog', record('knownEntry')); field('name', 'string'); field('declaration', 'knownDeclaration', true); break;
        case 'knownEntry': field('isAggregate', 'boolean'); if (object.deterministic !== null) field('deterministic', 'boolean'); field('aliasTo', 'string'); break;
        case 'knownDeclaration': choice('origin', ['as']); field('type', 'type'); break;
        case 'userContract':
          if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null || Object.getOwnPropertySymbols(object).length || Object.getOwnPropertyNames(object).some(k => !['version', 'classification', 'name', 'sqlName', 'args', 'returns', 'nullable', 'deterministic'].includes(k))) fail('expected plain closed user contract');
          choice('version', [1]); choice('classification', ['scalar']); field('name', 'string'); field('sqlName', 'string', true);
          field('args', array('userArgument')); field('returns', 'type'); choice('nullable', ['propagate', 'never']); field('deterministic', 'boolean'); break;
        case 'userArgument':
          choice('kind', ['stringLike', 'column']);
          if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null || Object.getOwnPropertySymbols(object).length || Object.getOwnPropertyNames(object).some(k => k !== 'kind' && !(object.kind === 'column' && k === 'type'))) fail('expected plain closed user argument');
          if (object.kind === 'column') field('type', 'type'); break;
        case 'aggregateFn': field('linear', 'boolean'); // falls through to shared metadata
        case 'fn': field('user', 'userContract', true); field('known', 'knownEvidence', true); field('name', 'string'); field('sqlName', 'string', true); field('origin', 'string'); if (object.deterministic !== null) field('deterministic', 'boolean'); field('argumentPolicies', array('string'), true); break;
        case 'sort': field('expr', 'expr'); break;
        case 'branch': field('when', 'expr'); field('then', 'expr'); break;
        case 'tupleItem': field('name', 'string', true); field('type', 'type'); break;
        case 'enumItem': field('name', 'string'); field('value', 'number'); break;
        case 'provenance': field('origin', 'string'); field('label', 'string', true); break;
      }
    }
    // Push in reverse so diagnostics follow declared edge order, not stack order.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}
