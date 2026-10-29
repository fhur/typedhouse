---
title: toStartOfWeek
description: Round a supported date expression to the start of its week.
sidebar:
  order: 50
---

`value.toStartOfWeek()` rounds down to the start of the week using ClickHouse's default mode, which starts weeks on Sunday. This API takes no mode or timezone arguments.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    occurredAt: col.DateTime64(3, 'UTC'),
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
const query = from(events).map((event) => ({
  id: event.id,
  week: event.occurredAt.toStartOfWeek(),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  addDays(
    toDate(
      toStartOfWeek(toDate32(`__chql_input`.`occurredAt`), 0)
    ),
    throwIf(
      ifNull(
        (
          toStartOfWeek(toDate32(`__chql_input`.`occurredAt`), 0) < toDate32('1970-01-01')
        )
        OR (
          toStartOfWeek(toDate32(`__chql_input`.`occurredAt`), 0) > toDate32('2149-06-06')
        ),
        0
      ),
      'chql_date_out_of_range'
    )
  ) AS `week`
FROM
  (
    SELECT
      `id`,
      `occurredAt`
    FROM
      `events`
  ) AS `__chql_input`
SETTINGS
  enable_extended_results_for_datetime_functions = 1
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

The typed catalog accepts Date and DateTime64 with precision 0–3, optionally Nullable, and returns a Date expression. NULL propagates. Date32, DateTime, higher-precision DateTime64, and LowCardinality wrappers are not supported by this method even where ClickHouse itself accepts a broader input.
