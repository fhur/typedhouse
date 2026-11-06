SELECT `a`.`entityId` AS `entityId`
FROM (SELECT `entityId`, `updatedAt` FROM `entity_ots_component`) AS `a`
ASOF INNER JOIN (SELECT `entityId`, `state`, `updatedAt` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId` AND `a`.`updatedAt` >= `b`.`updatedAt`
WHERE (`b`.`state` = {p0:String})
