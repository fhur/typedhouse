import fc from 'fast-check';
import { avg, cast, col, count, countIf, from, fullJoin, join, leftJoin, max, rightJoin, sum, table, uniq, type Query } from '@typedhouse/core';
export const seed = 20261131;
// Three tables of one schema: orphan ids on every side, duplicate keys, NULL keys and empty arrays.
const columns = { id: col.UInt32, k: col.Nullable(col.UInt32), s: col.String, tags: col.Array(col.String), lc: col.LowCardinality(col.String), at: col.DateTime64(3), flag: col.Bool };
export const tables = ['oj_a', 'oj_b', 'oj_c'] as const;
const sources = tables.map(name => from(table(name, columns, { engine: 'Memory', sortingKey: [], partitionKey: [] })));
export const ddl = tables.map(name => `CREATE TABLE ${name} (id UInt32, k Nullable(UInt32), s String, tags Array(String), lc LowCardinality(String), at DateTime64(3), flag Bool) ENGINE=Memory`);
export const rows = [
  [[1, 1, 'x', ['p'], 'u', '2026-01-01 00:00:00.001', true], [2, 2, 'y', [], 'v', '2026-01-02 00:00:00.000', false], [2, null, 'y', ['q', 'q'], 'v', '2026-01-02 00:00:00.000', true], [3, 9, '7', [], '', '1970-01-01 00:00:00.000', false], [4, 4, 'z', ['r'], 'w', '2026-03-04 05:06:07.089', true]],
  [[2, 1, 'y', ['b'], 'v', '2026-02-01 00:00:00.000', true], [2, 3, 'x', [], 'u', '2026-02-02 00:00:00.000', false], [4, null, 'z', [], 'w', '2026-02-03 00:00:00.000', true], [5, 5, 'orphan', ['o'], 'o', '2026-02-04 00:00:00.000', false], [7, 2, 'x', ['s'], '', '2026-02-05 00:00:00.000', true]],
  [[1, 2, 'x', [], 'u', '2026-03-01 00:00:00.000', false], [3, 3, '7', ['c'], '', '2026-03-02 00:00:00.000', true], [8, null, 'lonely', [], 'l', '2026-03-03 00:00:00.000', false], [9, 9, 'y', ['d', 'e'], 'v', '2026-03-04 00:00:00.000', true]],
] as const;
export const inserts = tables.map((name, i) => `INSERT INTO ${name} VALUES ${rows[i]!.map(r => `(${r.map(v => v === null ? 'NULL' : Array.isArray(v) ? `[${v.map(x => `'${x}'`).join(',')}]` : typeof v === 'string' ? `'${v}'` : String(v)).join(',')})`).join(',')}`);
type Key = 'id' | 'k';
const COLUMNS = ['id', 'k', 's', 'tags', 'lc', 'at', 'flag'] as const;
export type Kind = 'inner' | 'left' | 'right' | 'full';
export interface Condition { left: number; right: number; leftKey: Key; rightKey: Key; text: boolean }
export type Node =
  | { node: 'table'; table: 0 | 1 | 2; pre: number | null }
  | { node: 'join'; kind: Kind; left: Node; right: Node; on: Condition };
/** A binary outer join at the top; either input may itself be a (inner or outer) join: composition is
 * how a three-way outer join is written. ON picks one table occurrence (by leaf-table index) per side. */
