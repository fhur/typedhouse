SELECT `a`.`entityId` AS `entityId`, `b`.`category` AS `category`
FROM (SELECT `entityId` FROM `entity_ots_component`) AS `a`
INNER ALL JOIN (SELECT `entityId`, `category`, `state` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId`
WHERE (`b`.`state` = {p0:String})
