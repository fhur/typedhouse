import type { CHType } from '@chql/core';
import { canonicalKey } from '@chql/core';
import { decodedRecord } from './backend-harness.js';
import type { Recipe, Scope, Tree } from './fixture-differential-arbitrary.js';

// Deliberately independent of builder descriptors, compiler SQL and production decoder.
const metricNames = {
  availability: ['metric_group_ots_component_market_availability', 'market_stock_total', false],
  componentIndices: ['metric_group_ots_component_indices', 'stock_index', false],
  partIndices: ['metric_group_off_the_shelf_part_indices', 'stock_index', true],
  price: ['metric_group_off_the_shelf_part_market_price', 'market_unit_price_1k_p50', true],
} satisfies Record<string, readonly [string, string, boolean]>;
function entityIds(s: Scope, part: boolean) { return Array.from({ length: 4 }, (_, n) => `'${part ? 'part' : 'cmp'}_${s.start + n}'`).join(','); }
function entity(s: Scope, part: boolean) {
  return `SELECT * FROM ${part ? 'entity_off_the_shelf_part' : 'entity_ots_component'} WHERE tenantId={tenant:String} AND entityId IN (${entityIds(s, part)})`;
}
const fields = 'tenant,id,at,version,value';
export const totalOrder = 'tenant,id,at,version,value';
function tree(t: Tree, s: Scope, depth = 0): string {
  if (t.op === 'union') return `SELECT ${fields} FROM (${tree(t.left, s, depth + 1)} UNION ALL ${tree(t.repeat ? t.left : t.right, s, depth + 1)})`;
  if (t.op !== 'metric') {
    const input = tree(t.input, s, depth + 1);
    switch (t.op) {
      case 'cte': return `WITH explicit_${depth} AS (${input}) SELECT ${fields} FROM explicit_${depth}`;
      case 'project': return `SELECT ${fields} FROM (${input})`;
      case 'filter': return `SELECT ${fields} FROM (${input}) WHERE value>500`;
      case 'distinct': return `SELECT DISTINCT ${fields} FROM (${input})`;
      case 'in': return `SELECT ${fields} FROM (${input}) WHERE id IN (SELECT id FROM (${input}) WHERE value>500)`;
    }
  }
  const [table, value, part] = metricNames[t.metric];
  // Explicit >= / <=, not the builder's BETWEEN expression.
  const input = `SELECT * FROM ${table} FINAL WHERE tenantId={tenant:String} AND entityId IN (${entityIds(s, part)}) AND effectiveAt>=toDateTime64({since:String},3,'UTC') AND effectiveAt<=toDateTime64({until:String},3,'UTC')`;
  const selected = t.latest ? `SELECT a.* FROM (${input}) a INNER ALL JOIN (SELECT tenantId,entityId,max(version) AS newest FROM (${input}) GROUP BY tenantId,entityId) b ON a.tenantId=b.tenantId AND a.entityId=b.entityId AND a.version=b.newest` : input;
  const metric = `SELECT tenantId AS tenant,entityId AS id,effectiveAt AS at,version,${value} AS value FROM (${selected})`;
  if (t.cross) return `SELECT m.tenant AS tenant,m.id AS id,m.at AS at,m.version AS version,m.value AS value FROM (SELECT tenantId,entityId,arrayJoin(matched_part_ids) AS partId FROM (${entity(s, false)})) c INNER ALL JOIN (SELECT * FROM entity_off_the_shelf_part WHERE tenantId={tenant:String}) p ON c.tenantId=p.tenantId AND c.partId=p.entityId INNER ALL JOIN (${metric}) m ON c.tenantId=m.tenant AND ${part ? 'p' : 'c'}.entityId=m.id`;
  if (t.attached) return `SELECT m.tenant AS tenant,m.id AS id,m.at AS at,m.version AS version,m.value AS value FROM (${entity(s, part)}) e INNER ALL JOIN (${metric}) m ON e.tenantId=m.tenant AND e.entityId=m.id`;
  return metric;
}
export function native(r: Recipe) {
  const input = tree(r.tree, r.scope);
  const ordered = `SELECT ${fields} FROM (${input}) ORDER BY value`;
  const sql = r.end === 'rollup' ? `SELECT tenant,count() AS rows,uniq(id) AS entities,sum(value) AS total FROM (${ordered}) GROUP BY tenant`
    : r.end === 'share' ? `WITH base AS (${ordered}) SELECT ${fields},value/(SELECT sum(value) FROM base) AS share FROM base`
    : r.end === 'limit' ? `SELECT ${fields} FROM (${input}) ORDER BY ${totalOrder} LIMIT 7 OFFSET 1` : input;
  const ms = Date.UTC(2026, 3, 27) + r.scope.week * 604800000;
  const timestamp = (n: number) => new Date(n).toISOString().replace('T', ' ').replace('Z', '');
  return { sql, params: { tenant: r.scope.tenant, since: timestamp(ms), until: timestamp(ms + 604800000) } };
}
const string: CHType = { kind: 'scalar', name: 'String' };
const float: CHType = { kind: 'scalar', name: 'Float64' };
const uint64: CHType = { kind: 'scalar', name: 'UInt64' };
export function descriptors(end: Recipe['end']): Record<string, CHType> {
  if (end === 'rollup') return { tenant: string, rows: uint64, entities: uint64, total: float };
  return { tenant: string, id: string, at: { kind: 'DateTime64', precision: 3 }, version: { kind: 'scalar', name: 'UInt32' }, value: float, ...(end === 'share' ? { share: { kind: 'Nullable', inner: float } satisfies CHType } : {}) };
}
function text(v: unknown): string { if (typeof v !== 'string') throw new Error('native expected string'); return v; }
function number(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === 'nan') return NaN;
  if (v === 'inf') return Infinity;
  if (v === '-inf') return -Infinity;
  throw new Error(`native expected float: ${String(v)}`);
}
export function decodeNative(value: unknown, end: Recipe['end']) {
  const r = decodedRecord(value);
  if (end === 'rollup') return { tenant: text(r.tenant), rows: BigInt(text(r.rows)), entities: BigInt(text(r.entities)), total: number(r.total) };
  return { tenant: text(r.tenant), id: text(r.id), at: new Date(text(r.at)), version: number(r.version), value: number(r.value), ...(end === 'share' ? { share: r.share === null ? null : number(r.share) } : {}) };
}
export const componentColumns: Record<string, CHType> = {
  id: string, category: { kind: 'Nullable', inner: string },
  parts: { kind: 'Array', inner: { kind: 'Tuple', items: ['id', 'mpn', 'manufacturer', 'description', 'package', 'part_type'].map(name => ({ name, type: name === 'id' ? string : { kind: 'Nullable', inner: string } })) } },
  ids: { kind: 'Array', inner: string }, count: uint64, at: { kind: 'DateTime64', precision: 3 },
};
export const partColumns: Record<string, CHType> = {
  id: string, category: { kind: 'Nullable', inner: { kind: 'scalar', name: 'Int64' } },
  path: { kind: 'Array', inner: { kind: 'scalar', name: 'Int64' } }, lifecycle: { kind: 'Nullable', inner: string }, years: { kind: 'Nullable', inner: float }, at: { kind: 'DateTime64', precision: 3 },
};
// Small independent decoder for precisely the fixture families. Unsupported types
// throw: neither production rowDecoder nor its inferred metadata participates.
export function decodeCell(v: unknown, t: CHType): unknown {
  if (t.kind === 'Nullable') return v === null ? null : decodeCell(v, t.inner);
  if (t.kind === 'Array') { if (!Array.isArray(v)) throw new Error('expected native array'); return v.map(x => decodeCell(x, t.inner)); }
  if (t.kind === 'Tuple') {
    const r = decodedRecord(v);
    return Object.fromEntries(t.items.map(item => { if (!item.name) throw new Error('unnamed tuple unsupported'); return [item.name, decodeCell(r[item.name], item.type)]; }));
  }
  if (t.kind === 'DateTime64') { const date = new Date(text(v)); if (!Number.isFinite(date.getTime())) throw new Error('invalid date'); return date; }
  if (t.kind === 'scalar') {
    if (t.name === 'String') return text(v);
    if (t.name === 'UInt64' || t.name === 'Int64') return BigInt(text(v));
    if (t.name === 'Float64' || t.name === 'UInt32') return number(v);
  }
  throw new Error(`unsupported independent decoder ${JSON.stringify(t)}`);
}
export function decodeColumns(row: unknown, columns: Record<string, CHType>) {
  const r = decodedRecord(row);
  return Object.fromEntries(Object.entries(columns).map(([name, type]) => [name, decodeCell(r[name], type)]));
}
export function independentKeys(rows: readonly unknown[], end: Recipe['end'], ordered: boolean) {
  const columns = Object.entries(descriptors(end));
  const result = rows.map(row => {
    const r = decodedRecord(row);
    if (JSON.stringify(Object.keys(r)) !== JSON.stringify(columns.map(([name]) => name))) throw new Error('unexpected decoded paths/order');
    return canonicalKey(r, columns);
  });
  return ordered ? result : result.sort();
}