export interface Recipe {
  root: Extract<Node, { node: 'join' }>;
  /** Equal table occurrences (same table and pre-filter) share one Query object, a CTE. */
  shared: boolean;
  post: { side: 0 | 1; op: 'isNull' | 'gt' } | null;
  /** A WHERE outside the total fragment after a guard: CAST(s AS Nullable(UInt8)) fails unless s = '7' (or NULL). */
  fallible: { side: 0 | 1 } | null;
  project: 'none' | 'direct' | 'computed' | 'aggregate' | 'aggregates';
  order: 'first' | 'last' | null;
  distinct: boolean;
}
const leaf: fc.Arbitrary<Node> = fc.record({ node: fc.constant('table' as const), table: fc.constantFrom(0 as const, 1 as const, 2 as const), pre: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }) });
const condition = fc.record({ left: fc.nat(1), right: fc.nat(1), leftKey: fc.constantFrom<Key>('id', 'k'), rightKey: fc.constantFrom<Key>('id', 'k'), text: fc.boolean() });
const outerKind = fc.constantFrom<Kind>('left', 'right', 'full');
const side: fc.Arbitrary<Node> = fc.oneof({ weight: 3, arbitrary: leaf }, { weight: 2, arbitrary: fc.record({ node: fc.constant('join' as const), kind: fc.constantFrom<Kind>('inner', 'left', 'right', 'full'), left: leaf, right: leaf, on: condition }) });
export const recipes: fc.Arbitrary<Recipe> = fc.record({
  root: fc.record({ node: fc.constant('join' as const), kind: outerKind, left: side, right: side, on: condition }),
  shared: fc.boolean(),
  post: fc.option(fc.record({ side: fc.constantFrom(0 as const, 1 as const), op: fc.constantFrom('isNull' as const, 'gt' as const) }), { nil: null }),
  // One recipe in four: the guard keeps only s = '7' rows, which would otherwise empty most results.
  fallible: fc.oneof({ weight: 3, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: fc.record({ side: fc.constantFrom(0 as const, 1 as const) }) }),
  project: fc.constantFrom('none' as const, 'direct' as const, 'computed' as const, 'aggregate' as const, 'aggregates' as const),
  order: fc.constantFrom('first' as const, 'last' as const, null),
  distinct: fc.boolean(),
});
const label = (n: Node): string => n.node === 'table' ? `${n.table}${n.pre === null ? '' : '>'}` : `${n.kind}(${label(n.left)},${label(n.right)};${n.on.left}${n.on.leftKey[0]}${n.on.right}${n.on.rightKey[0]}${n.on.text ? '+' : ''})`;
export function shape(r: Recipe) { return `${label(r.root)}:${r.shared}:${r.post ? `${r.post.side}${r.post.op}` : '-'}:${r.fallible ? `cast${r.fallible.side}` : '-'}:${r.project}:${r.order ?? '-'}:${r.distinct ? 'distinct' : '-'}`; }
/** Aliases by depth: the root joins a0/a1, a nested join under a0 joins b0/b1, under a1 c0/c1. */
const aliases = (prefix: string): [string, string] => [`${prefix}0`, `${prefix}1`];
const childPrefix = (prefix: string, i: 0 | 1) => prefix === 'a' ? (i ? 'c' : 'b') : 'x';
/** Leaf-table paths of a node, in output order. */
function tablePaths(n: Node, prefix: string): string[][] {
  if (n.node === 'table') return [[]];
  const [l, r] = aliases(prefix);
  return [...tablePaths(n.left, childPrefix(prefix, 0)).map(p => [l, ...p]), ...tablePaths(n.right, childPrefix(prefix, 1)).map(p => [r, ...p])];
}
function sidePaths(n: Node, prefix: string, i: 0 | 1): string[][] {
  const child = i ? (n as Extract<Node, { node: 'join' }>).right : (n as Extract<Node, { node: 'join' }>).left;
  return tablePaths(child, childPrefix(prefix, i)).map(p => [aliases(prefix)[i], ...p]);
}
const pick = (paths: string[][], i: number) => paths[i % paths.length]!;
const at = (row: any, path: readonly string[]) => path.reduce((x, k) => x[k], row);
/** Builder query for a recipe. Every ON condition is one column equality (plus an optional text equality). */
export function build(r: Recipe, fault = false): Query<unknown> {
  const cache = new Map<string, Query<unknown>>();
  function make(n: Node, prefix: string): Query<unknown> {
    if (n.node === 'table') {
      const id = `${n.table}:${n.pre}`;
      const fresh = () => (n.pre === null ? sources[n.table]! : sources[n.table]!.where(x => x.id.gt(n.pre!))) as Query<unknown>;
      if (!r.shared) return fresh();
      if (!cache.has(id)) cache.set(id, fresh());
      return cache.get(id)!;
    }
    const [la, ra] = aliases(prefix);
    const left = { [la]: make(n.left, childPrefix(prefix, 0)) }, right = { [ra]: make(n.right, childPrefix(prefix, 1)) };
    // Aliases are dynamic here, so the static one-input guards are bypassed; the runtime checks still run.
    const builder: any = n.kind === 'inner' ? join({ ...left, ...right } as any) : (n.kind === 'left' ? leftJoin : n.kind === 'right' ? rightJoin : fullJoin)(left as any, right as any);
    const lp = pick(sidePaths(n, prefix, 0), n.on.left).slice(1), rp = pick(sidePaths(n, prefix, 1), n.on.right).slice(1);
    return builder.on((row: any) => {
      const a = at(row[la], lp), b = at(row[ra], rp);
      return [a[n.on.leftKey].eq(b[n.on.rightKey]), ...(n.on.text ? [a.s.eq(b.s)] : [])];
    });
  }
  // Fault injection: the top-level outer join silently becomes an inner join (null extension lost).
  const joined: any = make(fault ? { ...r.root, kind: 'inner' } : r.root, 'a');
  const lt = sidePaths(r.root, 'a', 0)[0]!, rt = sidePaths(r.root, 'a', 1)[0]!;
  const posted: any = !r.post ? joined : joined.where((row: any) => {
    const t = at(row, r.post!.side ? rt : lt);
    return r.post!.op === 'isNull' ? t.k.isNull() : t.id.gt(2);
  });
  const filtered: any = !r.fallible ? posted : posted.where((row: any) => at(row, r.fallible!.side ? rt : lt).s.eq('7'))
    .where((row: any) => cast(at(row, r.fallible!.side ? rt : lt).s, col.Nullable(col.UInt8)).gt(1));
  let out: any;
  switch (r.project) {
    case 'none': out = filtered; break;
    case 'direct': out = filtered.map((row: any) => ({ x: at(row, lt).id, y: at(row, rt).s, z: at(row, rt).tags, w: at(row, rt).lc, t: at(row, rt).at, b: at(row, lt).flag })); break;
    case 'computed': out = filtered.map((row: any) => ({ x: at(row, rt).id.ifNull(0), y: at(row, lt).s.ifNull(''), z: at(row, rt).k.plus(1) })); break;
    case 'aggregate': out = filtered.groupBy((row: any) => ({ key: at(row, lt).s })).aggregate((g: any) => ({ n: count(), m: max(at(g, rt).id) })); break;
    case 'aggregates': out = filtered.groupBy((row: any) => ({ key: at(row, rt).lc })).aggregate((g: any) => ({ total: sum(at(g, rt).id), mean: avg(at(g, lt).id), distinct: uniq(at(g, rt).s), present: countIf(at(g, rt).k.isNotNull()) })); break;
  }
  if (r.distinct) out = out.distinct();
  if (r.order) {
    const first = Object.keys(out.row)[0]!, key = (row: any) => r.project === 'none' ? at(row, rt).id : row[first];
    out = out.orderBy((row: any) => r.order === 'first' ? key(row).asc().nullsFirst() : key(row).desc().nullsLast());
  }
  return out;
}
const KW: Record<Kind, string> = { inner: 'INNER ALL JOIN', left: 'LEFT ALL JOIN', right: 'RIGHT ALL JOIN', full: 'FULL ALL JOIN' };
/** Native SQL of a node: a derived table whose columns are named by their path below it, joined by `__`. */
function nativeNode(n: Node, prefix: string): string {
  if (n.node === 'table') return `SELECT ${COLUMNS.join(',')} FROM ${tables[n.table]}${n.pre === null ? '' : ` WHERE id > ${n.pre}`}`;
  const cols = tablePaths(n, prefix).flatMap(p => COLUMNS.map(c => `${p[0]}.\`${[...p.slice(1), c].join('__')}\` AS \`${[...p, c].join('__')}\``));
  return `SELECT ${cols.join(', ')} FROM ${joinText(n, prefix)}`;
}
const ref = (path: readonly string[], column: string) => `${path[0]}.\`${[...path.slice(1), column].join('__')}\``;
function joinText(n: Extract<Node, { node: 'join' }>, prefix: string): string {
  const [la, ra] = aliases(prefix);
  const lp = pick(sidePaths(n, prefix, 0), n.on.left), rp = pick(sidePaths(n, prefix, 1), n.on.right);
  return `(${nativeNode(n.left, childPrefix(prefix, 0))}) AS ${la} ${KW[n.kind]} (${nativeNode(n.right, childPrefix(prefix, 1))}) AS ${ra} ON ${ref(lp, n.on.leftKey)} = ${ref(rp, n.on.rightKey)}${n.on.text ? ` AND ${ref(lp, 's')} = ${ref(rp, 's')}` : ''}`;
}
const flat = (path: readonly string[], column: string) => `\`${[...path, column].join('__')}\``;
/** Independent native SQL. Column aliases are the compiled output names, so one decoder reads all three. The joined
 * row is materialized once with flattened path names; the guarded fallible filter sits in its own outer scope. */
