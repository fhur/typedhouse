CREATE TABLE entity_ots_component (
 tenantId String, entityId String, category Nullable(String), state String,
 part_specifications Array(Tuple(id String, mpn Nullable(String), manufacturer Nullable(String), description Nullable(String), package Nullable(String), part_type Nullable(String))),
 matched_part_ids Array(String), countOfParts UInt64, updatedAt DateTime64(3)
) ENGINE = MergeTree ORDER BY (tenantId, entityId);
CREATE TABLE entity_off_the_shelf_part (
 tenantId String, entityId String, manufacturerId String, manufacturerName String, mpn String,
 partCategoryId Nullable(Int64), partCategoryName Nullable(String), partCategoryPath Array(Int64),
 lifecycleStatus Nullable(String), lifecycleYteol Nullable(Float64), countryOfOrigin Array(String), ipns Array(String), supplier_ids Array(String), updatedAt DateTime64(3)
) ENGINE = MergeTree ORDER BY (tenantId, entityId);
CREATE TABLE metric_group_ots_component_market_availability (
 tenantId String, entityId String, version UInt32, effectiveAt DateTime64(3), insertedAt DateTime64(3),
 market_stock_total Float64, market_stock_total_warnings Array(String), market_stock_p50 Float64, market_stock_p50_warnings Array(String),
 market_lead_time_p50_days Float64, market_lead_time_p50_days_warnings Array(String)
) ENGINE = ReplacingMergeTree(insertedAt) ORDER BY (tenantId, entityId, version, effectiveAt);
CREATE TABLE metric_group_ots_component_indices (
 tenantId String, entityId String, version UInt32, effectiveAt DateTime64(3), insertedAt DateTime64(3),
 price_change_log_sum Float64, price_change_count Float64, stock_index Float64, stock_index_warnings Array(String),
 lead_time_index_part_days Float64, lead_time_index_part_count Float64, lead_time_max_days Nullable(Float64)
) ENGINE = ReplacingMergeTree(insertedAt) ORDER BY (tenantId, entityId, version, effectiveAt);
CREATE TABLE metric_group_off_the_shelf_part_indices (
 tenantId String, entityId String, version UInt32, effectiveAt DateTime64(3), insertedAt DateTime64(3),
 price_change_log_sum Float64, price_change_count Float64, stock_index Float64, lead_time_index_days Float64, lead_time_index_count Float64
) ENGINE = ReplacingMergeTree(insertedAt) ORDER BY (tenantId, entityId, version, effectiveAt);
CREATE TABLE metric_group_off_the_shelf_part_market_price (
 tenantId String, entityId String, version UInt32, effectiveAt DateTime64(3), insertedAt DateTime64(3),
 market_unit_price_1k_p50 Float64, market_unit_price_1k_p50_warnings Array(String)
) ENGINE = ReplacingMergeTree(insertedAt) ORDER BY (tenantId, entityId, version, effectiveAt);
CREATE TABLE coverage (
 id UInt32, `__proto__` String, `odd-name` String COMMENT 'line\n*/ hostile', precise DateTime64(9, 'UTC'),
 nested Nested(label String, amount UInt64), amount Decimal64(4), status Enum8('a' = 1, 'b' = 2),
 tags Map(String, UInt64), pair Tuple(String, UInt8),
 alias_id UInt32 ALIAS id, default_id UInt32 DEFAULT id, materialized_id UInt32 MATERIALIZED id,
 at DateTime
) ENGINE = MergeTree PARTITION BY toYYYYMM(at) PRIMARY KEY (id) ORDER BY (id, cityHash64(`odd-name`, `__proto__`));
CREATE VIEW coverage_view AS SELECT id, `odd-name` FROM coverage;
CREATE TABLE coverage_mv_target (id UInt32) ENGINE = Memory;
CREATE MATERIALIZED VIEW coverage_mv TO coverage_mv_target AS SELECT id FROM coverage;
