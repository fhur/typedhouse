---
title: ifNull
description: Replace NULL with a typed fallback.
sidebar:
  order: 29
---

`value.ifNull(fallback)` returns the original value when it is not NULL, otherwise the fallback. The fallback can be a compatible literal or expression.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const users = table(
  'users',
  {
    id: col.UInt32,
    nickname: col.Nullable(col.String),
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
const query = from(users).map((user) => ({
  id: user.id,
  displayName: user.nickname.ifNull('Anonymous'),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  ifNull(`nickname`, {p0:String}) AS `displayName`
FROM
  `users`
```

Parameters:

```json
{
  "p0": "Anonymous"
}
```

<!-- generated-sql:end -->

A non-null fallback removes nullability from this result. A nullable fallback can still produce NULL. Empty strings are retained, not replaced.

## LowCardinality(Nullable) columns

A `LowCardinality(Nullable(T))` column, including the `LowCardinality(String)` columns of the null-extended side of an outer join, gives a `LowCardinality(T)` result: the TypeScript value is `T`, not `T | null`, and the result keeps its `LowCardinality` wrapper. ClickHouse keeps that wrapper only for a constant fallback, so a column or other non-constant fallback is wrapped in `toLowCardinality(…)`, which keeps the result type identical either way.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const visits = table(
  'visits',
  {
    id: col.UInt32,
    country: col.LowCardinality(col.Nullable(col.String)),
    ipCountry: col.String,
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
const query = from(visits).map((visit) => ({
  id: visit.id,
  displayCountry: visit.country.ifNull('unknown'),
  bestCountry: visit.country.ifNull(visit.ipCountry),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  ifNull(`country`, {p0:String}) AS `displayCountry`,
  toLowCardinality(ifNull(`country`, `ipCountry`)) AS `bestCountry`
FROM
  `visits`
```

Parameters:

```json
{
  "p0": "unknown"
}
```

<!-- generated-sql:end -->

Because the result keeps its `LowCardinality` wrapper, combining it in `unionAll` with a branch whose column is plain `String` fails with `union_descriptor_mismatch`. Cast the `ifNull` result to the plain type in that branch, for example `cast(r.country.ifNull(r.ipCountry), col.String)`, so both branches carry the same descriptor.
