import { expectTypeOf } from 'expect-type';
import {
  argMin,
  argMinIf,
  col,
  from,
  max,
  maxIf,
  min,
  minIf,
  quantile,
  quantileExact,
  quantileExactIf,
  scalar,
  table,
  unionAll,
  val,
  type Decimal,
  type Infer,
} from '@typedhouse/core';

const metrics = table(
  'metrics',
  {
    entityId: col.String,
    version: col.UInt64,
    stock: col.UInt32,
    wide: col.UInt64,
    huge: col.Int128,
    ratio: col.Float32,
    lead: col.Nullable(col.Float64),
    bigLead: col.Nullable(col.UInt64),
    enabled: col.Bool,
    maybe: col.Nullable(col.Bool),
    label: col.Nullable(col.String),
    lc: col.LowCardinality(col.String),
    day: col.Date,
    price: col.Decimal64(2),
    tags: col.Array(col.String),
    date32: col.Date32,
    at: col.DateTime(),
    atUtc: col.DateTime('UTC'),
    ms: col.DateTime64(3),
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);

const source = from(metrics);

const lows = source
  .groupBy(r => r.entityId)
  .aggregate(g => {
    const direct = min(g.stock);
    expectTypeOf(direct.name).toEqualTypeOf<'stock'>();
    expectTypeOf(direct.ir.type).toEqualTypeOf(max(g.stock).ir.type);
    expectTypeOf(minIf(val(1), g.enabled).name).toEqualTypeOf<'enabled'>();
    expectTypeOf(min(val(1)).name).toEqualTypeOf<'min'>();
    expectTypeOf(minIf(val(1), g.enabled).name).toEqualTypeOf(maxIf(val(1), g.enabled).name);

    return {
      stock: direct,
      wide: min(g.wide),
      lead: min(g.lead),
      label: min(g.label),
      lc: min(g.lc),
      day: min(g.day),
      price: min(g.price),
      tags: min(g.tags),
      conditional: minIf(g.stock, g.enabled),
      nullablePredicate: minIf(g.label, g.maybe),
    };
  });

expectTypeOf<Infer<typeof lows>>().toEqualTypeOf<{
  entityId: string;
  stock: number;
  wide: bigint;
  lead: number | null;
  label: string | null;
  lc: string;
  day: Date;
  price: Decimal<18, 2>;
  tags: string[];
  conditional: number;
  nullablePredicate: string | null;
}>();

expectTypeOf<Infer<typeof lows>>().not.toBeAny();

const earliest = source
  .groupBy(r => r.entityId)
  .aggregate(g => {
    const selected = argMin(g.stock, g.version);
    expectTypeOf(selected.name).toEqualTypeOf<'stock'>();
    expectTypeOf(selected.ir.type).toEqualTypeOf(g.stock.ir.type);
    const constant = argMinIf(val('fixed', col.String), g.version, g.enabled);
    expectTypeOf(constant.name).toEqualTypeOf<'argMin'>();

    return {
      stock: selected,
      lead: argMinIf(g.lead, g.version, g.enabled),
      label: argMin(g.label, g.version),
      enabled: argMin(g.enabled, g.version),
      wide: argMin(g.wide, g.version),
      byNullablePredicate: argMinIf(g.stock, g.version, g.maybe),
    };
  });

expectTypeOf<Infer<typeof earliest>>().toEqualTypeOf<{
  entityId: string;
  stock: number;
  lead: number | null;
  label: string | null;
  enabled: boolean;
  wide: bigint;
  byNullablePredicate: number;
}>();

expectTypeOf<Infer<typeof earliest>>().not.toBeAny();

const earliestByDate = source
  .groupBy(r => r.entityId)
  .aggregate(g => ({
    date: argMin(g.ratio, g.day),
    date32: argMin(g.ratio, g.date32),
    at: argMin(g.ratio, g.at),
    atUtc: argMin(g.ratio, g.atUtc),
    ms: argMin(g.ratio, g.ms),
    conditional: argMinIf(g.label, g.day, g.enabled),
  }));

expectTypeOf<Infer<typeof earliestByDate>>().toEqualTypeOf<{
  entityId: string;
  date: number;
  date32: number;
  at: number;
  atUtc: number;
  ms: number;
  conditional: string | null;
}>();

const exact = source
  .groupBy(r => r.entityId)
  .aggregate(g => {
    const median = quantileExact(0.5)(g.wide);
    expectTypeOf(median.name).toEqualTypeOf<'wide'>();
    expectTypeOf(median.ir.type).toEqualTypeOf(g.wide.ir.type);
    expectTypeOf(quantileExact(0)(val(1)).name).toEqualTypeOf<'quantileExact'>();
    expectTypeOf(quantileExactIf(0)(val(1), g.enabled).name).toEqualTypeOf<'quantileExact'>();
    // The approximate form always widens to number.
    expectTypeOf<Infer<typeof approximate>>().toEqualTypeOf<{ value: number }>();

    return {
      median,
      stock: quantileExact(0.9)(g.stock),
      huge: quantileExact(1)(g.huge),
      ratio: quantileExact(0.5)(g.ratio),
      lead: quantileExact(0.5)(g.lead),
      bigLead: quantileExact(0.5)(g.bigLead),
      conditional: quantileExactIf(0.5)(g.bigLead, g.enabled),
      nullablePredicate: quantileExactIf(0.5)(g.wide, g.maybe),
    };
  });

const approximate = source.aggregate(g => ({ value: quantile(0.5)(g.wide) }));

expectTypeOf<Infer<typeof exact>>().toEqualTypeOf<{
  entityId: string;
  median: bigint;
  stock: number;
  huge: bigint;
  ratio: number;
  lead: number | null;
  bigLead: bigint | null;
  conditional: bigint | null;
  nullablePredicate: bigint;
}>();

expectTypeOf<Infer<typeof exact>>().not.toBeAny();

// Results keep composing: over a union, and as a scalar subquery.
const regrouped = unionAll(exact, exact).aggregate(g => ({
  low: min(g.median),
  earliest: argMin(g.lead, g.stock),
  median: quantileExactIf(0.25)(g.conditional, g.conditional.gt(0n)),
}));

expectTypeOf<Infer<typeof regrouped>>().toEqualTypeOf<{
  low: bigint;
  earliest: number | null;
  median: bigint | null;
}>();

const asScalar = source.map(() => scalar(source.aggregate(g => quantileExact(0.5)(g.wide))));
expectTypeOf<Infer<typeof asScalar>>().toEqualTypeOf<{ wide: bigint | null }>();
