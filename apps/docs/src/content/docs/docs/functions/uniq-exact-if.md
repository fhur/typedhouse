---
title: uniqExactIf
description: Count distinct non-null strings exactly among qualifying rows.
sidebar:
  order: 64
---

`uniqExactIf(value, predicate)` counts distinct non-NULL strings exactly, considering only rows whose Bool predicate is true. False and NULL predicates exclude rows. The result is non-null `UInt64` (`bigint`), with `0n` when no qualifying non-NULL values remain.

The current typed surface accepts only `String` or `Nullable(String)` values and `Bool` or `Nullable(Bool)` predicates, not LowCardinality wrappers or numeric distinct-count operands. Memory usage grows with distinct cardinality. Distinct `State`/`Merge` execution is not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table, uniqExactIf } from '@chql/core';
import { compile } from '@chql/compiler';

const visits = table(
  'visits',
  {
    campaign: col.String,
    visitor: col.Nullable(col.String),
    converted: col.Bool,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(visits)
  .groupBy((row) => row.campaign)
  .aggregate((group) => ({
    convertedVisitors: uniqExactIf(
      group.visitor,
      group.converted,
    ),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`campaign` AS `campaign`,
  uniqExactIf (
    `__chql_input`.`visitor`,
    `__chql_input`.`converted`
  ) AS `convertedVisitors`
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
