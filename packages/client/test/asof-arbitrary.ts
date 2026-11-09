import fc from 'fast-check';
import { asofJoin, asofLeftJoin, count, from, sum } from '@typedhouse/core';
import {
  closest,
  left,
  right,
  seededRows,
  type LeftRow,
  type Op,
  type RightRow,
} from './asof-support.js';

/** Recipes over the seeded pair, whose right (sym, ts) is unique: ties differ between runs of one
 * SQL, so a differential over tied rows would prove nothing. */
export const seed = 20261106;

const { lefts, rights } = seededRows();

const T = (ts: number) => new Date(ts * 1000);

export type InputFilter =
  | { kind: 'none' }
  | { kind: 'flag'; value: number }
  | { kind: 'v'; gt: number }
  | { kind: 'twice'; value: number; gt: number }
  | { kind: 'map' }
  | { kind: 'prewhere'; value: number }
  | { kind: 'firstRows'; n: number };

export type LeftInput =
  { kind: 'none' } | { kind: 'id'; lt: number } | { kind: 'twice'; gt: number; lt: number };

export type Conjunct =
  | { on: 'left'; kind: 'id'; lt: number }
  | { on: 'left'; kind: 'sym'; value: string }
  | { on: 'left'; kind: 'ts'; gt: number }
  | { on: 'right'; kind: 'flag'; value: number }
  | { on: 'right'; kind: 'v'; gt: number }
  | { on: 'right'; kind: 'ts'; lt: number }
  | { on: 'right'; kind: 'sym'; value: string }
  | { on: 'right'; kind: 'nvNull' }
  | { on: 'both'; kind: 'sum'; gt: number }
  | { on: 'both'; kind: 'or'; lt: number; value: number };

export type Top =
  | { kind: 'rows' }
  | { kind: 'limit'; n: number }
  | { kind: 'mapFilter'; value: number }
  | { kind: 'aggregate' };

export interface Recipe {
  join: 'inner' | 'left';
  op: Op;
  leftInput: LeftInput;
  rightInput: InputFilter;
  /** Each list is one `where` call; a list of several is a conjunction, split by the rewrite. */
  above: Conjunct[][];
  top: Top;
}

const sym = fc.constantFrom('A', 'B', 'C', 'D', 'E', 'Z');

const conjunct: fc.Arbitrary<Conjunct> = fc.oneof(
  fc.record({
    on: fc.constant('left' as const),
    kind: fc.constant('id' as const),
    lt: fc.integer({ min: 1, max: 300 }),
  }),
  fc.record({ on: fc.constant('left' as const), kind: fc.constant('sym' as const), value: sym }),
  fc.record({
    on: fc.constant('left' as const),
    kind: fc.constant('ts' as const),
    gt: fc.integer({ min: 1000, max: 3000 }),
  }),
  fc.record({
    on: fc.constant('right' as const),
    kind: fc.constant('flag' as const),
    value: fc.constantFrom(0, 1),
  }),
  fc.record({
    on: fc.constant('right' as const),
    kind: fc.constant('v' as const),
    gt: fc.integer({ min: 0, max: 1000 }),
  }),
  fc.record({
    on: fc.constant('right' as const),
    kind: fc.constant('ts' as const),
    lt: fc.integer({ min: 1000, max: 3000 }),
  }),
  fc.record({ on: fc.constant('right' as const), kind: fc.constant('sym' as const), value: sym }),
  fc.record({ on: fc.constant('right' as const), kind: fc.constant('nvNull' as const) }),
  fc.record({
    on: fc.constant('both' as const),
    kind: fc.constant('sum' as const),
    gt: fc.integer({ min: 0, max: 1300 }),
  }),
  fc.record({
    on: fc.constant('both' as const),
    kind: fc.constant('or' as const),
    lt: fc.integer({ min: 1, max: 300 }),
    value: fc.constantFrom(0, 1),
  }),
);

