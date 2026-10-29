---
title: uniqExact
description: Count distinct non-null strings exactly.
sidebar:
  order: 56
---

`uniqExact(value)` counts distinct non-NULL strings exactly. It returns `UInt64` (`bigint`), including `0n` for empty or all-NULL input. Exact counting can use substantially more memory than approximate `uniq` as cardinality grows.

The current typed surface supports only `String` and `Nullable(String)`, not arbitrary ClickHouse distinct-count operands or LowCardinality wrappers. Distinct aggregate `State`/`Merge` execution is not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table, uniqExact } from '@chql/core';
import { compile } from '@chql/compiler';

const visits = table(
  'visits',
  {
    campaign: col.String,
    visitor: col.Nullable(col.String),
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(visits)
  .groupBy((row) => row.campaign)
  .aggregate((group) => ({
    uniqueVisitors: uniqExact(group.visitor),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`campaign` AS `campaign`,
  uniqExact(`__chql_input`.`visitor`) AS `uniqueVisitors`
FROM
  `visits` AS `__chql_input`
GROUP BY
  `__chql_input`.`campaign`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
