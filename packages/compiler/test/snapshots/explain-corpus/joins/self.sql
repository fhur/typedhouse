WITH `t0` AS (SELECT `entityId`, `partId` FROM `entity_ots_component` ARRAY JOIN `matched_part_ids` AS `partId` WHERE `tenantId` = {p0:String})
SELECT `a_`.`entityId` AS `a`, `b_`.`entityId` AS `b`, `a_`.`partId` AS `partId`
FROM `t0` AS `a_`
INNER ALL JOIN `t0` AS `b_` ON `a_`.`partId` = `b_`.`partId`
WHERE (`a_`.`entityId` < `b_`.`entityId`)
