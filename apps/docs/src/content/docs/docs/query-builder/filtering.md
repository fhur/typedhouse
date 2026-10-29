---
title: where
description: Filter rows with typed boolean expressions.
sidebar:
  order: 2
---

`where` keeps rows whose predicate is true and preserves their shape. Its callback builds a row-mode expression; it does not run JavaScript against fetched rows. NULL predicates do not select rows.

## Example

Use expression methods such as `.eq`, `.gt`, and `.and`. JavaScript `===`, `&&`, and `||` do not construct query predicates. Values become typed parameters, not interpolated SQL.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
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
const query = from(events).where((e) =>
  e.tenant.eq('acme').and(e.id.gt(100)),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`
FROM
  `events`
WHERE
  `tenant` = {p0:String}
  AND `id` > {p1:UInt32}
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "100"
}
```

<!-- generated-sql:end -->

Filter before projection if the predicate needs a field that the projection removes. Filtering after a limit filters only the already-selected subset. Parameterization does not replace authorization: tenant and access predicates must still be correct.
