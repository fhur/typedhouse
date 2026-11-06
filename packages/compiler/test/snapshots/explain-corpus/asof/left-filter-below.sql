SELECT `a`.`entityId` AS `entityId`
FROM (SELECT `entityId`, `updatedAt` FROM `entity_ots_component` WHERE `state` = {p0:String}) AS `a`
ASOF INNER JOIN (SELECT `entityId`, `updatedAt` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId` AND `a`.`updatedAt` >= `b`.`updatedAt`
