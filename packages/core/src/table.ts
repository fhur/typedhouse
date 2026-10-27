import type { CHType } from './ch-type.js';
import { immutable } from './columns.js';
import type { Column, ColumnsRow } from './types.js';
export interface ChangeSource { readonly kind: string }
export interface ColumnMetadata { readonly defaultKind?: string; readonly comment?: string; readonly position?: number }
export interface TableMetadata {
  readonly engine: string;
  readonly sortingKey: readonly string[];
  readonly partitionKey: readonly string[];
  readonly primaryKey?: readonly string[];
  readonly columnMetadata?: Readonly<Record<string, ColumnMetadata>>;
  readonly source?: ChangeSource;
}
type SourceMetadata<M extends TableMetadata> = 'source' extends keyof M ? Pick<M, Extract<keyof M, 'source'>> : { readonly source?: never };
declare const rowType: unique symbol;
export interface TableDef<R = Record<string, unknown>> extends TableMetadata {
  readonly name: string;
  readonly columns: Readonly<Record<string, CHType>>;
  readonly [rowType]?: R;
}
export function table<const C extends Record<string, Column>, const M extends TableMetadata>(name: string, columns: C, metadata: M): TableDef<ColumnsRow<C>> & { readonly columns: { readonly [K in keyof C]: C[K]['type'] } } & SourceMetadata<M> {
  return immutable({ ...metadata, ...(metadata.source ? { source: { ...metadata.source } } : {}), ...(metadata.columnMetadata ? { columnMetadata: Object.fromEntries(Object.entries(metadata.columnMetadata).map(([key, value]) => [key, { ...value }])) } : {}), sortingKey: [...metadata.sortingKey], partitionKey: [...metadata.partitionKey], ...(metadata.primaryKey ? { primaryKey: [...metadata.primaryKey] } : {}), name, columns: Object.fromEntries(Object.entries(columns).map(([key, c]) => [key, c.type])) }) as unknown as TableDef<ColumnsRow<C>> & { readonly columns: { readonly [K in keyof C]: C[K]['type'] } } & SourceMetadata<M>;
}
