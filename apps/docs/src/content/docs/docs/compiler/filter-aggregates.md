---
title: Filter grouping keys early
description: Separate grouping-key predicates from aggregate-result predicates.
sidebar:
  order: 5
---

**`PushFilterAggKey`** splits a safe post-aggregation conjunction into grouping-key predicates and residual predicates. Key predicates can eliminate input rows before aggregation; aggregate-result predicates still apply to groups.

## Example

The category condition moves into `WHERE`. The count condition becomes `HAVING` through SELECT-block folding.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(events)
  .groupBy((e) => ({ category: e.category }))
  .aggregate(() => ({ total: count() }))
  .where((e) => e.category.eq('sale').and(e.total.gt(10n)));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`category` AS `category`,
  count() AS `total`
FROM
  `events` AS `__typedhouse_input`
WHERE
  `__typedhouse_input`.`category` = {p0:String}
GROUP BY
  `__typedhouse_input`.`category`
HAVING
  `total` > {p1:UInt64}
```

Parameters:

```json
{
  "p0": "sale",
  "p1": "10"
}
```

<!-- generated-sql:end -->

This requires direct non-null String/Bool/integer keys and a safe aggregate computation. The supported envelope includes `count()`, `max` of supported direct columns, and integer `sum`. Arbitrary aggregate expressions, nullable keys, combinators, and global aggregation without grouping keys do not qualify.
