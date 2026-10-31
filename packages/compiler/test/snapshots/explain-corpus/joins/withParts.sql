SELECT `c`.`entityId` AS `component`, `p`.`mpn` AS `mpn`, `p`.`manufacturerName` AS `manufacturer`, `p`.`lifecycleStatus` AS `lifecycle`
FROM (SELECT `tenantId`, `entityId`, `partId` FROM `entity_ots_component` ARRAY JOIN `matched_part_ids` AS `partId` WHERE `tenantId` = {p0:String}) AS `c`
INNER ALL JOIN (SELECT `tenantId`, `entityId`, `manufacturerName`, `mpn`, `lifecycleStatus` FROM `entity_off_the_shelf_part`) AS `p` ON `c`.`tenantId` = `p`.`tenantId` AND `c`.`partId` = `p`.`entityId`
