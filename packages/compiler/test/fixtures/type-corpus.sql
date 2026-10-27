-- Controlled type-coverage fixture, not production schema. Captured only after live CREATE.
CREATE DATABASE type_corpus;
CREATE TABLE type_corpus.types_1 (
 c01 UInt8, c02 UInt16, c03 UInt32, c04 UInt64, c05 UInt128, c06 UInt256,
 c07 Int8, c08 Int16, c09 Int32, c10 Int64, c11 Int128, c12 Int256,
 c13 Float32, c14 Float64, c15 Bool, c16 String, c17 FixedString(16),
 c18 UUID, c19 IPv4, c20 IPv6, c21 Date, c22 Date32, c23 DateTime,
 c24 DateTime('Europe/Amsterdam'), c25 DateTime64(0), c26 DateTime64(1),
 c27 DateTime64(2), c28 DateTime64(3), c29 DateTime64(4), c30 DateTime64(9, 'UTC'),
 c31 Decimal(9, 2), c32 Decimal(18, 4), c33 Decimal(38, 10), c34 Decimal(76, 20),
 c35 Enum8('a b' = -1, 'comma,(paren)' = 2, 'quote\'slash\\' = 3),
 c36 Enum16('low' = -300, 'high' = 300),
 c37 Nullable(UInt64), c38 LowCardinality(String), c39 LowCardinality(Nullable(String)),
 c40 Array(String), c41 Array(Nullable(Int64)), c42 Array(Array(UInt8)),
 c43 Map(String, UInt64), c44 Map(UInt64, Array(String)), c45 Map(UUID, Nullable(Float64)),
 c46 Tuple(String, UInt64), c47 Tuple(id String, mpn Nullable(String)),
 c48 Array(Tuple(id String, mpn Nullable(String), manufacturer Nullable(String))),
 c49 Tuple(`a.b` String, `with space` UInt8),
 c50 AggregateFunction(sum, UInt64), c51 AggregateFunction(quantiles(0.5, 0.9), Float64),
 c52 SimpleAggregateFunction(sum, UInt64), c53 Nullable(Float64),
 c54 Map(String, Tuple(a UInt8, b Array(String)))
) ENGINE = Memory;
CREATE TABLE type_corpus.types_2 AS type_corpus.types_1 ENGINE = Memory;
CREATE TABLE type_corpus.types_3 AS type_corpus.types_1 ENGINE = Memory;
CREATE TABLE type_corpus.types_4 AS type_corpus.types_1 ENGINE = Memory;
