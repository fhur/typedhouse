---
title: Advanced example
description: Build an account/tag report while keeping tenant scope and row grain explicit.
sidebar:
  order: 2
---

After [Getting started](/docs/getting-started/) and the
[Simple example](/docs/tutorials/composition/), combine several inputs into one report:
**for each active account in tenant `acme`, how many distinct events carried each tag?**

We will first select eligible events, then attach account names and count event/tag pairs.
Allow about 20 minutes for this third guide. Both checkpoints compile independently with their own setup. Compilation does not
connect to ClickHouse; the tiny rows below are a reasoning fixture, not inserted data.

## Decide what one row means

Current and archived events have identical columns and ClickHouse types, as required by `unionAll`. Matching JavaScript value types alone is not enough: the ClickHouse descriptors must match too.
An account ID identifies one account within a tenant; account IDs may repeat across tenants.
Assume one account row per tenant/ID and a consistent account name.
An event ID identifies one logical event within a tenant, including across the archive:
an archived copy retains its original ID rather than receiving a new one.

These are data assumptions, not constraints enforced by the table descriptors or
MergeTree sorting keys. If independent events reuse an ID, the deduplication below
can incorrectly merge them. Conflicting copies also need a separate resolution policy.

Here is our fixture. Every listed row belongs to `acme`.

| Input | ID | Account ID | Tags |
| --- | --- | --- | --- |
| events | 101 | 7 | `["red", "red", "blue"]` |
| events | 102 | 7 | `["red"]` |
| events | 103 | 8 | `["blue"]` |
| events | 104 | 7 | `[]` |
| archived_events | 101 | 7 | `["red", "red", "blue"]` |
| archived_events | 105 | 7 | `["blue"]` |

| Account ID | Name | Active |
| --- | --- | --- |
| 7 | North | true |
| 8 | South | false |

The repeated event 101 is intentional. We want it counted once per tag, not once
per stored copy or per occurrence of a tag inside its array.

## Checkpoint 1: select eligible events

Scope **each** union input and the accounts input to the same tenant. A filter on
one input does not authorize or scope another. This is especially important because
our account IDs are only unique within a tenant.

<details>
<summary>Setup: imports and all three table definitions</summary>

```ts
import {
  col,
  from,
  table,
  unionAll,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    tenant: col.String,
    id: col.UInt32,
    accountId: col.UInt32,
    tags: col.Array(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
const archivedEvents = table(
  'archived_events',
  {
    tenant: col.String,
    id: col.UInt32,
    accountId: col.UInt32,
    tags: col.Array(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
const accounts = table(
  'accounts',
  {
    tenant: col.String,
    id: col.UInt32,
    name: col.String,
    active: col.Bool,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const combinedEvents = unionAll(
  from(events).where((e) => e.tenant.eq('acme')),
  from(archivedEvents).where((e) => e.tenant.eq('acme')),
);
const activeAccounts = from(accounts)
  .where((a) => a.tenant.eq('acme'))
  .where((a) => a.active.eq(true));
const activeAccountIds = activeAccounts.map((a) => ({
  id: a.id,
}));

const query = combinedEvents.where((e) =>
  e.accountId.in(activeAccountIds),
);

export default compile(query.ir);
```

<details>
<summary>Inspect checkpoint 1 SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`tenant`,
  `__typedhouse_input`.`id`,
  `__typedhouse_input`.`accountId`,
  `__typedhouse_input`.`tags`
FROM
  (
    SELECT
      `__typedhouse_input`.`tenant` AS `tenant`,
      `__typedhouse_input`.`id` AS `id`,
      `__typedhouse_input`.`accountId` AS `accountId`,
      `__typedhouse_input`.`tags` AS `tags`
    FROM
      (
        SELECT
          `tenant`,
          `id`,
          `accountId`,
          `tags`
        FROM
          `events`
        WHERE
          `tenant` = {p0:String}
      ) AS `__typedhouse_input`
    UNION ALL
    SELECT
      `__typedhouse_input`.`tenant` AS `tenant`,
      `__typedhouse_input`.`id` AS `id`,
      `__typedhouse_input`.`accountId` AS `accountId`,
      `__typedhouse_input`.`tags` AS `tags`
    FROM
      (
        SELECT
          `tenant`,
          `id`,
          `accountId`,
          `tags`
        FROM
          `archived_events`
        WHERE
          `tenant` = {p1:String}
      ) AS `__typedhouse_input`
  ) AS `__typedhouse_input`
