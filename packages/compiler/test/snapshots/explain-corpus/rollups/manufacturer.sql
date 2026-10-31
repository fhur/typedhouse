WITH `t0` AS (SELECT `tenantId`, `entityId`, `version`, `stock_index` FROM `metric_group_off_the_shelf_part_indices` FINAL WHERE `tenantId` = {p0:String})
SELECT `p`.`manufacturerId` AS `manufacturerId`, `p`.`manufacturerName` AS `manufacturerName`, count() AS `parts`, sum(`i`.`stock_index`) AS `stockIndex`, countIf(in(`p`.`lifecycleStatus`, {p1:Array(String)})) AS `eol`
FROM (SELECT `entityId`, `manufacturerId`, `manufacturerName`, `lifecycleStatus` FROM `entity_off_the_shelf_part` WHERE `tenantId` = {p2:String}) AS `p`
INNER ALL JOIN (SELECT `m`.`entityId` AS `entityId`, `m`.`stock_index` AS `stock_index` FROM `t0` AS `m` INNER ALL JOIN (SELECT `tenantId`, `entityId`, max(`version`) AS `version` FROM `t0` GROUP BY `tenantId`, `entityId`) AS `v` ON `m`.`tenantId` = `v`.`tenantId` AND `m`.`entityId` = `v`.`entityId` AND `m`.`version` = `v`.`version`) AS `i` ON `p`.`entityId` = `i`.`entityId`
GROUP BY `p`.`manufacturerId`, `p`.`manufacturerName`
HAVING `parts` >= {p3:UInt64}
ORDER BY `stockIndex` DESC
