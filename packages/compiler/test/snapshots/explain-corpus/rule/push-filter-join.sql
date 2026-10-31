SELECT `a`.`entityId` AS `entityId`, `b`.`category` AS `category`
FROM (SELECT `entityId` FROM `entity_ots_component` WHERE `state` = {p0:String}) AS `a`
INNER ALL JOIN (SELECT `entityId`, `category` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId`