WHERE
  in (
    `__typedhouse_input`.`accountId`,
    (
      SELECT
        `id`
      FROM
        `accounts`
      WHERE
        `tenant` = {p2:String}
        AND `active` = {p3:Bool}
    )
  )
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "acme",
  "p2": "acme",
  "p3": "1"
}
```

<!-- generated-sql:end -->

</details>

The one-column `activeAccountIds` query is a set-membership input, not a list
fetched into JavaScript. Repeated IDs there would not multiply event rows.

The output still has the event shape: `tenant`, `id`, `accountId`, and `tags`.
Its grain is **one eligible stored event row**, not one logical event.
`unionAll` retains duplicates both within and across inputs; it does not promise
an input order. Our fixture yields five eligible rows: 101 twice, 102, 104, and 105.
Event 103 is excluded because South is inactive. Event 104 still exists despite
having no tags.

## Checkpoint 2: count distinct event/tag pairs

Now carry the same eligibility rule into a named intermediate and join account
names onto the events. This inner join would itself exclude nonmatching accounts,
so the membership filter is redundant here. We retain it intentionally to reuse
the first checkpoint's eligibility definition, not as a claimed optimization.

<details>
<summary>Independent setup: imports and all three table definitions</summary>

```ts
import {
  col,
  count,
  from,
  join,
  table,
  unionAll,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    tenant: col.String,
    id: col.UInt32,
    accountId: col.UInt32,
    tags: col.Array(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
const archivedEvents = table(
  'archived_events',
  {
    tenant: col.String,
    id: col.UInt32,
    accountId: col.UInt32,
    tags: col.Array(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
const accounts = table(
  'accounts',
  {
    tenant: col.String,
    id: col.UInt32,
    name: col.String,
    active: col.Bool,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['tenant', 'id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const combinedEvents = unionAll(
  from(events).where((e) => e.tenant.eq('acme')),
  from(archivedEvents).where((e) => e.tenant.eq('acme')),
);
const activeAccounts = from(accounts)
  .where((a) => a.tenant.eq('acme'))
  .where((a) => a.active.eq(true));
const activeAccountIds = activeAccounts.map((a) => ({
  id: a.id,
}));
const eligibleEvents = combinedEvents
  .where((e) => e.accountId.in(activeAccountIds))
  .cte();

const query = join({
  event: eligibleEvents,
  account: activeAccounts,
})
  .on((r) => r.event.accountId.eq(r.account.id))
  .map((r) => ({
    eventId: r.event.id,
    accountId: r.account.id,
    accountName: r.account.name,
    tags: r.event.tags,
  }))
  .arrayJoin((e) => e.tags, 'tag')
  .map((e) => ({
    eventId: e.eventId,
    accountId: e.accountId,
    accountName: e.accountName,
    tag: e.tag,
  }))
  .distinct()
  .groupBy((e) => ({
    accountId: e.accountId,
    accountName: e.accountName,
    tag: e.tag,
  }))
  .aggregate(() => ({ total: count() }))
  .orderBy((r) => r.total.desc())
  .thenBy((r) => r.accountId)
  .thenBy((r) => r.tag)
  .limit(20);

export default compile(query.ir);
```

<details>
<summary>Inspect checkpoint 2 SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
WITH
  `t0` AS (
    SELECT
      `id`,
      `name`
    FROM
      `accounts`
    WHERE
      `tenant` = {p0:String}
      AND `active` = {p1:Bool}
  ),
  `t1` AS (
    SELECT
      `__typedhouse_input`.`tenant`,
      `__typedhouse_input`.`id`,
      `__typedhouse_input`.`accountId`,
      `__typedhouse_input`.`tags`
    FROM
      (
        SELECT
          `__typedhouse_input`.`tenant` AS `tenant`,
          `__typedhouse_input`.`id` AS `id`,
          `__typedhouse_input`.`accountId` AS `accountId`,
          `__typedhouse_input`.`tags` AS `tags`
        FROM
          (
            SELECT
              `tenant`,
              `id`,
              `accountId`,
              `tags`
            FROM
              `events`
            WHERE
              `tenant` = {p2:String}
          ) AS `__typedhouse_input`
        UNION ALL
        SELECT
          `__typedhouse_input`.`tenant` AS `tenant`,
          `__typedhouse_input`.`id` AS `id`,
          `__typedhouse_input`.`accountId` AS `accountId`,
          `__typedhouse_input`.`tags` AS `tags`
        FROM
          (
            SELECT
              `tenant`,
              `id`,
              `accountId`,
              `tags`
            FROM
              `archived_events`
            WHERE
              `tenant` = {p3:String}
          ) AS `__typedhouse_input`
      ) AS `__typedhouse_input`
    WHERE
      in (
        `__typedhouse_input`.`accountId`,
        (
          SELECT
            `t0`.`id`
          FROM
            `t0`
        )
      )
  )
SELECT
  `__typedhouse_input`.`accountId` AS `accountId`,
  `__typedhouse_input`.`accountName` AS `accountName`,
  `__typedhouse_input`.`tag` AS `tag`,
  count() AS `total`
FROM
  (
    SELECT DISTINCT
      `__typedhouse_input`.`eventId`,
      `__typedhouse_input`.`accountId`,
      `__typedhouse_input`.`accountName`,
      `__typedhouse_input`.`tag`
    FROM
      (
        SELECT
          `__typedhouse_input`.`eventId` AS `eventId`,
          `__typedhouse_input`.`accountId` AS `accountId`,
          `__typedhouse_input`.`accountName` AS `accountName`,
          `__typedhouse_input`.`tag` AS `tag`
        FROM
          (
            SELECT
              `__typedhouse_input`.`eventId` AS `eventId`,
              `__typedhouse_input`.`accountId` AS `accountId`,
              `__typedhouse_input`.`accountName` AS `accountName`,
              `__typedhouse_element` AS `tag`
            FROM
              (
                SELECT
                  `event`.`id` AS `eventId`,
                  `account`.`id` AS `accountId`,
                  `account`.`name` AS `accountName`,
                  `event`.`tags` AS `tags`
                FROM
                  `t1` AS `event`
                  INNER ALL JOIN `t0` AS `account` ON `event`.`accountId` = `account`.`id`
              ) AS `__typedhouse_input`
              ARRAY JOIN `__typedhouse_input`.`tags` AS `__typedhouse_element`
          ) AS `__typedhouse_input`
      ) AS `__typedhouse_input`
  ) AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`accountId`,
  `__typedhouse_input`.`accountName`,
  `__typedhouse_input`.`tag`
ORDER BY
  `total` DESC,
  `accountId` ASC,
  `tag` ASC
LIMIT
  20
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "1",
  "p2": "acme",
  "p3": "acme"
}
```

<!-- generated-sql:end -->

</details>

## Follow the changing grain

1. **Join:** one row per matching event/account pair. This is an inner **ALL** join:
   every matching pair survives. Duplicate account keys can multiply rows; the
   descriptor does not enforce our uniqueness assumption. Joining on ID alone is
   appropriate here only because both sides have the same single-tenant scope.
2. **Expand:** one row per tag occurrence per matching pair. Repeated `red` values
   produce repeated rows. Empty arrays produce no rows, so event 104 disappears.
3. **Project and distinct:** one row per unique
   `(eventId, accountId, accountName, tag)` tuple. The original array is no longer
   part of the comparison. This collapses repeated tags and identical archived
   copies without collapsing different events that happen to share a tag.
4. **Group and count:** one row per `(accountId, accountName, tag)`, with `total`
   counting the deduplicated event/tag rows. Counts decode to `bigint`.
5. **Sort and limit:** choose at most 20 report groups, not 20 source events.
   Account ID and tag break equal-count ties under the account-name assumption.

The projection before `distinct` defines what “duplicate” means. Dropping `eventId`
would instead leave one row per account/name/tag and make every resulting count 1.
Keeping extra source fields could prevent copies from collapsing. Different account
names remain distinct and form separate groups; deduplication is not a repair for
inconsistent account data.

`.cte()` requests a named SQL `WITH` intermediate without changing the row shape.
It is not a cache, temporary table, or guaranteed materialization. Do not infer that
ClickHouse evaluates it once, or that reusing `activeAccounts` avoids repeated work.

For the fixture, expansion produces eight rows and distinct leaves four pairs:
101/red, 101/blue, 102/red, and 105/blue. The final ordered result is:

| accountId | accountName | tag | total |
| --- | --- | --- | --- |
| 7 | North | blue | 2 |
| 7 | North | red | 2 |

Accounts with no surviving tags have no group; this query does not emit zero rows
for every possible account/tag combination.

## Predict, then change

Remove only `.distinct()` from checkpoint 2. What totals and order do you expect?

<details>
<summary>Answer</summary>

North/red becomes 5: two occurrences in current event 101, two in its archived
copy, and one in event 102. North/blue becomes 3: one from each copy of 101 and one
from 105. Red now sorts first. Empty event 104 still contributes nothing.

</details>

## What you now know

You can compose queries as union inputs, membership sets, and named join inputs; track a row through array expansion; and choose exactly which fields define a duplicate before aggregation. The key question at every step is **“what does one row represent now?”**

To try either checkpoint in the [playground](/playground/), include its collapsed setup, remove the compiler import, and replace the default export with `export default query`. For production use, generate descriptors from the actual schema and run the query through the server-side client, as in [Getting started](/docs/getting-started/#execute-on-a-server).

## Where to go next

- For a single query-derived value rather than a membership set, read
  [scalar subqueries](/docs/query-builder/scalar-subqueries/).
- If your real table needs `FINAL` or `SAMPLE`, check the engine and metadata
  requirements in [scan modifiers](/docs/query-builder/scan-modifiers/).
- When nullable columns enter the report, decide their meaning explicitly with
  [isNull](/docs/functions/is-null/) and [ifNull](/docs/functions/if-null/).
- To understand emitted SQL boundaries and rewrites, continue with the
  [compiler overview](/docs/compiler/overview/).
