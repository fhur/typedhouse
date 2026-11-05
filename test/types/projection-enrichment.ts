import { expectTypeOf } from 'expect-type';
import {
  col,
  columnExpr,
  dateDiff,
  from,
  multiIf,
  now,
  table,
  val,
  type DescribedExpr,
  type Infer,
  type NodeId,
} from '@typedhouse/core';
import { projectionEnrichment } from '../../packages/compiler/test/fixtures/corpus/projection-enrichment.js';
import type { ComponentRow } from '../../packages/compiler/test/fixtures/corpus/low-stock.js';

type Expected = Omit<ComponentRow, 'category'> & {
  category: string;
  matched: bigint;
  mpns: (string | null)[];
  firstDesc: string | null;
  age: bigint;
  tier: string;
  source: string;
};

expectTypeOf<Infer<typeof projectionEnrichment>>().toEqualTypeOf<{
  [K in keyof Expected]: Expected[K];
}>();

expectTypeOf<Infer<typeof projectionEnrichment>>().not.toBeAny();

expectTypeOf(now()).toEqualTypeOf<
  DescribedExpr<Date, 'now', 'row', { readonly kind: 'DateTime' }>
>();

const q = from(
  table(
    'p',
    {
      d: col.Date,
      dt: col.DateTime(),
      p: col.DateTime64(3),
      ok: col.Nullable(col.Bool),
      label: col.String,
    },
    { engine: 'Memory', sortingKey: [], partitionKey: [] },
  ),
);

expectTypeOf(dateDiff('day', q.row.d, now())).toEqualTypeOf<
  DescribedExpr<bigint, 'd', 'row', { readonly kind: 'scalar'; readonly name: 'Int64' }>
>();

expectTypeOf(multiIf([q.row.ok, q.row.label], 'fallback')).toEqualTypeOf<
  DescribedExpr<string, 'ok', 'row', { readonly kind: 'scalar'; readonly name: 'String' }>
>();

const pairs = [[q.row.ok, 'yes'], [q.row.ok, val('x', col.String)], 'no'] as const;

expectTypeOf(multiIf(...pairs)).toEqualTypeOf<
  DescribedExpr<string, 'ok', 'row', { readonly kind: 'scalar'; readonly name: 'String' }>
>();

const grouped = columnExpr(col.Bool, 1 as NodeId, ['ok'], 'ok', 'grouped');
expectTypeOf(multiIf([grouped, val('x', col.String)], 'no').mode).toEqualTypeOf<'grouped'>();

expectTypeOf(
  multiIf([val(true, col.Bool), 'constant'], [grouped, 'grouped'], 'no').mode,
).toEqualTypeOf<'grouped'>();

// DateTime columns take JS Date parameters (sent as UTC seconds), not date strings.
q.where(r => r.dt.ge(new Date('2026-11-01T00:00:00Z')));
// @ts-expect-error a date string is not a DateTime parameter
q.where(r => r.dt.ge('2026-11-01 00:00:00'));
q.where(r => r.d.ge(new Date('2026-11-01')));
q.where(r => r.p.ge(new Date('2026-11-01T00:00:00.123Z')));
// @ts-expect-error a date string is not a Date parameter
q.where(r => r.d.ge('2026-11-01'));
// @ts-expect-error a date string is not a DateTime64 parameter
q.where(r => r.p.ge('2026-11-01 00:00:00.123'));
