import fc from 'fast-check';
import {
  avgState,
  col,
  countMerge,
  countState,
  from,
  join,
  leftJoin,
  maxMerge,
  maxState,
  quantileExactMerge,
  quantileExactState,
  sum,
  sumMerge,
  sumState,
  table,
  uniqExactMerge,
  uniqExactState,
  unionAll,
} from '@typedhouse/core';

/** D3: recipes over an aggregating fixture, with a JavaScript model of every step. */
export const seed = 20261106;

const rollupMeta = {
  engine: 'AggregatingMergeTree',
  sortingKey: ['tenant', 'seq'],
  partitionKey: [],
} as const;

const states = {
  s_sum: col.AggregateFunction('sum', col.UInt32),
  s_cnt: col.AggregateFunction('count'),
  s_max: col.AggregateFunction('max', col.Nullable(col.UInt32)),
  s_uniq: col.AggregateFunction('uniqExact', col.String),
  s_q: col.AggregateFunction('quantileExact(0.5)', col.UInt32),
  s_unread: col.AggregateFunction('avg', col.Float64),
};

const columns = {
  tenant: col.String,
  seq: col.UInt32,
  cat: col.String,
  tags: col.Array(col.String),
  ...states,
};

/** Each (tenant, seq) once, so a total order exists. */
export const unique = table('fx_unique', columns, rollupMeta);

/** Keys repeat across parts, the normal rollup case. */
export const repeated = table('fx_repeated', columns, rollupMeta);

export const late = table(
  'fx_late',
  {
    tenant: col.String,
    seq: col.UInt32,
    cat: col.String,
    tags: col.Array(col.String),
    v: col.UInt32,
    maybe: col.Nullable(col.UInt32),
    w: col.String,
    f: col.Float64,
  },
  { engine: 'MergeTree', sortingKey: ['tenant', 'seq'], partitionKey: [] },
);

export const dim = table(
  'fx_dim',
  { tenant: col.String, title: col.String },
  { engine: 'MergeTree', sortingKey: ['tenant'], partitionKey: [] },
);

export const ROLLUP_COLUMNS = `tenant String, seq UInt32, cat String, tags Array(String),
  s_sum AggregateFunction(sum, UInt32), s_cnt AggregateFunction(count), s_max AggregateFunction(max, Nullable(UInt32)),
  s_uniq AggregateFunction(uniqExact, String), s_q AggregateFunction(quantileExact(0.5), UInt32), s_unread AggregateFunction(avg, Float64)`;

export const STATE_SELECT = `sumState(v) AS s_sum, countState() AS s_cnt, maxState(maybe) AS s_max,
  uniqExactState(w) AS s_uniq, quantileExactState(0.5)(v) AS s_q, avgState(f) AS s_unread`;

export const tenants = ['t0', 't1', 't2', 't3'];

export interface Value {
  v: number;
  maybe: number | null;
  w: string;
  f: number;
}

export interface Row {
  tenant: string;
  seq: number;
  cat: string;
  tags: string[];
  values: Value[];
}

const value = (i: number): Value => ({
  v: (i * 37) % 101,
  maybe: i % 3 === 0 ? null : i * 5,
  w: `w${i % 6}`,
  f: i / 2,
});

const attributes = (tenant: number, seq: number) => ({
  tenant: tenants[tenant]!,
  seq,
  cat: seq % 2 ? 'x' : 'y',
  tags: seq % 4 === 0 ? [] : seq % 4 === 1 ? ['a'] : ['a', 'b'],
});

/** Parts: each inner array is one INSERT. t3 has no rollup row, only a dimension row. */
export const uniqueParts: Row[][] = [0, 1, 2, 3].map(part =>
  Array.from({ length: 6 }, (_, i) => ({
    ...attributes(i % 3, part * 10 + i),
    values: Array.from({ length: 1 + (i % 3) }, (_, j) => value(part * 100 + i * 10 + j)),
  })),
);

export const repeatedParts: Row[][] = [0, 1, 2, 3].map(part =>
  Array.from({ length: 6 }, (_, i) => ({
    ...attributes(i % 3, i),
    values: Array.from({ length: 1 + ((i + part) % 3) }, (_, j) =>
      value(1000 + part * 100 + i * 10 + j),
    ),
  })),
);

export const lateRows: (Omit<Row, 'values'> & Value)[] = Array.from({ length: 8 }, (_, i) => ({
  ...attributes(i % 4, 100 + i),
  ...value(5000 + i),
}));

export const dimRows = [
  { tenant: 't0', title: 'zero' },
  { tenant: 't1', title: 'one' },
  { tenant: 't3', title: 'three' },
];

