WITH `t0` AS (SELECT `tenantId`, `entityId`, `version`, `market_unit_price_1k_p50` FROM `metric_group_off_the_shelf_part_market_price` FINAL WHERE `tenantId` = {p0:String})
SELECT `c`.`entityId` AS `component`, `p`.`mpn` AS `mpn`, `m`.`market_unit_price_1k_p50` AS `price1k`
FROM (SELECT `tenantId`, `entityId`, `partId` FROM `entity_ots_component` ARRAY JOIN `matched_part_ids` AS `partId` WHERE `tenantId` = {p1:String}) AS `c`
INNER ALL JOIN (SELECT `tenantId`, `entityId`, `mpn` FROM `entity_off_the_shelf_part`) AS `p` ON `c`.`tenantId` = `p`.`tenantId` AND `c`.`partId` = `p`.`entityId`
INNER ALL JOIN (SELECT `m`.`entityId` AS `entityId`, `m`.`market_unit_price_1k_p50` AS `market_unit_price_1k_p50` FROM `t0` AS `m` INNER ALL JOIN (SELECT `tenantId`, `entityId`, max(`version`) AS `version` FROM `t0` GROUP BY `tenantId`, `entityId`) AS `v` ON `m`.`tenantId` = `v`.`tenantId` AND `m`.`entityId` = `v`.`entityId` AND `m`.`version` = `v`.`version`) AS `m` ON `p`.`entityId` = `m`.`entityId`
