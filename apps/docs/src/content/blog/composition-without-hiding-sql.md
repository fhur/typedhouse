---
title: Composition without hiding the SQL
description: Why chql starts with reusable application queries and an intentionally inspectable compiler.
date: 2026-03-10
author: chql maintainers
tags: [design, composition]
draft: false
---

SQL already composes. CTEs and subqueries are powerful tools. The awkward part arrives when application code needs to reuse a tenant filter across a dashboard, an export, and a drill-down without copying SQL text or stitching strings together.

chql represents those operations as immutable query values. A shared base can grow in three directions, while the compiler keeps values separate from query structure. See the [complete composition tutorial](/docs/tutorials/composition/) for the actual API and fixture.

## Make the SQL reviewable

The current naive emitter deliberately preserves the written relational steps with nested SELECTs. That makes operation order visible: limiting before sorting is not the same as sorting before limiting. It also means we are not claiming that the emitted SQL is optimized or that chql makes queries faster.

## Guardrails, not magic

Typed expressions help developers and coding agents construct supported queries. Compiler validation catches additional unsupported cases. Neither proves that the application's access rules are correct, and parameterization does not enforce authorization.

Generated descriptors only help with schema drift when you refresh them and typecheck the consuming application. The lightweight browser playground transpiles TypeScript but does not replace that check.

## One source for people and agents

Each documentation page has a Markdown endpoint generated from its source. Technical contracts, examples, and limitations survive without JavaScript or a visual interface. [The agent index](/llms.txt) is a starting point, not a claim that agents automatically produce correct code.

This is a bounded implementation preview. Start with [one query](/docs/getting-started/), inspect its SQL, and validate it against your own schema before expanding adoption.
