SELECT `tenantId`, `entityId`, `category`, `state`, `part_specifications`, `matched_part_ids`, `countOfParts`, `updatedAt` FROM `entity_ots_component` WHERE has(`matched_part_ids`, {p0:String})
