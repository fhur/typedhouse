import type { CHType } from './ch-type.js';
import type { TableDef } from './table.js';
import type { NodeId } from './types.js';

export type FlatColumns = Readonly<Record<string, CHType>>;
/** Entries, not object enumeration, are authoritative for SQL ordering (including numeric aliases). */
export type OutputSchema =
  | { readonly shape: 'flat'; readonly columns: FlatColumns; readonly order: readonly string[] }
  | { readonly shape: 'nested'; readonly inputs: readonly (readonly [string, OutputSchema])[]; readonly fields?: Extract<OutputSchema, { shape: 'flat' }> }
  | { readonly shape: 'deferred'; readonly reason: 'raw'; readonly declaredNames: readonly string[] };
export type ArgumentPolicy = 'set' | 'sibling' | 'arrayElement' | 'array' | 'numericIndex' | 'constantSelector' | 'dayUnit' | 'utcZone';
export interface KnownFunctionEntry {
  readonly isAggregate: boolean;
  readonly deterministic: boolean | null;
  readonly aliasTo: string;
}
export type KnownFunctionCatalog = Readonly<Record<string, KnownFunctionEntry>>;
export interface KnownCallEvidence {
  readonly catalog: KnownFunctionCatalog;
  readonly name: string;
  readonly declaration?: { readonly origin: 'as'; readonly type: CHType };
}
export interface FunctionMetadata {
  readonly known?: KnownCallEvidence;
  readonly repeatedArgs?: 'temporalGreatest' | 'stringMultiIf';
  readonly argumentPolicies?: readonly ArgumentPolicy[];
  readonly name: string;
  readonly sqlName?: string;
  readonly deterministic: boolean | null;
  readonly origin: 'typed' | 'known' | 'user';
  readonly js?: never;
}
export interface AggregateMetadata extends FunctionMetadata { readonly linear: boolean }
export interface RawProvenance {
  readonly origin: 'sql' | 'sql.relation';
  readonly label?: string;
}
interface Node { readonly id: NodeId }
interface TypedNode extends Node { readonly type: CHType }
export type ExprNode =
  | (TypedNode & { readonly kind: 'ColumnRef'; readonly mode?: 'row' | 'grouped'; readonly rel: NodeId; readonly path: readonly string[] })
  | (TypedNode & { readonly kind: 'Literal'; readonly value: unknown })
  | (Node & { readonly kind: 'Param'; readonly type: CHType | null; readonly value: unknown })
  | (TypedNode & { readonly kind: 'Call'; readonly fn: FunctionMetadata; readonly args: readonly ExprNode[] })
  | (TypedNode & { readonly kind: 'Agg'; readonly fn: AggregateMetadata; readonly args: readonly ExprNode[]; readonly params: readonly ExprNode[]; readonly combinators: readonly ('If' | 'Merge' | 'State')[] })
  | (Node & { readonly kind: 'Raw'; readonly type: CHType | null; readonly resolution: 'declared' | 'deferred'; readonly opaque: true; readonly provenance: RawProvenance; readonly parts: readonly string[]; readonly args: readonly ExprNode[] })
  | (TypedNode & { readonly kind: 'Case'; readonly branches: readonly { readonly when: ExprNode; readonly then: ExprNode }[]; readonly otherwise: ExprNode })
  | (TypedNode & { readonly kind: 'Cast'; readonly expr: ExprNode; readonly to: CHType })
  | (TypedNode & { readonly kind: 'Subquery'; readonly rel: Rel; readonly usage: 'scalar' | 'in' });
