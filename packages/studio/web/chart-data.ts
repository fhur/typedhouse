/** Rows → Vega data. DOM-free so it unit-tests; the chart only, the table keeps exact values. */
export interface DataColumn { name: string; path: readonly string[]; type: string }

const NUMERIC = /^(?:Nullable\(|LowCardinality\()*(?:U?Int\d+|Float\d+|Decimal(?:\d+)?\()/;
export const isNumericType = (type: string) => NUMERIC.test(type);

const valueAt = (row: unknown, path: readonly string[]) =>
  path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), row);

function toChartValue(value: unknown, numeric: boolean): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (numeric && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (typeof value === 'object') return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  return value;
}

/**
 * One flat object per row, keyed by column name (join sides' paths flattened to their dotted names).
 * bigint and numeric strings (Decimal, quoted 64-bit) become numbers, Date stays a Date, null stays null,
 * and Map/Tuple/Array values become JSON text.
 */
export function toChartData(rows: readonly unknown[], columns: readonly DataColumn[]): Record<string, unknown>[] {
  return rows.map(row => {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const column of columns) out[column.name] = toChartValue(valueAt(row, column.path), isNumericType(column.type));
    return { ...out };
  });
}

/** Sample rows for the model: the same conversion, at most `limit` rows. */
export const chartSample = (rows: readonly unknown[], columns: readonly DataColumn[], limit = 20) => toChartData(rows.slice(0, limit), columns);

/**
 * A copy of a spec with no `element` in any `bind` and no `usermeta`: Vega empties the element a selector finds, anywhere in
 * the page, and no host element can stop a `document.querySelector`. vega-embed also takes such a target from
 * `usermeta.embedOptions` (`bind`, or `patch` adding one), and Studio's charts never need `usermeta`. The server refuses all
 * of these; this holds for a spec that never saw that check, such as a hand-edited saved query. Inputs then land in the chart.
 */
export function withoutPageTargets<T>(node: T, inBind = false): T {
  if (Array.isArray(node)) return node.map(item => withoutPageTargets(item, inBind)) as T;
  if (node === null || typeof node !== 'object' || node instanceof Date) return node;
  const entries = Object.entries(node).filter(([key]) => key !== 'usermeta' && !(inBind && key === 'element'));
  return Object.fromEntries(entries.map(([key, value]) => [key, withoutPageTargets(value, inBind || key === 'bind')])) as T;
}