type SourceKind = 'rollup' | 'final' | 'prewhere' | 'cte' | 'selfUnion' | 'fresh' | 'sharedJoin';

type Op =
  | { op: 'whereTenant'; tenant: string }
  | { op: 'whereSeq'; seq: number }
  | { op: 'whereCat'; cat: string }
  | { op: 'rename' }
  | { op: 'mapPlain' }
  | { op: 'arrayJoin' }
  | { op: 'limit'; n: number; offset: number }
  | { op: 'limitBy'; n: number }
  | { op: 'cte' };

type Tail = 'none' | 'dimJoin' | 'dimLeft';

type Final =
  'total' | 'byTenant' | 'having' | 'sortedLimit' | 'count' | 'keys' | 'twoLevel' | 'partial';

export interface Recipe {
  repeated: boolean;
  source: SourceKind;
  ops: Op[];
  tail: Tail;
  final: Final;
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('whereTenant' as const), tenant: fc.constantFrom(...tenants) }),
  fc.record({ op: fc.constant('whereSeq' as const), seq: fc.integer({ min: 0, max: 35 }) }),
  fc.record({ op: fc.constant('whereCat' as const), cat: fc.constantFrom('x', 'y') }),
  fc.record({ op: fc.constant('rename' as const) }),
  fc.record({ op: fc.constant('mapPlain' as const) }),
  fc.record({ op: fc.constant('arrayJoin' as const) }),
  fc.record({
    op: fc.constant('limit' as const),
    n: fc.integer({ min: 0, max: 12 }),
    offset: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({ op: fc.constant('limitBy' as const), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ op: fc.constant('cte' as const) }),
);

export const recipes: fc.Arbitrary<Recipe> = fc.record({
  repeated: fc.boolean(),
  source: fc.constantFrom<SourceKind>(
    'rollup',
    'final',
    'prewhere',
    'cte',
    'selfUnion',
    'fresh',
    'sharedJoin',
  ),
  ops: fc.array(opArb, { maxLength: 4 }),
  tail: fc.constantFrom<Tail>('none', 'dimJoin', 'dimLeft'),
  final: fc.constantFrom<Final>(
    'total',
    'byTenant',
    'having',
    'sortedLimit',
    'count',
    'keys',
    'twoLevel',
    'partial',
  ),
});

/** Limits need a total order: only the unique table, before anything that duplicates rows. */
export function normalize(r: Recipe): Recipe {
  let ops = r.ops;

  if (r.repeated || r.source === 'selfUnion' || r.source === 'fresh' || r.source === 'sharedJoin')
    ops = ops.filter(o => o.op !== 'limit' && o.op !== 'limitBy');
  else {
    const firstArrayJoin = ops.findIndex(o => o.op === 'arrayJoin');

    if (firstArrayJoin >= 0)
      ops = ops.filter((o, i) => i < firstArrayJoin || (o.op !== 'limit' && o.op !== 'limitBy'));
  }

  return { ...r, ops };
}

const mergeAll = (g: any, names: Names) => ({
  sum: sumMerge(g[names.sum]),
  cnt: countMerge(g.s_cnt),
  max: maxMerge(g.s_max),
  uniq: uniqExactMerge(g.s_uniq),
  q: quantileExactMerge(0.5)(g.s_q),
});

interface Names {
  sum: string;
}

export function build(recipe: Recipe): any {
  const r = normalize(recipe);
  const base = (r.repeated ? from(repeated) : from(unique)) as any;
  let q: any;

  switch (r.source) {
    case 'rollup':
      q = base;
      break;
    case 'final':
      q = base.final();
      break;
    case 'prewhere':
      q = base.prewhere((x: any) => x.seq.ge(2));
      break;
    case 'cte':
      q = base.cte();
      break;

    case 'selfUnion': {
      const shared = base.cte();
      q = unionAll(shared, shared);
      break;
    }

    case 'fresh': {
      const fresh = (from(late) as any)
        .groupBy((x: any) => ({ tenant: x.tenant, seq: x.seq, cat: x.cat, tags: x.tags }))
        .aggregate((g: any) => ({
          s_sum: sumState(g.v),
          s_cnt: countState(),
          s_max: maxState(g.maybe),
          s_uniq: uniqExactState(g.w),
          s_q: quantileExactState(0.5)(g.v),
          s_unread: avgState(g.f),
        }));

      q = unionAll(base, fresh);
      break;
    }

    case 'sharedJoin': {
      const shared = base.final().cte();

      q = (join({ a: shared, b: shared }) as any)
        .on((x: any) => [x.a.tenant.eq(x.b.tenant), x.a.seq.eq(x.b.seq)])
        .map((x: any) => ({
          tenant: x.a.tenant,
          seq: x.a.seq,
          cat: x.a.cat,
          tags: x.a.tags,
          s_sum: x.b.s_sum,
          s_cnt: x.a.s_cnt,
          s_max: x.b.s_max,
          s_uniq: x.a.s_uniq,
          s_q: x.b.s_q,
          s_unread: x.b.s_unread,
        }));

      break;
    }
  }

  const names: Names = { sum: 's_sum' };
  let tag = 0;

  for (const o of r.ops)
    switch (o.op) {
      case 'whereTenant':
        q = q.where((x: any) => x.tenant.eq(o.tenant));
        break;
      case 'whereSeq':
        q = q.where((x: any) => x.seq.ge(o.seq));
        break;
      case 'whereCat':
        q = q.where((x: any) => x.cat.eq(o.cat));
        break;

      case 'rename': {
        const next = `s_sum_${tag++}`;
        const from_ = names.sum;

        q = q.map((x: any) => ({
          tenant: x.tenant,
          seq: x.seq,
          cat: x.cat,
          tags: x.tags,
          [next]: x[from_],
          s_cnt: x.s_cnt,
          s_max: x.s_max,
          s_uniq: x.s_uniq,
          s_q: x.s_q,
          s_unread: x.s_unread,
        }));

        names.sum = next;
        break;
      }

      case 'mapPlain': {
        const current = names.sum;

        q = q.map((x: any) => ({
          tenant: x.tenant,
          seq: x.seq,
          note: x.tenant.length(),
          cat: x.cat,
          tags: x.tags,
          [current]: x[current],
          s_cnt: x.s_cnt,
          s_max: x.s_max,
          s_uniq: x.s_uniq,
          s_q: x.s_q,
          s_unread: x.s_unread,
        }));

        break;
      }

      case 'arrayJoin':
        // The flattened tag replaces nothing the later steps read.
        q = q.arrayJoin((x: any) => x.tags, `tag${tag++}`);
        break;
      case 'limit':
        q = q
          .orderBy((x: any) => x.tenant)
          .thenBy((x: any) => x.seq)
          .limit(o.n, o.offset);

        break;
      case 'limitBy':
        q = q
          .orderBy((x: any) => x.tenant)
          .thenBy((x: any) => x.seq)
          .limitBy((x: any) => x.tenant)
          .take(o.n);

        break;
      case 'cte':
        q = q.cte();
        break;
    }

  const carried = (x: any, side: any) => ({
    tenant: x,
    [names.sum]: side[names.sum],
    s_cnt: side.s_cnt,
    s_max: side.s_max,
    s_uniq: side.s_uniq,
    s_q: side.s_q,
  });

  if (r.tail === 'dimJoin')
    q = (join({ d: from(dim), a: q }) as any)
      .on((x: any) => x.d.tenant.eq(x.a.tenant))
      .map((x: any) => carried(x.d.tenant, x.a));
  else if (r.tail === 'dimLeft')
    q = (leftJoin({ d: from(dim) }, { a: q }) as any)
      .on((x: any) => x.d.tenant.eq(x.a.tenant))
      .map((x: any) => carried(x.d.tenant, x.a));

  switch (r.final) {
    case 'total':
      return q.aggregate((g: any) => mergeAll(g, names));
    case 'byTenant':
      return q.groupBy((x: any) => x.tenant).aggregate((g: any) => mergeAll(g, names));
    case 'having':
      return q
        .groupBy((x: any) => x.tenant)
        .aggregate((g: any) => mergeAll(g, names))
        .where((x: any) => x.sum.gt(50n).and(x.tenant.ne('t2')));
    case 'sortedLimit':
      return q
        .groupBy((x: any) => x.tenant)
        .aggregate((g: any) => mergeAll(g, names))
        .orderBy((x: any) => x.tenant)
        .limit(2);
    case 'count':
      return q.count();
    case 'keys':
      return q.map((x: any) => ({ tenant: x.tenant })).distinct();
    case 'twoLevel':
      return q
        .groupBy((x: any) => x.tenant)
        .aggregate((g: any) => ({ [names.sum]: sumMerge(g[names.sum]) }))
        .aggregate((g: any) => ({ all: sum(g[names.sum]) }));
    case 'partial':
      // A sibling state is built but never read.
      return q
        .groupBy((x: any) => x.tenant)
        .aggregate((g: any) => ({ a: sumMerge(g[names.sum]), unused: countMerge(g.s_cnt) }))
        .map((x: any) => ({ tenant: x.tenant, a: x.a }));
  }
}

const finalized = (rows: readonly Row[]) => {
  const values = rows.flatMap(r => r.values);
  const present = values.flatMap(v => (v.maybe === null ? [] : [v.maybe]));
  const sorted = values.map(v => v.v).sort((a, b) => a - b);

  return {
    sum: BigInt(values.reduce((a, v) => a + v.v, 0)),
    cnt: BigInt(rows.reduce((a, r) => a + r.values.length, 0)),
    max: present.length ? Math.max(...present) : null,
    uniq: BigInt(new Set(values.map(v => v.w)).size),
    q: sorted.length ? sorted[Math.floor(0.5 * sorted.length)]! : 0,
  };
};

const collapse = (rows: readonly Row[]): Row[] => {
  const keyed = new Map<string, Row>();

  for (const r of rows) {
    const key = `${r.tenant}|${r.seq}`;
    const seen = keyed.get(key);
    keyed.set(key, seen ? { ...seen, values: [...seen.values, ...r.values] } : r);
  }

  return [...keyed.values()];
};

const compareKey = (a: Row, b: Row) => a.tenant.localeCompare(b.tenant) || a.seq - b.seq;

/** The model: the same recipe over JavaScript rows. */
export function oracle(recipe: Recipe): unknown[] {
  const r = normalize(recipe);
  const base = (r.repeated ? repeatedParts : uniqueParts).flat();
  let rows: Row[];

  switch (r.source) {
    case 'rollup':
    case 'cte':
      rows = base;
      break;
    case 'final':
      rows = collapse(base);
      break;
    case 'prewhere':
      rows = base.filter(x => x.seq >= 2);
      break;
    case 'selfUnion':
      rows = [...base, ...base];
      break;

    case 'fresh': {
      const fresh = lateRows.map(({ v, maybe, w, f, ...rest }) => ({
        ...rest,
        values: [{ v, maybe, w, f }],
      }));

      rows = [...base, ...fresh];
      break;
    }

    case 'sharedJoin': {
      // Self-join on the collapsed key: state columns are read from either side, and FINAL gives one row per key.
      rows = collapse(base);
      break;
    }
  }

  for (const o of r.ops)
    switch (o.op) {
      case 'whereTenant':
        rows = rows.filter(x => x.tenant === o.tenant);
        break;
      case 'whereSeq':
        rows = rows.filter(x => x.seq >= o.seq);
        break;
      case 'whereCat':
        rows = rows.filter(x => x.cat === o.cat);
        break;
      case 'arrayJoin':
        rows = rows.flatMap(x => x.tags.map(() => x));
        break;
      case 'limit':
        rows = [...rows].sort(compareKey).slice(o.offset, o.offset + o.n);
        break;

      case 'limitBy': {
        const seen = new Map<string, number>();

        rows = [...rows].sort(compareKey).filter(x => {
          const n = seen.get(x.tenant) ?? 0;
          seen.set(x.tenant, n + 1);
          return n < o.n;
        });

        break;
      }

      case 'rename':
      case 'mapPlain':
      case 'cte':
        break;
    }

  if (r.tail === 'dimJoin') rows = dimRows.flatMap(d => rows.filter(x => x.tenant === d.tenant));
  else if (r.tail === 'dimLeft')
    rows = dimRows.flatMap(d => {
      const matched = rows.filter(x => x.tenant === d.tenant);

      // An unmatched row keeps the default state: it counts as a row, and finalizes as empty.
      return matched.length
        ? matched
        : [{ tenant: d.tenant, seq: 0, cat: '', tags: [], values: [] }];
    });

  const groups = () => {
    const grouped = new Map<string, Row[]>();
    for (const x of rows) grouped.set(x.tenant, [...(grouped.get(x.tenant) ?? []), x]);
    return [...grouped].sort(([a], [b]) => a.localeCompare(b));
  };

  switch (r.final) {
    case 'total':
      return [finalized(rows)];
    case 'byTenant':
      return groups().map(([tenant, xs]) => ({ tenant, ...finalized(xs) }));
    case 'having':
      return groups()
        .map(([tenant, xs]) => ({ tenant, ...finalized(xs) }))
        .filter(x => x.sum > 50n && x.tenant !== 't2');
    case 'sortedLimit':
      return groups()
        .slice(0, 2)
        .map(([tenant, xs]) => ({ tenant, ...finalized(xs) }));
    case 'count':
      return [{ count: BigInt(rows.length) }];
    case 'keys':
      return groups().map(([tenant]) => ({ tenant }));
    case 'twoLevel':
      return [{ all: groups().reduce((a, [, xs]) => a + finalized(xs).sum, 0n) }];
    case 'partial':
      return groups().map(([tenant, xs]) => ({ tenant, a: finalized(xs).sum }));
  }
}
