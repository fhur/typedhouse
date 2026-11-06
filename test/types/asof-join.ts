import { expectTypeOf } from 'expect-type';
import {
  asofJoin,
  asofLeftJoin,
  col,
  from,
  table,
  type Infer,
  type IsLive,
} from '@typedhouse/core';

const trades = from(
  table(
    'trades',
    { id: col.UInt32, sym: col.String, ts: col.DateTime('UTC'), nts: col.Nullable(col.Date) },
    { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
  ),
);

const quotes = from(
  table(
    'quotes',
    {
      sym: col.String,
      ts: col.DateTime('UTC'),
      bid: col.Float64,
      nts: col.Nullable(col.Date),
      tags: col.Array(col.String),
      lc: col.LowCardinality(col.String),
    },
    { engine: 'MergeTree', sortingKey: ['sym', 'ts'], partitionKey: [] },
  ),
);

const inner = asofJoin({ t: trades }, { q: quotes })
  .on(r => r.t.sym.eq(r.q.sym))
  .asof(r => r.t.ts.ge(r.q.ts));

expectTypeOf<IsLive<typeof inner>>().toEqualTypeOf<false>();
expectTypeOf(inner.caps.live).toEqualTypeOf<false>();

const innerRow = inner.map(r => ({
  id: r.t.id,
  bid: r.q.bid,
  nts: r.q.nts,
  tags: r.q.tags,
}));

expectTypeOf<Infer<typeof innerRow>>().toEqualTypeOf<{
  id: number;
  bid: number;
  nts: Date | null;
  tags: string[];
}>();

// Every comparison, each way round, and an expression with a parameter.
asofJoin({ t: trades }, { q: quotes })
  .on(r => [r.t.sym.eq(r.q.sym), r.t.sym.length().eq(r.q.sym.length())])
  .asof(r => r.q.ts.lt(r.t.ts));

asofJoin(
  { t: trades },
  {
    q: from(
      table(
        'n',
        { sym: col.String, id: col.UInt32 },
        { engine: 'Memory', sortingKey: [], partitionKey: [] },
      ),
    ),
  },
)
  .on(r => r.t.sym.eq(r.q.sym))
  .asof(r => r.t.id.plus(5).gt(r.q.id.plus(1)));

asofJoin({ t: trades }, { q: quotes })
  .on(r => r.t.sym.eq(r.q.sym))
  .asof(r => r.t.ts.le(r.q.ts));

const left = asofLeftJoin({ t: trades }, { q: quotes })
  .on(r => r.t.sym.eq(r.q.sym))
  .asof(r => r.t.nts.ge(r.q.nts));

expectTypeOf<IsLive<typeof left>>().toEqualTypeOf<false>();

const leftRow = left.map(r => ({
  id: r.t.id,
  bid: r.q.bid,
  nts: r.q.nts,
  tags: r.q.tags,
  lc: r.q.lc,
  sym: r.q.sym,
}));

expectTypeOf<Infer<typeof leftRow>>().toEqualTypeOf<{
  id: number;
  bid: number | null;
  nts: Date | null;
  tags: string[];
  lc: string | null;
  sym: string | null;
}>();

// The result is an ordinary join query.
inner
  .where(r => r.t.sym.eq('A'))
  .orderBy(r => r.t.id)
  .limit(1)
  .map(r => r.t.id);
