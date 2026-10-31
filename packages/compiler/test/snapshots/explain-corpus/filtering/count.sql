SELECT `tenantId`, `entityId`, `category`, `state`, `part_specifications`, `matched_part_ids`, `countOfParts`, `updatedAt` FROM `entity_ots_component` WHERE `countOfParts` > {p0:UInt64}