export function native(r: Recipe, names: readonly string[]): string {
  const lt = sidePaths(r.root, 'a', 0)[0]!, rt = sidePaths(r.root, 'a', 1)[0]!;
  const all = tablePaths(r.root, 'a').flatMap(p => COLUMNS.map(c => `${ref(p, c)} AS ${flat(p, c)}`));
  const where = !r.post ? '' : ` WHERE ${r.post.op === 'isNull' ? `${ref(r.post.side ? rt : lt, 'k')} IS NULL` : `${ref(r.post.side ? rt : lt, 'id')} > 2`}`;
  let base = `SELECT ${all.join(', ')} FROM ${joinText(r.root, 'a')}${where}`;
  if (r.fallible) {
    const text = flat(r.fallible.side ? rt : lt, 's');
    base = `SELECT * FROM (SELECT * FROM (${base}) WHERE ${text} = '7') WHERE CAST(${text} AS Nullable(UInt8)) > 1`;
  }
  const f = (path: readonly string[], c: string) => `q.${flat(path, c)}`;
  const select = r.project === 'none' ? tablePaths(r.root, 'a').flatMap(p => COLUMNS.map(c => f(p, c)))
    : r.project === 'direct' ? [f(lt, 'id'), f(rt, 's'), f(rt, 'tags'), f(rt, 'lc'), f(rt, 'at'), f(lt, 'flag')]
    : r.project === 'computed' ? [`ifNull(${f(rt, 'id')}, toUInt32(0))`, `ifNull(${f(lt, 's')}, '')`, `${f(rt, 'k')} + 1`]
    : r.project === 'aggregate' ? [f(lt, 's'), 'count()', `max(${f(rt, 'id')})`]
    : [f(rt, 'lc'), `sum(${f(rt, 'id')})`, `avg(${f(lt, 'id')})`, `uniq(${f(rt, 's')})`, `countIf(${f(rt, 'k')} IS NOT NULL)`];
  if (select.length !== names.length) throw new Error(`oracle arity ${select.length} vs ${names.length}`);
  const group = r.project === 'aggregate' ? ` GROUP BY ${f(lt, 's')}` : r.project === 'aggregates' ? ` GROUP BY ${f(rt, 'lc')}` : '';
  const order = !r.order ? '' : ` ORDER BY ${r.project === 'none' ? `\`${names[tablePaths(r.root, 'a').findIndex(p => p.join() === rt.join()) * COLUMNS.length]}\`` : `\`${names[0]}\``} ${r.order === 'first' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST'}`;
  return `SELECT${r.distinct ? ' DISTINCT' : ''} ${select.map((e, i) => `${e} AS \`${names[i]}\``).join(', ')} FROM (${base}) AS q${group}${order} SETTINGS join_use_nulls = 1`;
}
