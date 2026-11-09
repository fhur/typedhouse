SELECT `a`.`entityId` AS `entityId`
FROM (SELECT `entityId`, `updatedAt` FROM `entity_ots_component`) AS `a`
ASOF LEFT JOIN (SELECT `entityId`, `state`, `updatedAt` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId` AND `a`.`updatedAt` >= `b`.`updatedAt`
WHERE (isNull(`b`.`state`)) SETTINGS join_use_nulls = 1 /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */
