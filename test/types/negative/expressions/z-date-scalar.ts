import { col, from, table, max, scalar, type Query } from '@chql/core';
const q = from(table('dates', { d32: col.Date32, dt: col.DateTime(), dt64: col.DateTime64(3), precise: col.DateTime64(6), n: col.Nullable(col.Date32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
scalar(q.aggregate(g => max(g.d32))); // expect: TS2345 unsupported_scalar_temporal_descriptor
scalar(q.aggregate(g => max(g.dt))); // expect: TS2345 unsupported_scalar_temporal_descriptor
scalar(q.aggregate(g => max(g.dt64))); // expect: TS2345 unsupported_scalar_temporal_descriptor
scalar(q.aggregate(g => max(g.precise))); // expect: TS2345 unsupported_scalar_temporal_descriptor
scalar(q.aggregate(g => max(g.n))); // expect: TS2345 unsupported_scalar_temporal_descriptor
const mixed = from(table('mixed', { day: Math.random() ? col.Date : col.Date32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
scalar(mixed.aggregate(g => max(g.day))); // expect: TS2345 unsupported_scalar_temporal_descriptor
const mixedPrecise = from(table('mixed_precise', { day: Math.random() ? col.String : col.DateTime64(6) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
scalar(mixedPrecise.aggregate(g => max(g.day))); // expect: TS2345 unsupported_scalar_temporal_descriptor
const mixedNullablePrecise = from(table('mixed_nullable_precise', { day: Math.random() ? col.Nullable(col.String) : col.Nullable(col.DateTime64(6)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
scalar(mixedNullablePrecise.aggregate(g => max(g.day))); // expect: TS2345 unsupported_scalar_temporal_descriptor
declare const erased: Query<{ day: Date }>;
scalar(erased.aggregate(g => max(g.day))); // expect: TS2345 unsupported_scalar_temporal_descriptor