export const recipes: fc.Arbitrary<Recipe> = fc.record({
  join: fc.constantFrom('inner' as const, 'left' as const),
  op: fc.constantFrom('ge' as const, 'gt' as const, 'le' as const, 'lt' as const),
  leftInput: fc.oneof(
    fc.constant<LeftInput>({ kind: 'none' }),
    fc.integer({ min: 1, max: 300 }).map<LeftInput>(lt => ({ kind: 'id', lt })),
    fc.integer({ min: 1, max: 150 }).map<LeftInput>(gt => ({ kind: 'twice', gt, lt: gt + 100 })),
  ),
  rightInput: fc.oneof(
    fc.constant<InputFilter>({ kind: 'none' }),
    fc.constantFrom(0, 1).map<InputFilter>(value => ({ kind: 'flag', value })),
    fc.integer({ min: 0, max: 1000 }).map<InputFilter>(gt => ({ kind: 'v', gt })),
    fc
      .tuple(fc.constantFrom(0, 1), fc.integer({ min: 0, max: 1000 }))
      .map<InputFilter>(([value, gt]) => ({ kind: 'twice', value, gt })),
    fc.constant<InputFilter>({ kind: 'map' }),
    fc.constantFrom(0, 1).map<InputFilter>(value => ({ kind: 'prewhere', value })),
    fc.integer({ min: 1, max: 500 }).map<InputFilter>(n => ({ kind: 'firstRows', n })),
  ),
  above: fc.array(fc.array(conjunct, { minLength: 1, maxLength: 3 }), { maxLength: 3 }),
  top: fc.oneof(
    fc.constant<Top>({ kind: 'rows' }),
    fc.integer({ min: 1, max: 40 }).map<Top>(n => ({ kind: 'limit', n })),
    fc.constantFrom(0, 1).map<Top>(value => ({ kind: 'mapFilter', value })),
    fc.constant<Top>({ kind: 'aggregate' }),
  ),
});

export const shape = (r: Recipe) =>
  `${r.join}:${r.leftInput.kind}:${r.rightInput.kind}:${r.above
    .flat()
    .map(c => c.on[0])
    .join('')}:${r.top.kind}`;

function predicate(row: any, c: Conjunct): any {
  switch (c.kind) {
    case 'id':
      return row.t.id.lt(c.lt);
    case 'sym':
      return (c.on === 'left' ? row.t : row.q).sym.eq(c.value);
    case 'ts':
      return c.on === 'left' ? row.t.ts.gt(T(c.gt)) : row.q.ts.lt(T(c.lt));
    case 'flag':
      return row.q.flag.eq(c.value);
    case 'v':
      return row.q.v.gt(c.gt);
    case 'nvNull':
      return row.q.nv.isNull();
    case 'sum':
      return row.t.id.plus(row.q.v).gt(BigInt(c.gt));
    case 'or':
      return row.t.id.lt(c.lt).or(row.q.flag.eq(c.value));
  }
}

function leftInput(r: Recipe) {
  const s = r.leftInput;

  return s.kind === 'none'
    ? from(left)
    : s.kind === 'id'
      ? from(left).where(x => x.id.lt(s.lt))
      : from(left)
          .where(x => x.id.gt(s.gt))
          .where(x => x.id.lt(s.lt));
}

function rightInput(r: Recipe): any {
  const s = r.rightInput;

  switch (s.kind) {
    case 'none':
      return from(right);
    case 'flag':
      return from(right).where(x => x.flag.eq(s.value));
    case 'v':
      return from(right).where(x => x.v.gt(s.gt));
    case 'twice':
      return from(right)
        .where(x => x.flag.eq(s.value))
        .where(x => x.v.gt(s.gt));
    case 'map':
      return from(right).map(x => ({
        rid: x.rid,
        sym: x.sym,
        ts: x.ts,
        flag: x.flag,
        v: x.v,
        nv: x.nv,
      }));
    case 'prewhere':
      return from(right).prewhere(x => x.flag.eq(s.value));
    case 'firstRows':
      return from(right)
        .orderBy(x => x.rid)
        .limit(s.n);
  }
}

