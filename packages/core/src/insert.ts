import type { CHType, ScalarName } from './ch-type.js';
import type { TableDef } from './table.js';
import type { Infer } from './types.js';

type SupportedScalar = Exclude<ScalarName, 'IPv4' | 'IPv6' | 'JSON' | 'Nothing'>;
type Eligible<D> = CHType extends D ? false :
  D extends { kind: 'scalar'; name: infer N } ? [N] extends [SupportedScalar] ? true : false :
  D extends { kind: 'DateTime' | 'Decimal' | 'Enum' } ? true :
  D extends { kind: 'DateTime64'; precision: infer P } ? [P] extends [0 | 1 | 2 | 3] ? true : false :
  D extends { kind: 'Nullable' | 'LowCardinality' | 'Array'; inner: infer I } ? Eligible<I> :
  D extends { kind: 'Tuple'; items: infer I extends readonly { type: CHType; name?: string }[] } ?
    false extends Eligible<I[number]['type']> ? false :
    I[number] extends { name: string } ? true : 'name' extends keyof I[number] ? false : true : false;
type Metadata<T extends TableDef, K extends PropertyKey> = T extends { columnMetadata: infer M } ? K extends keyof M ? M[K] : never : never;
type Defaulted<T extends TableDef, K extends PropertyKey> = [Metadata<T, K>] extends [never] ? false : Metadata<T, K> extends { defaultKind: 'DEFAULT' } ? true : false;
type Hidden<T extends TableDef> = T extends { hiddenColumns: readonly (infer H)[] } ? string extends H ? never : H : never;
type Writable<T extends TableDef> = { [K in keyof Infer<T> & keyof T['columns']]: K extends Hidden<T> ? never :
  [Metadata<T, K>] extends [never] ? K : Metadata<T, K> extends { defaultKind: 'ALIAS' | 'MATERIALIZED' } ? never : K
}[keyof Infer<T> & keyof T['columns']];
type InsertValue<T extends TableDef, K extends keyof Infer<T> & keyof T['columns']> = [Eligible<T['columns'][K]>] extends [true] ? Infer<T>[K] : never;
/** Writable input fields; only a definite DEFAULT makes a field optional. */
export type InsertRow<T extends TableDef> = string extends keyof Infer<T> ? never : {
  [K in Writable<T> as Defaulted<T, K> extends true ? never : K]: InsertValue<T, K>
} & {
  [K in Writable<T> as Defaulted<T, K> extends true ? K : never]?: InsertValue<T, K>
};
/** Distribute over union members so a key present on only one member is still rejected. */
type UnionKeys<R> = R extends unknown ? keyof R : never;
export type ExactInsertRow<R, Expected> = R & Record<Exclude<UnionKeys<R>, keyof Expected>, never>;

export interface InsertCommandData {
  readonly table: TableDef;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}
const commands = new WeakMap<InsertCommand, InsertCommandData>();
/** An inert, nominal write command. Authoritative input snapshots are private. */
export class InsertCommand {
  declare private readonly insertCommandBrand: void;
  private constructor() { Object.freeze(this); }
  /** @internal */
  static create(table: TableDef, rows: readonly Readonly<Record<string, unknown>>[]): InsertCommand {
    const data = snapshot({ table, rows }) as InsertCommandData;
    if (!Array.isArray(data.rows)) throw new Error('invalid_insert_rows');
    for (const row of data.rows) {
      if (!isRecord(row)) throw new Error('invalid_insert_row: expected plain record');
      for (const key of Object.keys(row)) {
        if (!Object.hasOwn(data.table.columns, key) || forbidden(data.table, key)) throw new Error(`invalid_insert_column: ${key}`);
      }
      for (const key of Object.keys(data.table.columns)) {
        if (forbidden(data.table, key)) continue;
        if (!Object.hasOwn(row, key)) {
          if (data.table.columnMetadata?.[key]?.defaultKind !== 'DEFAULT') throw new Error(`missing_insert_column: ${key}`);
        } else if (!supported(data.table.columns[key]!)) throw new Error(`unsupported_insert_type: ${key}`);
      }
    }
    const command = new InsertCommand();
    commands.set(command, data);
    return command;
  }
}
/** Returns fresh defensive copies, including nested descriptors and Dates. */
export function getInsertCommandData(command: InsertCommand): InsertCommandData {
  const data = commands.get(command);
  if (!data) throw new Error('invalid_insert_command');
  return snapshot(data) as InsertCommandData;
}
function forbidden(table: TableDef, key: string): boolean {
  const kind = table.columnMetadata?.[key]?.defaultKind;
  return kind === 'ALIAS' || kind === 'MATERIALIZED' || (table.hiddenColumns?.includes(key) ?? false);
}
function supported(type: CHType): boolean {
  switch (type.kind) {
    case 'scalar': return !['IPv4', 'IPv6', 'JSON', 'Nothing'].includes(type.name);
    case 'DateTime': case 'Decimal': case 'Enum': return true;
    case 'DateTime64': return [0, 1, 2, 3].includes(type.precision);
    case 'Nullable': case 'LowCardinality': case 'Array': return supported(type.inner);
    case 'Tuple': return type.items.every(item => supported(item.type)) &&
      (type.items.every(item => item.name === undefined) || type.items.every(item => typeof item.name === 'string'));
    default: return false;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** Descriptor-based copying never invokes user getters or serialization hooks. */
function snapshot(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return value;
  if (typeof value !== 'object' || value === null) throw new Error('invalid_insert_value');
  if (ancestors.has(value)) throw new Error('invalid_insert_value: cyclic input');
  const array = Array.isArray(value);
  const date = Object.getPrototypeOf(value) === Date.prototype;
  if (!array && !date && !isRecord(value)) throw new Error('invalid_insert_value: expected plain record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(d => !('value' in d))) throw new Error('invalid_insert_value: symbols or accessors');
  if (date) {
    if (Object.keys(descriptors).length) throw new Error('invalid_insert_value: decorated Date');
    return new Date(Date.prototype.getTime.call(value));
  }
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors['length']!.value as number;
      if (Object.keys(descriptors).length !== length + 1) throw new Error('invalid_insert_value: sparse or decorated array');
      return Array.from({ length }, (_, i) => {
        const descriptor = descriptors[String(i)];
        if (!descriptor) throw new Error('invalid_insert_value: sparse array');
        return snapshot(descriptor.value, ancestors);
      });
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, snapshot(descriptor.value, ancestors)]));
  } finally { ancestors.delete(value); }
}
