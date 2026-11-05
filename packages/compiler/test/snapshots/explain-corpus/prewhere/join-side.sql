SELECT `a`.`entityId` AS `entityId`
FROM (SELECT `entityId` FROM `entity_ots_component` AS `__typedhouse_input` PREWHERE `__typedhouse_input`.`tenantId` = {p0:String}) AS `a`
INNER ALL JOIN (SELECT `entityId` FROM `entity_ots_component`) AS `b` ON `a`.`entityId` = `b`.`entityId`