export function build(r: Recipe): any {
  let q: any = ((r.join === 'inner' ? asofJoin : asofLeftJoin) as typeof asofJoin)(
    { t: leftInput(r) },
    { q: rightInput(r) },
  )
    .on((x: any) => x.t.sym.eq(x.q.sym))
    .asof((x: any) => x.t.ts[r.op](x.q.ts));

  for (const list of r.above)
    q = q.where((x: any) => list.map(c => predicate(x, c)).reduce((a, b) => a.and(b)));

  switch (r.top.kind) {
    case 'rows':
      return q.map((x: any) => ({ id: x.t.id, rid: x.q.rid }));
    case 'limit':
      return q
        .map((x: any) => ({ id: x.t.id, rid: x.q.rid }))
        .orderBy((x: any) => x.id)
        .limit(r.top.n);

    case 'mapFilter': {
      const value = r.top.value;

      return q
        .map((x: any) => ({ id: x.t.id, rid: x.q.rid, f: x.q.flag }))
        .where((x: any) => x.f.eq(value))
        .map((x: any) => ({ id: x.id, rid: x.rid }));
    }

    case 'aggregate':
      return q
        .groupBy((x: any) => ({ f: x.q.flag }))
        .aggregate((x: any) => ({ n: count(), s: sum(x.q.v) }));
  }
}

function holds(c: Conjunct, l: LeftRow, m: RightRow | undefined): boolean {
  switch (c.kind) {
    case 'id':
      return l.id < c.lt;
    case 'sym':
      return c.on === 'left' ? l.sym === c.value : m?.sym === c.value;
    case 'ts':
      return c.on === 'left' ? l.ts > c.gt : !!m && m.ts < c.lt;
    case 'flag':
      return m?.flag === c.value;
    case 'v':
      return !!m && m.v > c.gt;
    case 'nvNull':
      return !m || m.nv === null;
    case 'sum':
      return !!m && l.id + m.v > c.gt;
    case 'or':
      return l.id < c.lt || m?.flag === c.value;
  }
}

/** The JavaScript model: filter each input, match on what the right input kept, then filter above. */
export function model(r: Recipe): unknown[] {
  const s = r.rightInput;

  const usable = rights.filter(x => {
    switch (s.kind) {
      case 'flag':
      case 'prewhere':
        return x.flag === s.value;
      case 'v':
        return x.v > s.gt;
      case 'twice':
        return x.flag === s.value && x.v > s.gt;
      case 'firstRows':
        return x.rid <= s.n;
      default:
        return true;
    }
  });

  const li = r.leftInput;

  const joined: { l: LeftRow; m: RightRow | undefined }[] = [];

  for (const l of lefts) {
    if (li.kind === 'id' && !(l.id < li.lt)) continue;
    if (li.kind === 'twice' && !(l.id > li.gt && l.id < li.lt)) continue;

    const m = closest(
      l.ts,
      usable.filter(x => x.sym === l.sym),
      r.op,
    );

    if (!m && r.join === 'inner') continue;
    if (r.above.every(list => list.every(c => holds(c, l, m)))) joined.push({ l, m });
  }

  const rows = joined.map(({ l, m }) => ({ id: l.id, rid: m?.rid ?? null }));

  switch (r.top.kind) {
    case 'rows':
      return rows;
    case 'limit':
      return rows.sort((a, b) => a.id - b.id).slice(0, r.top.n);

    case 'mapFilter': {
      const value = r.top.value;
      return joined.filter(j => j.m?.flag === value).map(j => ({ id: j.l.id, rid: j.m!.rid }));
    }

    case 'aggregate': {
      // sum over a null-extended column: NULL for the group of unmatched rows, as measured.
      const groups = new Map<number | null, { n: bigint; s: bigint | null }>();

      for (const { m } of joined) {
        const f = m?.flag ?? null;
        const g = groups.get(f) ?? { n: 0n, s: null };
        groups.set(f, { n: g.n + 1n, s: m ? (g.s ?? 0n) + BigInt(m.v) : g.s });
      }

      return [...groups].map(([f, g]) => ({ f, n: g.n, s: g.s }));
    }
  }
}