interface RelBase extends Node { readonly output: OutputSchema }
interface FlatRel extends RelBase { readonly output: Extract<OutputSchema, { shape: 'flat' }>; readonly columns: FlatColumns }
export type Scan = FlatRel & { readonly kind: 'Scan'; readonly table: TableDef; readonly final?: boolean; readonly sample?: number };
export type RawRel = RelBase & { readonly kind: 'RawRel'; readonly opaque: true; readonly provenance: RawProvenance; readonly parts: readonly string[]; readonly args: readonly ExprNode[] };
export type Filter = RelBase & { readonly kind: 'Filter'; readonly input: Rel; readonly pred: ExprNode };
export type Project = FlatRel & { readonly kind: 'Project'; readonly input: Rel; readonly exprs: Readonly<Record<string, ExprNode>> };
export type Aggregate = FlatRel & { readonly kind: 'Aggregate'; readonly input: Rel; readonly keys: Readonly<Record<string, ExprNode>>; readonly aggs: Readonly<Record<string, ExprNode>> };
export type Join = Node & { readonly kind: 'Join'; readonly output: Extract<OutputSchema, { shape: 'nested' }>; readonly joinKind: 'inner' | 'left' | 'right' | 'full' | 'cross'; readonly scope?: NodeId; readonly inputs: readonly (readonly [string, Rel])[]; readonly on: readonly ExprNode[] };
export type ArrayJoin = RelBase & { readonly columns: FlatColumns } & { readonly kind: 'ArrayJoin'; readonly input: Rel; readonly expr: ExprNode; readonly alias: string; readonly left: boolean };
export interface SortKey { readonly expr: ExprNode; readonly dir: 'asc' | 'desc'; readonly nulls?: 'first' | 'last' }
export type Sort = RelBase & { readonly kind: 'Sort'; readonly input: Rel; readonly keys: readonly SortKey[] };
export type Limit = RelBase & { readonly kind: 'Limit'; readonly input: Rel; readonly n: number; readonly offset?: number };
export type Distinct = RelBase & { readonly kind: 'Distinct'; readonly input: Rel };
export type Union = RelBase & { readonly kind: 'Union'; readonly inputs: readonly Rel[]; readonly all: boolean };
export type Materialize = RelBase & { readonly kind: 'Materialize'; readonly input: Rel };
export type Rel = Scan | RawRel | Filter | Project | Aggregate | Join | ArrayJoin | Sort | Limit | Distinct | Union | Materialize;
type WithoutId<T> = T extends Node ? Omit<T, 'id'> : never;
const graphNode = Symbol('chql.graphNode');
// The marker is inspectable, not an authority: only finalized constructors may
// enter this weak registry. Inherited/copied symbols must never bypass copying.
const finalizedNodes = new WeakSet<object>();
let counter = 0;

/** Copy owned containers, but retain references to already constructed graph nodes.
 * No id->node registry: unreachable graphs can be collected. Dates are copied on read
 * because Object.freeze(Date) cannot freeze its internal time slot.
 */
function snapshot<T>(value: T, ancestors = new Set<object>()): T {
  if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('IR: unsupported owned value');
  if (value === null || typeof value !== 'object') return value;
  if (finalizedNodes.has(value)) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (ancestors.has(value)) throw new TypeError('IR: cyclic owned value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('IR: unsupported owned object');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('IR: symbol-keyed owned object');
  const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? new Array<unknown>(value.length) : {};
  ancestors.add(value);
  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      // Array length is already copied by the constructor and frozen below.
      // Non-enumerable entries are still owned data (including dense indices).
      if (Array.isArray(value) && key === 'length') continue;
      const enumerable = Object.prototype.propertyIsEnumerable.call(value, key);
      const item = snapshot((value as Record<string, unknown>)[key], ancestors);
      Object.defineProperty(result, key, item instanceof Date
        ? { enumerable, get: () => new Date(item.getTime()) }
        : { enumerable, value: item });
    }
    return Object.freeze(result) as T;
  } finally { ancestors.delete(value); }
}
function construct<T extends Node>(fields: WithoutId<T>): T {
  if (counter === Number.MAX_SAFE_INTEGER) throw new Error('IR node id space exhausted');
  const copied = snapshot(fields);
  const result = Object.defineProperties({}, Object.getOwnPropertyDescriptors(copied));
  Object.defineProperty(result, 'id', { enumerable: true, value: ++counter as NodeId });
  Object.defineProperty(result, graphNode, { value: true });
  Object.freeze(result);
  finalizedNodes.add(result);
  return result as T;
}
/** Low-level constructors deliberately leave semantic validation to the compiler. */
export function exprNode<K extends ExprNode['kind']>(fields: WithoutId<Extract<ExprNode, { kind: K }>> & { readonly kind: K }): Extract<ExprNode, { kind: K }> {
  return construct<Extract<ExprNode, { kind: K }>>(fields);
}
export function relNode<K extends Rel['kind']>(fields: WithoutId<Extract<Rel, { kind: K }>> & { readonly kind: K }): Extract<Rel, { kind: K }> {
  return construct<Extract<Rel, { kind: K }>>(fields);
}
export function flatOutput(entries: readonly (readonly [string, CHType])[]): Extract<OutputSchema, { shape: 'flat' }> {
  if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error('duplicate_column');
  return snapshot({ shape: 'flat', columns: Object.fromEntries(entries), order: entries.map(([name]) => name) });
}
