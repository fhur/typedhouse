---
title: limit
description: Bound results with limit and offset, overall or per key with limitBy.
sidebar:
  order: 6
---

`limit(n, offset?)` returns at most `n` rows after skipping the optional offset. Both values must be non-negative safe integers. Invalid values fail compiler validation.

## Example

Skip twenty rows and return the next ten, ordered by ID. A deterministic page requires the ordering keys to uniquely identify rows in your data.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
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
  .orderBy((e) => e.id)
  .limit(10, 20);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`
FROM
  `events`
ORDER BY
  `id` ASC
LIMIT
  10 OFFSET 20
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

An unordered limit does not define which rows you get. Apply sorting before limiting when selecting an ordered page. Limits and offsets are emitted as validated integer literals rather than expression parameters. Offset pagination does not guarantee stable pages while the underlying data changes.

## Limit per key with limitBy

`limitBy(keys).take(n)` returns at most `n` rows for each distinct value of the keys, using ClickHouse `LIMIT n BY keys`. Use it for a question such as "the three latest events of each category". The result is an ordinary query with the same columns.

Sort first, and include a tie breaker. Without a total order, which rows of a group survive is unspecified, and it can change between runs.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
    at: col.DateTime(),
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
  .orderBy((e) => e.at.desc())
  .thenBy((e) => e.id)
  .limitBy((e) => e.category)
  .take(3);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`,
  `at`
FROM
  `events`
ORDER BY
  `at` DESC,
  `id` ASC
LIMIT
  3 BY `category`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

### Offset and several keys

`offset(m)` skips the first `m` rows of each group, so it pages inside every group at once. It is available only directly after `take`. Return an array to group by several keys. A key can be computed, and it does not have to appear in the final result. A later `limit` caps the whole result.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
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
  .orderBy((e) => e.id)
  .limitBy((e) => [e.tenant, e.category])
  .take(10)
  .offset(20)
  .limit(100);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`,
  `category`
FROM
  `events`
ORDER BY
  `id` ASC
LIMIT
  10 OFFSET 20 BY `tenant`, `category`
LIMIT
  100
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

### Rules

- `limitBy(...)` alone is not a query. Finish it with `take(n)` before you call any other operator or compile it.
- `n` and `offset` must be non-negative safe integers, as for `limit`. They are emitted as validated integer literals, and an invalid value throws `invalid_limit` when you call `take` or `offset`.
- Every key must read a column of the row, otherwise `limitBy` throws `invalid_limit_by_key`. ClickHouse reads `LIMIT 1 BY 2` as "the second selected column", and a constant puts every row in one group. A sort key such as `e.at.desc()` is not a key.
- NULL is one group. Float keys group by bit pattern, as ClickHouse does: NaNs with the same bit pattern form one group, and `nan` and `0/0` have different patterns, so they form two. `0.0` and `-0.0` are separate groups.
- Operation order matters. `where` after `limitBy` filters the rows that survived, and `limit` before `limitBy` selects from a capped input. The compiler keeps those in separate SELECT scopes.
