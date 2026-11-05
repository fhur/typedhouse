## Track A: `min`, `minIf`, `argMin`, `argMinIf`, `quantileExact`, `quantileExactIf` (2026-11-05)

**Status: complete on branch `agg-min-exact`, uncommitted. The final gate at merge is pending.**

**Done.** The six aggregates are typed, exported and documented. `argMin` and `argMinIf` accept the same date and time versions as `argMax`. `min` gets the same filter push-down as `max`.

| Task | Status | Checked in the diff |
|---|---|---|
| A1 Catalog and exports | Done | Entries appended at positions 8–10, and existing positions unchanged. `argMin` is on the root-name list. No `State`/`Merge` exports. |
| A2 Compiler resolution | Done | `resolve.ts` needed no change. The level stays a `Float64` parameter, and invalid levels are rejected in both emitters. |
| A3 `min` in `safeAggregate` | Done | One-condition change plus its doc comment. |
| A4 Nullable predicates | Done (Q1 approved) | `emit-naive.ts`, typed `min`/`max` with `If` only, when the predicate is nullable. |
| A5 Worker tests | Done | New files only: runtime, native, positive and negative types. |
| A6 Docs | Done | Six pages, `overview.md`, `spec.md:710`, and approximate vs exact in both `quantile` pages. |
| A7 Tester | Done | Two new test files and additive cases in `verify-query-package.mjs`. No existing test, snapshot, fixture or config changed. |
| A8 Gates and evidence | Done, except the merge gate | See Evidence. |

**Decided.**
- **Q1, approved by the owner.** `minIf` and `maxIf` wrap a nullable predicate in `ifNull(pred, false)`. On ClickHouse 24.8, `maxIf(v, n < 10)` returned `100` instead of `2` when `n` was NULL on the row with `v = 100`, for `UInt32`, `UInt64`, `Float64`, `Date` and `DateTime` values. This fixes existing `maxIf` behaviour. Non-nullable predicates keep their exact SQL.
- **`quantileExact` returns the input type**, not `Float64` like `quantile`, because that is what the server does. It picks an element and never interpolates: on `[1,2,3,4]` at level 0.5 it gives `3`, and `quantile` gives `2.5`. `Float64` would corrupt `UInt64` above 2^53.
- **New catalog entries are appended only.** `derived[n]` and `aggregateDefinitions[5]` are positional, and `as` casts hide a wrong index. A comment in the catalog now says so.

**Server behaviour, documented on the new pages and pinned by native tests.** Empty non-null input returns the type's default, not NULL, except that empty float `quantileExact` returns NaN. An Enum with no zero member fails through the client on empty input. A float NaN makes `min`, `max` and `argMin` depend on read order.

**Open, for the owner (recorded, not fixed).**
- A handwritten catalog that declares a literal `maxIf` known function bypasses the wrapper. `typedhouse generate` cannot produce one.
- A known scalar wrongly declared `.as(col.Bool)` that returns NULL escapes the wrapper. That type is the caller's assertion.
- `arg-max.md` and `arg-max-if.md` do not describe NaN versions, although `arg-min.md` does and an early probe showed `argMax` behaving the same way. The brief did not require this.

**Evidence.**
- **Reported to the PM, logs not all seen:** `check:all` on TypeScript 5.5.4 and latest, `docs:verify`, and `check-type-performance.mjs --all` all exited 0 on this code logic, before later prose-only edits. The Tester's rerun after the first prose round: `pnpm test` 1530 passed and 1 skipped, compiler integration 526 passed. The Tester validated the behaviour behind the final prose findings P1 and P2 natively. The Worker's `docs:verify` after those fixes exited 0.
- **Prose-only check by the PM:** with comments removed, the TypeScript AST of `aggregate.ts` is identical to the Worker's backup from 11:02. `emit-naive.ts` and `rewrite-expressions.ts` are byte-identical to theirs. That backup predates every prose round. The baseline is a backup file, not a commit. The last round touched only `min.md`, `min-if.md`, `max.md`, `max-if.md` and comments in `aggregate.ts`.
- **Rerun by the PM on the current tree:** the three new unit files pass (88 tests), and the two new native files pass (152 tests).
- **Negative controls run by the PM on a scratch copy, against those 88 unit tests.** Each one failed tests:

| Mutation | Tests failed |
|---|---|
| `min` on the wrong `derived` index | 7 |
| `argMinIf` routed to `argMax` | 7 |
| `argMin` off the root-name list | 1 |
| `quantileExact` returning `Float64` | 3 |
| `quantileExact` using the `quantile` definition | 11 |
| `argMin` without date versions | 2 |
| `min` out of `safeAggregate` | 3 |
| No `ifNull` wrapper | 5 |
| Wrapper on `max` only | 5 |
| Wrapper on non-nullable predicates too | 9 |

**Pending at merge.** A full gate, since test files and `verify-query-package.mjs` changed after the earliest gate logs and the formatter track rewrites these files.
## Track C: LIMIT BY and PREWHERE (2026-11-05, PM)

**Status.** C1 to C9 and C11's gates are done, uncommitted. C10 has one docs wording gap (see C11 coverage review). A final gate at merge is pending. Open questions Q1 to Q4 are decided (see Decisions). Facts below were measured on `clickhouse/clickhouse-server:24.8` (24.8.14) with default settings unless stated.

### Design note

**LIMIT BY API (owner decision).** A builder: `q.limitBy(r => r.category).take(10).offset(20)`. `limitBy` is on `Query`, so it works after `where`, `map`, `aggregate`, joins, `union` and `orderBy`.
- `limitBy(by)`: `by` is `row => Expr | readonly Expr[]` in row mode, with at least one key; an `Ordering` is rejected. It returns an intermediate that is not a `Query`: its only method is `take`, and it has no `ir` or `toSQL`, so it cannot be compiled or executed. Like `groupBy(...)`, it builds no node.
- `take(n)`: builds the `LimitBy` node and returns a `Query` subclass that adds `offset`, modelled on `OrderedQuery`/`thenBy`. It is usable anywhere a `Query` is.
- `offset(m)`: optional. It builds a new `LimitBy` with the same input, keys and `n`, and returns a plain `Query`, so a second `.offset` is a type error. Every other operator also returns a plain `Query`, so `.offset` is available only directly after `take`, and `.thenBy` is never available.
- `n` and `offset` follow the `limit` rules (non-negative safe integers, `invalid_limit`), rendered inline.

**LIMIT BY IR.** New node `LimitBy { input, n, offset?, keys: ExprNode[] }`, output same as input. Renders `LIMIT n [OFFSET m] BY k1, k2`.

**LIMIT BY key rule.** Every key must read at least one column of the row (`invalid_limit_by_key`, checked in the builder and in compiler validation). Reason: `LIMIT 1 BY 2` is positional under the default `enable_positional_arguments = 1`, so a literal key means a different column in the naive and optimized select lists. A constant parameter is not positional but collapses all rows into one group, and a key-less `Raw` could print a bare number.

**LIMIT BY clause order.** `ORDER BY`, then `LIMIT BY`, then `LIMIT` is the only legal text. `LIMIT 3 LIMIT 2 BY k`, `LIMIT 1 BY k ORDER BY v` and two `LIMIT BY` clauses are all syntax errors. So planner rank becomes Filter 1, Sort 2, LimitBy 3, Limit 4, and anything out of rank opens a derived table.

**LIMIT BY interactions.**
- `rewrite-rel`: no rule crosses it. Add it to `edges()`, to `visit()` (a missing case keeps the old input, which stays correct but loses every rewrite below it; corrected from "loses a pushed filter" by the Tester's C4 control), and to `fallible()` with `own = keys not total`, like `Sort`.
- `prune-columns`: same as `Sort` (demand passes through, keys add demand). A key need not be selected.
- `plan-ctes`: add keys to `expressions()`.
- `plan-selects`: add to `SelectClause`, `rank` and `clausesRead`. Over an aggregate block a key must be a bare `ColumnRef`, as for `Sort`, otherwise it nests. `clausesRead` matters: `count() AS v ... LIMIT 1 BY v` raises code 10 under `prefer_column_name_to_alias = 1`.
- Scan projections do not fold: over any `child.project` it opens a derived table, because `v % 2 AS k ... LIMIT 1 BY k` binds the alias while `i.k` binds the column.
- Live capability: builder returns `{ live: false }`, matching `liveRelation`'s default.

**LIMIT BY safety.** A row dropped by LIMIT BY is not seen by an outer fallible `WHERE` (probed), and the server does not push an outer non-key filter across it. An inner `ORDER BY` survives nesting: folded and naive shapes (including a Project, Filter or CTE in between, `max_threads = 1`, and redundant-sorting removal off) retained identical rows on 900k rows in 3 parts. Without a total order, which rows survive is unspecified, so differential tests must sort on a unique tie-breaker first, and the docs must say so.

**PREWHERE API.** `from(t)[.final()][.sample(f)].prewhere(row => pred)` on `TableQuery` only, with the same predicate type as `where`. Returns a plain `Query`, so `.where(...).prewhere(...)`, `.prewhere(...).final()` and a second `.prewhere(...)` are type errors, and `insertMany` stays unavailable. Runtime guard `invalid_prewhere_source` for JavaScript callers. Explicit only: `Filter` is never promoted, `Prewhere` never demoted.

**PREWHERE relations.** Directly over a physical `Scan`, nothing else. A subquery or CTE source raises code 182 `ILLEGAL_PREWHERE`. A join input uses `join({ a: from(t).prewhere(p), ... })` and renders as a derived table. The server also accepts PREWHERE on a join block, but the compiler never emits that.

**PREWHERE IR.** New node `Prewhere { input: Scan, pred }`, output same as input; `invalid_prewhere_input` if the input is not a `Scan`. Chosen over a `Scan` field because `hint()` gives a scan a new id on every call, so a predicate field could not bind to its own node, and every expression walker would need a Scan arm.

**PREWHERE rendering.** `FROM t AS i FINAL SAMPLE f [ARRAY JOIN ...] PREWHERE p WHERE q`; `WHERE` before `PREWHERE` is a syntax error. Parameters number in that textual order. Naive form is `SELECT list FROM t AS i FINAL SAMPLE f PREWHERE p`: the Prewhere and Scan share one naive SELECT because PREWHERE must read the table directly. Every enclosing naive node still nests.

**PREWHERE interactions, each a way to drop or move it if missed.**
- `plan-selects`: carry it on the source, `source: { kind: 'table', scan, prewhere? }`, not as a block field. The Aggregate arm builds a new block from `child.source`, so a block field would be silently dropped. All three block renderers must print it.
- `plan-selects` alias guards: add `prewhere.pred` to the Project arm's `others`, because an unqualified alias captures PREWHERE (`v + 1000 AS v ... PREWHERE v < 20` returned 0 rows; a qualified `i.v` returned the right row). ArrayJoin arm: do not fold when the alias is a name the predicate reads (`ARRAY JOIN tags AS cat PREWHERE cat = 'x'` raises code 182).
- `plan-ctes`: do not count the Prewhere-to-Scan edge. Otherwise `s.prewhere(a)` plus `s.where(b)` on one `from()` makes the Scan a CTE and the emitter writes PREWHERE over a CTE (code 182). A shared `Prewhere` node may itself be a CTE (verified valid). Add `pred` to `expressions()`.
- `rewrite-rel`: no rule targets `Prewhere`, and a `Filter` above it stays above. Add to `edges()` and `visit()`. In `fallible()` count a non-total predicate in both modes, which fences `LeftToInner`, `PushFilterJoin` and `MergeFilter` above it (conservative).
- `prune-columns`: same as `Filter`.
- Live capability: `{ live: false }`.

**PREWHERE safety under results-only.** The predicate's evaluation set does not change, since it stays directly on its scan in both emitters, and an explicit PREWHERE is never merged with WHERE by the server (`EXPLAIN` keeps a separate Filter step, nested and folded). Probed outcomes:
- A guard in PREWHERE protects a fallible `WHERE`, select item, `GROUP BY` key, aggregate, `ARRAY JOIN` expression and a `WHERE` above a join; folded and nested forms agree wherever both were run.
- A fallible PREWHERE fails over a total `WHERE` guard in both forms, because the guard cannot get below it.
- Inside one PREWHERE, when both conjuncts read the same column, `s != 'bad' AND toUInt32(s) > 0` passed and the reversed order failed on every table shape tried, so the predicate must never be reordered or split.
- A guard on a different column is not reliable, in either order: `id < 13 AND toUInt32(s) > 0` returned rows or failed with code 6 depending on parts and `index_granularity` (see C11 coverage review). With `enable_multiple_prewhere_read_steps = 0`, guard first passed on the 5 shapes tried. A guard in PREWHERE with the cast in `WHERE` passed on all of them.
These are observations on 24.8, not a server guarantee; docs should say so.

**PREWHERE with FINAL is not equivalent to WHERE.** PREWHERE runs before the merge. Rows `(1, v1, 'open')` and `(1, v2, 'closed')`: `FINAL WHERE status = 'open'` returns only id 2; `FINAL PREWHERE status = 'open'` also returns the stale `(1, v1, 'open')`. Predicates that read only sorting-key columns matched `WHERE` (equality, a key prefix, a function of a key, with and without `SAMPLE`). The server itself leaves `WHERE` above FINAL by default. Decision: allowed and documented, with no compile error (see Decisions). Both emitters print the same `FINAL PREWHERE`, so the paths agree on the stale row.

**PREWHERE with SAMPLE.** Same count as `WHERE` under `SAMPLE 0.1`. `FINAL SAMPLE f PREWHERE` is valid.

**PREWHERE predicate type.** Same as `Filter`: base type `Bool`, enforced by `invalid_predicate`. `Bool`, `Nullable(Bool)`, `Nullable(UInt8)` and `LowCardinality(Nullable(UInt8))` columns gave the same rows as `WHERE` (NULL drops the row). Non-boolean `Nullable(UInt32)` raises code 59 on the server; the type check stops it first. Aggregates raise code 184 and are stopped by row mode.

**Engines.** Works: MergeTree family, Merge, Distributed, Buffer, MaterializedView (TO). Code 182: Memory, Log, View, `numbers()`. ALIAS and MATERIALIZED columns work in PREWHERE. Decision: no compiler check; the server's code 182 surfaces as `QueryError`, as `final()` and `sample()` already rely on.

**Naive emitter.** Both nodes are handled in `emitNaive`, so `validateRel` applies all checks before rewriting and both paths reject the same IR.

### Tasks

Order: C1 to C5 land first. PREWHERE follows: C6, C7, C8 and C10 by the Worker, then C9 by the Tester.

**C1. `LimitBy` in core.** Depends: none. Status: done.
Node, `Query.limitBy`, the intermediate, the `take` result with `offset`, key rule, `{ live: false }`, JSDoc, type export, devtools label and edges.
Accept: positive types for flat, nested join, aggregate and ordered inputs, one key and many keys, with and without `.offset`; the `take` result and the `offset` result are each assignable to `Query` and accepted by `run`. Negative types: `limitBy(...)` used as a query (`where`, `map`, `limit`, `orderBy`, `.ir`, `toSQL`, `compile`, `run`, as a join input), `.offset` directly after `limitBy` without `take`, `.offset` twice, `.take` twice, `.offset` after another operator (`.take(1).where(...).offset(1)`), `.thenBy` after `take` or `offset`, `Ordering` key, grouped-mode key, non-`Expr`. Runtime tests: empty keys, key with no column, bad `n` and `offset`, and `offset` replacing the node rather than nesting a second `LimitBy`.

**C2. `LimitBy` in compiler passes and naive emitter.** Depends: C1. Status: done.
`validate-structure`, `rewrite-rel` (`edges`, `visit`, `fallible`), `prune-columns`, `plan-ctes`, `emitNaive`.
Accept: unit tests show that a Filter stays above it, a filter pushed below it is kept in the rebuilt node, a subquery in a key is counted and a shared one becomes a CTE, a non-total key fences as `Sort` does, and an unselected key is demanded from the input. Literal, constant-`Param` and key-less `Raw` keys are rejected by the compiler for hand-built IR. Naive SQL parses on 24.8.

**C3. `LimitBy` in planner and planned emitter.** Depends: C2. Status: done.
`SelectClause`, rank, `clausesRead`, the aggregate `safe` rule, and all three block renderers.
Accept: SQL tests for scan, join and aggregate blocks that `Filter + Sort + LimitBy + Limit`, with offset, fold into one SELECT in that clause order. These nest: `limit` then `limitBy`, `limitBy` then `orderBy`, `limitBy` twice, `limitBy` then `where`, `limitBy` over a computed `map`, and `limitBy` then `distinct`. `distinct` then `limitBy` folds and keeps the full DISTINCT list. Alias collision over an aggregate with `prefer_column_name_to_alias = 1` does not raise code 10.

**C4. `LimitBy` native and differential coverage.** Depends: C3. Owner: Tester. Status: done.
Accept: integration tests compare `run` and `stream` with handwritten SQL and a JavaScript oracle, for multi-part data, offset, `LIMIT 0`, NULL keys (one group), float keys (float keys group by bit pattern; NaNs with the same bit pattern form one group, and signed zeros are separate), array keys, join keys, and over an aggregate. Differential arbitrary and `requiredOperators` include `LimitBy` under a total order, with naive and optimized rows equal. EXPLAIN corpus gains the `LimitBy` fence and step type. A fallible outer filter over retained-only good rows passes on both paths. Negative controls: removing `clausesRead`, the rank entry, or the `visit` case each fails a test.

**C5. `LimitBy` docs and spec.** Depends: C3. Status: done.
`query-builder/limits.md` with generated SQL, `compiler/select-blocks.md`, `spec.md` (IR table, operator text, the "Window functions, `LIMIT BY`" row, the "Two-stage calls" row gaining `limitBy(…).take(…)` with optional `.offset(…)`, and a note in "Decided, and still open" recording the builder shape, the key rule and that the owner chose the builder).
Accept: docs use the builder form throughout and state unspecified row choice without a total order, NULL grouping (one group), float grouping (float keys group by bit pattern; NaNs with the same bit pattern form one group, and signed zeros are separate), and the key rule. Window functions keep their existing row. `pnpm docs:verify` passes. The stale NaN line in `query-builder/limits.md` is fixed.

**C6. `Prewhere` in core.** Depends: C5. Status: done.
Node, `TableQuery.prewhere`, `invalid_prewhere_source`, `{ live: false }`, JSDoc (including the FINAL warning), devtools label and edges.
Accept: positive types after `from`, `final`, `sample`, and as a join input, with a non-key predicate after `final` accepted. Negative types: after `where`/`map`/`orderBy`, on a join or union, `.final()` after it, a second `.prewhere()`, `insertMany` after it, non-boolean and aggregate predicates.

**C7. `Prewhere` in compiler passes and naive emitter.** Depends: C6. Status: done.
`validate-structure`, `rewrite-rel` (`edges`, `visit`, `fallible`), `prune-columns`, `plan-ctes` (uncounted Scan edge), `emitNaive`, `invalid_prewhere_input`.
Accept: unit tests show a Filter above is never merged into or moved below it; a Scan shared by `prewhere` and `where` never becomes a CTE under PREWHERE; a shared `Prewhere` becomes a CTE with its predicate inside; a column read only by the predicate is demanded by the scan; a non-total predicate fences the join rules; a non-`Scan` input is rejected; invalid scan hints are still rejected on the naive path; a non-key predicate under FINAL compiles on both paths.

**C8. `Prewhere` in planner and planned emitter.** Depends: C7. Status: done.
`source.prewhere`, the block arm, the Project `others` guard, the ArrayJoin alias fence, and all three renderers.
Accept: SQL tests for `FINAL SAMPLE ... ARRAY JOIN ... PREWHERE ... WHERE` order and parameter numbering, and for folding through Project, Filter, Aggregate, Distinct, Sort, Limit and LimitBy with PREWHERE present in the SQL every time. As a join input it is a derived table. An alias equal to a predicate column, and an expansion alias equal to one, each keep a separate scope. A test walks every block shape and fails if PREWHERE is missing from the output.

**C9. `Prewhere` native and differential coverage.** Depends: C8. Owner: Tester. Status: done.
Accept: integration on 24.8 through `run` and `stream`, compared with handwritten SQL, naive and optimized. Cover the guard and fallible cases above, ALIAS columns, join sides (inner and left), a `SAMPLE BY` table created by the test, FINAL with a key predicate matching `WHERE`, and an unsupported engine surfacing `QueryError` with code 182 on both paths. Required stale-version test, with merges stopped: `final().prewhere()` on a non-key column returns the stale `(1, v1, 'open')`, `final().where()` does not, and naive and optimized rows are equal, pinning the behaviour. Differential arbitrary adds `Prewhere`. Results-only check for a fallible predicate. EXPLAIN shows `Prewhere info` on the read and a separate Filter step for `WHERE`, on both paths. Negative controls: a block-level field instead of `source.prewhere`, counting the CTE edge, and dropping the Project guard each fail a test.

**C10. `Prewhere` docs and spec.** Depends: C8. Status: one wording gap open.
`query-builder/scan-modifiers.md` with generated SQL, `compiler/select-blocks.md` ("does not emit PREWHERE" becomes explicit-only), `compiler/overview.md` line 47, `spec.md` (`Scan` hints, IR table, emission details, line 746 stays true for inference, a note in "Decided, and still open" recording that FINAL with a non-key predicate is allowed and that engines are not checked).
Accept: `scan-modifiers.md` carries a prominent warning, with the reproduced example and its rows, that under `final()` a non-key predicate filters before merging and can return a stale row version, and that `where()` is the form that filters after merging. Docs also state that sorting-key predicates matched `WHERE`, the supported engines and code 182, the join-side form, and that guard behaviour is observed on 24.8 rather than guaranteed. `pnpm docs:verify` passes.

**C11. Gates and evidence.** Depends: C4, C5, C9, C10. Status: gates passed; final gate at merge pending.
Accept: `pnpm check:all` on TypeScript 5.5.4 and latest, precise diagnostics after `pnpm build`, `pnpm docs:verify`, `node scripts/check-type-performance.mjs --all` with no budget change unless approved, and this section updated with evidence. The EXPLAIN corpus entry `limit-by/subquery-key` is `run: false`: resolved, see the coverage review. PM then checks coverage against the actual diff.

### Decisions

- **Float keys in LIMIT BY (orchestrator, to be reported to the owner): match ClickHouse, do not normalise keys.** Corrected by a Tester native experiment on 24.8.14: `nan` (0x7FF8...) and `0/0` (0xFFF8...) form two groups, and `0.0` and `-0.0` form two groups. Naive and optimized agree. The PM's earlier probe used only same-pattern NaNs. This corrects a fact and does not weaken a requirement.
- **Q1, `final().prewhere()` (owner): allowed and documented.** No compile error. C6 and C10 carry the warning; C9 pins the stale row and path agreement.
- **Q2, engine checks (orchestrator, following the PM recommendation, to be reported to the owner): none in the compiler.** The server rejects with code 182.
- **Q3, `test/types/ir.ts:17` (owner): approved.** The Tester may add `'LimitBy'` and `'Prewhere'` to that line, additively and nothing else. `requiredOperators`, `fenceNodes` and `stepTypes` also list node kinds; those are additive harness edits for the Tester.
- **Q4, LIMIT BY API (owner): builder** `q.limitBy(by).take(n).offset(m)`, replacing `limitBy(n, by, offset?)`. Key rule, IR node and planner rank are unchanged.

### C11 coverage review (PM, 2026-11-05)

**Gates, as reported by the Tester.** `check:all` exit 0 on TypeScript 5.5.4 and latest; `docs:verify` exit 0; `check-type-performance.mjs --all` exit 0; type diagnostics 466 on each of 5.5.4, 5.8.3 and latest. The PM read the `check:all` logs: both show 1718 unit tests passed and 1 skipped, 8 codegen and 614 compiler/client native tests passed. The 5.5.4 run took 10m 34s and ended 12:29:37, so it began about when the last source edit landed (12:19:01). That ordering rests on timestamps; the logs do not name test files.

**Post-gate edit: prose only, confirmed.** The only non-ignored file newer than the last gate is `scan-modifiers.md`. The Worker's recorded edit (12:41:54, matching the file's mtime) replaces one sentence in the "Failing expressions" bullet. No code, fence or generated block changed. `docs:verify` and `pnpm typecheck` then exited 0 (reported).

**Gap: `scan-modifiers.md:216` is true for one table and too general as written.** "A guard on a different column did not protect in either order: `id < 13 AND toUInt32(s) > 0` failed on a row that `id < 13` excludes." Native check on 24.8.14, same 40 rows, `bad` only at ids 13, 26 and 39, `ORDER BY id`, 3 runs each:

| Parts, `index_granularity` | Guard first | Guard last | Same-column guard first | Same-column guard last | Guard in PREWHERE, cast in WHERE |
|---|---|---|---|---|---|
| 4 parts, 4 (the test's table shape) | code 6 | code 6 | passes | code 6 | passes |
| 4 parts, 8192 | passes | code 6 | passes | code 6 | passes |
| 1 part, 4 | passes | passes | passes | code 6 | passes |

The failure on the test's table is real, and it is on a row `id < 13` excludes. But guard first passed on the other shapes, and on 1 part with granularity 4 both orders passed, consistent with key analysis skipping the bad row's granule (not separately confirmed). Proposed wording: "A guard on a different column was not reliable, in either order: with the same rows, `id < 13 AND toUInt32(s) > 0` returned rows or failed with code 6 depending on how the rows were split into parts and on `index_granularity`, even though `id < 13` excludes every failing row. A guard in `prewhere` with the cast in `where` passed on every shape we tried." The docs prose should change; no test or code should.

**Results-only, added check.** Because the outcome varies with the plan, the PM compared the optimized and naive SQL shapes (narrow list, list with `s`, nested, folded and nested `WHERE`) for all four guard orders across the table shapes. Outcome and row count matched in every comparison that ran. Table `a` has no `cat` column, so its nested and `WHERE` shapes errored for that reason and compared nothing.

**Coverage against the diff.**
- C1 to C3, C6 to C8: every interaction in the design note is in the source diff (`edges`, `visit`, `fallible`, `expressions`, the uncounted Scan edge, `source.prewhere`, the `others` guard, the ArrayJoin fence, `clausesRead`, rank, all three renderers, both emitters). `references` does not enter a `Subquery`, so builder and compiler agree on the key rule. Required negative types are present.
- C4, C9: required cases are present by test title. The required controls are in the Tester's reports, all failing tests: C4 `clausesRead`, rank and `visit`; C9 `source.prewhere`, CTE edge and Project guard. The PM did not rerun them.
- C5, C10: docs, the Decided rows and the two-stage row are present; the FINAL warning is a `:::caution` with the reproduced rows. The Window functions row is kept.
- Existing tests: `test/types/ir.ts` changed only the approved line. Other harness edits add cases or thread an optional `prewhere` flag defaulting to false; no expectation was weakened. Adding that flag and the new operators changes what the seeded arbitraries generate.
- Minor: the test title "NULL is one group, and NaN is one group" (`limit-by.integration.ts:100`) uses one bit pattern, so it is true but imprecise. The adversarial file covers the corrected fact.

**C11 item resolved.** `limit-by/subquery-key` is `run: false` because of a harness read-set limit for IN outside `WHERE`: the set gets its own read in the main plan, and the clause counts main scans only. Sort keys and select items behave the same, and a test pins it.

**Limits.**
- `differential.integration.ts` has no `Prewhere` case because its Memory tables reject it; the fixture differential covers `Prewhere` only with a key predicate under FINAL.
- Non-key FINAL is covered by the stale-row pin only.
- The 10k nightly differential was not run.
- Distributed, Buffer and Merge rest on the PM's one-table probe. Buffer had no unflushed rows in it.
- The guard-reliability table is a small sample on 24.8.14.

**Follow-up for the owner, out of scope.** Existing client bug: an error after rows have started streaming arrives as `decode_missing_column` and loses the server code. It also happens on `where` and `map`, so it is not specific to this track.

Also for merge planning: the unmerged `studio` branch may switch over `Rel['kind']`; not checked here.
## Track B: code formatter (2026-11-05, reviewed; post-merge rerun and final gates pending, branch `code-formatter`)

**Status.** B1 to B7 are done and pass the B8 review, all uncommitted on top of b49e052. Still pending: the orchestrator's commits, the `pnpm format` rerun after tracks A and C merge, and the final gates on that result. The trial sections below are the original gap analysis, kept as written.

**Exclude list.** Prettier and ESLint must share one list.

| Path | Reason | Evidence |
|---|---|---|
| `test/types/negative/` | Expected diagnostics are matched by exact line | `check-type-diagnostics.mjs` compares file, line, code and message. After Prettier, 348 of 409 `// expect:` comments moved and the checker failed (exit 1); unformatted passes 409 |
| `test/types/bench/` | Byte-hashed inputs, and generated files | `queries.ts`, `chain25.ts`, `join10.ts` and `correspondence.ts` are compared byte for byte with generator output. `inputHash` covers them |
| `scripts/generate-type-bench.mjs`, `scripts/generate-type-stress.mjs` | Listed in `budget.json` `inputs`, hashed as raw bytes | Formatting them fails with `Benchmark inputs changed`. With them excluded, `check-type-performance.mjs` passes on 5.8.3 |
| `test/types/snapshots/` | Generated, compared byte for byte; `corpus/rows.d.ts` is also in `inputHash` | `verifySnapshot`, `verify-expr-surface.mjs` |
| `test/types/corpus-types.ts`, `components-latest-corpus.ts`, `known-functions-corpus.ts`, `projection-enrichment-corpus.ts`, `sql-snippets-corpus.ts` | Generated by `check-corpus-types.mjs`, compared byte for byte | `sameOrRefresh(...)`. Prettier rewrites `corpus-types.ts` (678 insertions, 226 deletions) |
| `packages/core/src/expr-methods.generated.ts`, `.generated.d.ts` | Generated; `gen-expr-methods.ts --check` compares bytes | `Generated surface stale` |
| `packages/compiler/test/fixtures/` | Fixtures; `corpus/low-stock.ts` is in `inputHash`; corpus files feed declaration snapshots | `budget.json` `inputs` |
| `packages/compiler/test/snapshots/`, `packages/codegen/test/snapshots/` | Generated; compared by `toMatchFileSnapshot` and `cli.integration.ts` | Named in the brief |
| `apps/docs/src/playground/generated/` | Codegen output with a content hash | Header `generated by @typedhouse/codegen ... hash:` |
| `apps/docs/src/examples/` | Imported with `?raw` and shown on the homepage, so layout is public content | At width 100 Prettier changes all four examples, for example joining the line-broken `isEnterprise` helper |
| `dist`, `apps/playground/`, `.worktrees/`, Markdown | Named in the brief | |

**`test/types/` decision.** The positive files are safe to format, apart from the exclusions above and one directive below. In the trial, 51 of the 53 `@ts-expect-error` directives in `test/types/` and `packages/*/test/` held under `pnpm typecheck`. The 3 in `apps/docs/tests/browser/playground.spec.ts` stay directly above one-line statements, but root typecheck does not compile that file.

**Checked, not line-sensitive.** Testcontainers patch checks read only the installed package. `gen-expr-methods.ts` imports the catalog rather than reading its text. `insert-types.test.ts` and `check-corpus-types.mjs` line assertions apply to source held in strings. `low-stock.test.ts` reads `spec.md`, and `ch-type-corpus.test.ts` hashes fixtures. No test relies on `Function.prototype.toString` or stack lines. No `html`, `css` or `graphql` tagged templates exist, so Prettier's embedded formatting changes nothing.

**Open questions.**
- `arrowParens` is not set by the brief. The trial used Prettier's default, `always`. Package sources are written as `x =>` (396 matching lines, 0 as `(x) =>`), while docs Markdown examples are `(x) =>` (192 against 6). Recommended: `avoid`, which leaves lambdas as written. B1 uses `avoid` unless the orchestrator says otherwise, and B3 remeasures.
- `examples/first-query.ts`, `test/workspace.test.ts` and the root `vitest*.ts` configs are outside the brief's scope. They stay unformatted unless the orchestrator extends it.

**Trial traps.**
1. Two directives break, because the statement wraps and the error moves off the next line: `packages/core/test/greatest-review.test.ts:22` and `test/types/insert.ts:25` ("read operations remove insertion"). A `// prettier-ignore` line directly above the directive holds the layout (probed on samples, not on these two files).
2. Prettier is not idempotent in one pass: after the first `--write`, 3 files still differ (`insert-types.test.ts`, `rewrite-expressions.ts`, `query.integration.ts`). The second pass is stable.
3. `packages/compiler/test/validation-arbitrary.ts:23` has an `eslint-disable-next-line` for a rule that is not loaded, so ESLint exits 1 (`Definition for rule ... was not found`). `linterOptions.noInlineConfig: true` should avoid this without editing the test; this was not run.
4. Byte comparison of `dist` cannot work: esbuild keeps literal line breaks (1371 of 2708 lines differ in core `index.js`), and the codegen chunk filename contains a content hash. This comparison showed no differences: JS through esbuild `minifyWhitespace` with `chunk-[A-Z0-9]+` normalized, and `.d.ts` by TypeScript AST with parenthesized nodes unwrapped (core `index.d.ts` changes `typeof x[number]` to `(typeof x)[number]`).
5. The stock padding rule has no top-level scope, and the `export` selector separates exported overload signatures from their implementation (`catalog/projection.ts:111`), even with a `function-overload` allowance.
6. `check-type-performance.slice3c.test.mjs` requires `ci.yml` steps 1 to 3 to equal `type-budget.yml`, so a new CI step must come after `pnpm install`.

**Where `format:check` goes.**
- `project.json`: new target `check-format` with `dependsOn: []` and `cache: true`, and `check-testcontainers-port-patch.dependsOn: ["check-format"]`. It then runs first in `check:all`.
- `package.json`: prefix `check:all:uncached-baseline` with `pnpm format:check &&`.
- `.github/workflows/ci.yml`: `- run: pnpm format:check` right after `pnpm install --frozen-lockfile` and before the `dlx tsc` step, so it fails before the slower steps.

**Metrics.** Measure with one definition: split on `\n`, drop the empty string after the final newline, blank means whitespace only, over 120 means `length > 120`.

| File | Before: lines, blank, over 120 | Trial, Prettier only: blank | Trial, ESLint and Prettier: lines, blank, over 120 |
|---|---|---|---|
| `packages/core/src/query.ts` | 468, 0.2%, 10.9% | 0.1% | 868, 9.9%, 0.0% |
| `packages/compiler/src/resolve.ts` | 183, 2.7%, 10.9% | 1.7% | 339, 12.4%, 0.0% |
| `packages/core/src/subquery.ts` | 95, 6.3%, 17.9% | 3.1% | 204, 9.3%, 0.0% |

**Trial results, ESLint and Prettier over 315 files.** Built JS and `.d.ts` equivalent under trap 4. `pnpm test`: 1442 passed, 1 skipped. `pnpm typecheck`: only the 2 directive breaks from trap 1 (4 errors). From the Prettier-only stage: `verify:expr-surface` (409 diagnostics), `verify:core-package`, `verify:query-package` (includes corpus snapshots), `verify:codegen-package`, `verify:type-corpus`, `verify:fixture-seed`, docs `test:example-format` and `test:readme-examples`, and `check-type-performance.mjs` on 5.8.3 all pass.

**Not run in the trial:** `check:all`, integration tests, TypeScript 5.5.4 and latest, `docs:verify`, `slice3c.test.mjs`, the `prettier-ignore` fix in place, and the `--self-test` of `check-type-performance.mjs` (it exited 0 in under a second, so it is not counted as evidence).

### B8 coverage review (PM, independent of the Worker and Tester runs)

| Task | Status | Evidence |
|---|---|---|
| B1 | Done | Exact pins, `prettier` 3.9.10 as in `apps/docs`. Frozen lockfile check passes on a copy of the manifests. ESLint config loads exactly two rules, with inline config off. No excluded path appears in the diff |
| B2 | Done | PM rerun: `format:check` clean, exit 1 on a Prettier deviation and on removed blank lines. From b49e052 one `pnpm format` takes 2 passes; a second run changes no bytes. Wiring is in `project.json`, `package.json` and `ci.yml`. `slice3c.test.mjs`: 45 of 45 pass |
| B3 | Done | Metrics below. Built `dist` equal to b49e052 under trap 4's comparison, all five packages, including the codegen chunk |
| B4 | Done | Failing checks shown for `negative`, `bench`, both generators, snapshots, `corpus-types.ts`, `expr-methods.generated.*`, and fixtures via `inputHash`, `codegen` snapshots. See the limit below |
| B5 | Done | No test expectation changed. 309 files tree-equal under `strict-ast.mjs` and under a separate PM comparator, with `// prettier-ignore` as the only comment change (2 lines). 1442 passed and 1 skipped unit, 374 compiler integration, 8 codegen integration: same counts as before |
| B6 | Done before merge; final run pending | `check:all --skip-nx-cache` on 5.5.4 and latest, CI `tsc` on both, `docs:verify`, `check-type-performance.mjs --all`, diagnostics on 5.5.4, 5.8.3 and latest (409 each): all exit 0. `budget.json` unchanged |
| B7 | Done, with limits below | Steps are in `CLAUDE.md`. Scratch clone of `studio`: no files lost, unit results identical before and after (2108 tests) |
| B8 | Review done; commits and rerun pending | This section |

**Metrics, measured by the PM on the actual tree.** The floor was 8% blank lines and 0% over 120 columns.

| File | Before: lines, blank, over 120 | After: lines, blank, over 120 |
|---|---|---|
| `packages/core/src/query.ts` | 468, 0.2%, 10.9% | 885, 11.6%, 0.0% |
| `packages/compiler/src/resolve.ts` | 183, 2.7%, 10.9% | 365, 19.5%, 0.0% |
| `packages/core/src/subquery.ts` | 95, 6.3%, 17.9% | 216, 14.4%, 0.0% |

**Reproducibility.** b49e052 plus the tooling files and the two `// prettier-ignore` lines, then `pnpm format`, gives exactly the current tree, by recursive diff. So the tooling commit must carry those two lines: `prettier-ignore` does not unwrap a statement that is already wrapped.

**PM checks.**
- The separate comparator caught 19 of 19 deliberate changes. It treats Prettier's JSX `{' '}` as the same space as literal JSX text, which is the only such case (`Playground.tsx`, 1 line); `strict-ast.mjs` normalizes this too.
- `strict-ast.mjs` is the cited Tester tool. The earlier `ast-compare.mjs` is not evidence: it missed 12 of 18 deliberate changes.
- `sha-pre.txt` equals `sha-post.txt`, so the tree did not change during the gates. Since then only `.gitignore` and `CLAUDE.md` changed (`context.local.md` is a symlink to `CLAUDE.md`). `format:check` and `slice3c` were rerun after those edits; `check:all` was not.
- Corrected `CLAUDE.md` step 5 was run with its exact commands on a toy repo with a deleted file, a renamed file and a newly excluded file: nothing lost, and `git diff <step 4 commit> HEAD` is empty.

**Accepted limits.**
- A single-line `abstract class` after a statement is not padded (0 in the tree).
- The multi-line `declare function` at `test/types/expressions.ts:73` is not padded (1 case).
- The tooling commit alone fails `format:check` until the rewrite follows it, by design of the two-commit split.

**B4 limit.** Some exclusions are not proven by a failing check. Formatting `apps/docs/src/playground/generated/` and `apps/docs/src/examples/` passes their checks; they stay excluded as generated output and public content. Prettier leaves `components-latest-corpus.ts`, `known-functions-corpus.ts`, `projection-enrichment-corpus.ts` and `sql-snippets-corpus.ts` unchanged today, so they could not be tested; they are compared byte for byte, the same way as `corpus-types.ts`.

**B7 limits.** The lockfile instructions in step 2 come from a Tester observation of `--no-frozen-lockfile`; the Worker rehearsed only the corrected git steps. `synth.result`, which predates the correction, shows the old step 5 keeping a renamed file's old path, which is why step 5 now uses `git rm`. Step 5's "merge completed by itself" path was not exercised.

**Scope decisions applied.** `arrowParens: avoid` was the B1 default for the open question; no other answer is on record. `examples/first-query.ts`, `test/workspace.test.ts` and the root `vitest*.ts` configs stay unformatted. `quoteProps: preserve` and `embeddedLanguageFormatting: off` go beyond the brief's three options; both exist to keep formatting from changing code.

**Open gap (non-blocking).** `CLAUDE.md` "Formatting" says everything on its list is excluded "because a check depends on their exact bytes or lines". The B4 limit shows that is not true of `apps/docs/src/playground/generated/` or `apps/docs/src/examples/`.

**Pending after tracks A and C merge.**
1. Run `pnpm format`, then confirm a second run changes nothing.
2. Run `pnpm typecheck`. Any TS2578 means a `@ts-expect-error` statement from those tracks wrapped: restore it to one line and add `// prettier-ignore`, in the commit before the rewrite.
3. Rerun every B6 gate with `--skip-nx-cache` and remeasure the three files.
4. Add `.git-blame-ignore-revs` once the final SHA exists (orchestrator).

Evidence: `/tmp/claude-1000/-home-fernandohur-repos-typedhouse/d79703c8-d017-4f4e-9171-38806f3ce6e7/scratchpad/track-b/t/r2/` (`gates.result`, `gate-55.log`, `gate-latest.log`, `strict.log`, `rehearse2.result`, `synth.result`) and `t/b4.result`, `t/b4b.result`.

### Tasks

**B1. Tooling and config (Worker). Depends on: none.**
- Root devDependencies pinned exactly: `prettier` 3.9.10 (same version as `apps/docs`), plus `eslint`, `@stylistic/eslint-plugin` and `@typescript-eslint/parser`. Lockfile updated; `pnpm install --frozen-lockfile` passes.
- Prettier config: `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`. Docs `format:examples` still formats at width 60.
- ESLint enables only `@stylistic/padding-line-between-statements` and `@stylistic/lines-between-class-members`. Printing the resolved config shows no other rule. Inline config is disabled, or trap 3 is otherwise solved without editing the test.
- Blank lines appear between top-level declarations, between class members, and around multi-line blocks. Trap 5 is resolved or stated in the handoff.
- Scope is hand-written TS, TSX, JS and MJS in `packages/`, `scripts/`, `apps/docs/` and `test/types/`, minus the exclude list. One source of truth for the list, shown by a check that every excluded path is unchanged by `pnpm format`.

**B2. Scripts and wiring (Worker). Depends on: B1.**
- `pnpm format` and `pnpm format:check` exist. `format:check` is read-only and exits non-zero both on a Prettier deviation and on a missing blank line (show both with a deliberate violation in a scratch copy).
- From an unformatted tree, one `pnpm format` run leaves `format:check` passing (trap 2), and a second run changes no bytes.
- Wired as in "Where `format:check` goes". `node --test scripts/check-type-performance.slice3c.test.mjs` passes.
- `CLAUDE.md` documents both commands and the exclude list's reasons.

**B3. Non-test rewrite and behaviour proof (Worker). Depends on: B2.**
- Runs the formatter on non-test files only; existing tests are left to B5.
- Reports the before and after table above, measured by the stated definition. Each of the three files must reach blank lines of at least 8% and 0% over 120 columns, except lines Prettier cannot break, which are listed. Before values must match the table.
- Equivalence proof of all `packages/*/dist` output per trap 4, including every codegen file. Any difference is a defect.
- `git diff --stat` shows no change to any excluded path, including `test/types/bench/budget.json`.

**B4. Line-sensitivity guard (Tester). Depends on: B2.**
- Formats each exclude-list path class in a scratch copy and confirms that the matching check fails, so that each exclusion's reason is shown independently of this table.
- Reports any exclusion whose check still passes when the path is formatted, since that exclusion may be unnecessary.

**B5. Test-file rewrite (Tester). Depends on: B3.**
- Runs the formatter over test files, including `scripts/*.test.mjs` and `test/types/` in scope.
- Adds only `// prettier-ignore` for the two directives in trap 1, or reports why that fails. No expectation changes.
- Shows formatting only: TypeScript AST of every changed test file is equal to the original, ignoring trivia and parentheses.
- Test counts are unchanged: 1442 passed and 1 skipped unit, 374 compiler integration, unless the baseline run differs.
- `pnpm typecheck` reports no TS2578; `pnpm format:check` passes.

**B6. Full gates (Tester). Depends on: B4, B5.**
- `pnpm check:all` on TypeScript 5.5.4 and latest, `pnpm docs:verify`, and `node scripts/check-type-performance.mjs --all` all pass, with `pnpm build` before type-diagnostic checks.
- `budget.json` is byte-identical and `inputHash` unchanged.
- `node scripts/check-type-diagnostics.mjs` passes on 5.5.4, 5.8.3 and latest.
- Homepage examples render the same source (`apps/docs/src/examples/` has no diff).

**B7. Long-lived branch migration (Worker writes, Tester rehearses). Depends on: B5.**
- Handoff gives exact commands for a branch such as `studio`: commit pending work, merge the tooling commit, run `pnpm format` and commit, then merge the rewrite commit keeping the branch's side, run `pnpm format` again and confirm that `format:check` passes.
- Rehearsed on a scratch clone of `studio` (the `studio` worktree is not touched). Reports conflict count, and shows with `git diff` that no non-formatting change from either side was lost. Records how new paths on the branch, such as `packages/studio`, get covered.

**B8. Commits and final review (Worker commits on request, PM reviews). Depends on: B6, B7.**
- Two commits only when the orchestrator asks: tooling, then mechanical rewrite. No `.git-blame-ignore-revs`.
- Rerunning `pnpm format` on the rewrite commit produces no diff. This is repeated after a trial merge with tracks A and C when the orchestrator has them; any new `@ts-expect-error` that wraps gets the same treatment as trap 1.
- PM checks every task above against the actual diff, and records evidence in this section.

## Animal table in the "Latest value and average" guide (2026-11-05)

**Done.** The guide now builds a table of every animal, adding pagination, sorting, and filtering one section at a time, and ends with a single `getAnimalTable` endpoint.

**Verified.** The guide's final code, extracted from the page, matched a JavaScript oracle on ClickHouse 24.8: 448 page requests, 0 mismatches, across 16 filter sets, every column and direction, and every page. `pnpm docs:verify` passed.

**Noted, not changed.** In this query each `.where` keeps its own SELECT scope, so each filter adds a subquery layer. That is deliberate: per `compiler/select-blocks.md`, filters share a `WHERE` only when both predicates are in the compiler's total fragment and nothing fallible sits below them.

## `.in()` type/runtime mismatches (2026-11-04)

**Done (96ca25a).** Several `.in()`/`.notIn()` receivers typechecked, then threw `unsupported_membership_type` at compile time. Each now either works or is a type error.

- **Now supported:** `LowCardinality` over String, integers, floats, Bool, UUID and FixedString; `FixedString`; `Enum8`/`Enum16`. All may be nullable, and all work with lists and subqueries. List parameters bind to the unwrapped type, for example `Array(FixedString(3))`.
- **Now type errors:** `DateTime64(4..9)`, which decodes as a string and has no parameter encoding; `LowCardinality(Enum)`, which ClickHouse 24.8 refuses to create; a String or FixedString receiver with an Enum set (the server throws); a String receiver with a UUID set.
- **Second bug:** `LowCardinality(Nullable(T))` membership can return NULL, but the runtime type said `Bool`. The core catalog and the compiler resolver now both use `isNullable`.
- **Set families:** FixedString shares the String family, because the server compares them across widths. Enum is its own family, and any Enum compares with any Enum.
- **Stale doc removed:** the JSDoc said non-null UUID lists fail serialization. They have worked since `d10b5fa`.

**Limit kept.** A query annotated as `Query<{...}>` loses its descriptors, so an unsupported column still typechecks and is rejected at compile time.

**Type cost.** `MembershipReceiver` is a closed union on purpose: a recursive first version hit TS2589 on `scalar(totals).in(totals)`. Instantiations rose about 5% on TypeScript 7.0.2 (built 1352341 to 1429658, source 1627373 to 1706544) and stay within the hard budget.

**Also changed.** `CLAUDE.md` now gives `pnpm generate:expr-surface --write`; without the flag the script throws. `check-type-diagnostics.mjs` reads built declarations, so run `pnpm build` first or it reports stale results.

**Evidence.** `check:all` passes on TypeScript 5.5.4 and latest (1442 unit tests passed and 1 skipped, 374 compiler integration tests passed). Precise diagnostics pass on 5.5.4, 5.8.3 and latest. `docs:verify` and `check-type-performance.mjs --all` pass; they last ran before a one-line fix to the stub in `verify-expr-surface.mjs`, which neither uses. Two new native tests cover run and stream, handwritten SQL comparison, NULLs, outer joins, enum names containing `'` and `\`, and FixedString padding. Negative controls in `membership.test.ts`: no LowCardinality unwrap, allowing LowCardinality(Date), a non-nullable result for `LowCardinality(Nullable(T))`, no FixedString/Enum support, allowing LowCardinality(Enum), and Enum in the String family each fail a test. The draft animal-table endpoint's 448 page requests still match a JavaScript oracle with `kind` as `LowCardinality(String)`.

## argMax date versions and the "Latest value and average" guide (2026-11-04)

**Done (uncommitted).** `argMax` and `argMaxIf` now accept a non-null `Date`, `Date32`, `DateTime` or `DateTime64` (precision 0–3) version, so "latest value by date" no longer needs a numeric workaround. New guide `tutorials/latest-and-average.md` joins dogs to per-animal temperature stats using `argMax(agg.value, agg.date)` and `avg`. It is registered in the Guides sidebar and in `compiler-examples.mjs`.

**Scope kept narrow.** Only the version operand widened. Date *values* stay rejected, and `avg`/`quantile` keep their numeric matcher. `Nullable` and `LowCardinality` date versions stay rejected, as wrapped numeric versions already were. `DateTime64(4..9)` stays rejected because it decodes as `string`, not `Date`; the type and runtime checks share that bound.

**Diagnostic wording.** The wider version union makes TypeScript 5.5.4 report `argMax(g.n, max(g.n))` as `not assignable to parameter of type 'ArgMaxVersion'`, the wording TypeScript 7 already used. The call is still rejected, so `z-arg-max.ts` now has one expectation for it.

**Evidence.** `check:all` passes on TypeScript 5.5.4 and latest (1440 unit tests passed and 1 skipped, 372 compiler integration tests passed). Precise diagnostics pass on 5.5.4, 5.8.3 and latest. `docs:verify` passes. `check-type-performance.mjs --all` passes with the budget unchanged. A new native test covers all four date types through `run` and `stream`, including pre-1970 values, and compares with handwritten SQL. The guide's result table and its `avgIf`/`leftJoin` alternatives were run on ClickHouse 24.8. Negative controls in `aggregation.test.ts`: dropping the runtime widening, dropping the precision bound, and leaking `Date` into the shared numeric matcher each fail the new test.

## Round-trip property: inserted rows read back and filter exactly (2026-11-03)

**Done (branch `fix-parameter-roundtrip`).** New property `packages/client/test/roundtrip.integration.ts` covers one column of every type the insert encoder can write. For fast-check rows it checks three things: insert, then read back by id equals the row, then `where(id).where(<column> = <value>)` returns exactly that row for each column (`isNull()` for nulls). It runs through both the optimizing and the naive emitter. Default seed 20261103, 100 runs; override with `TYPEDHOUSE_ROUNDTRIP_SEED` / `_RUNS`. A failure names the differing columns. Idea from the user: a value the types accept must survive insert, read and filter.

**Bugs it found, all fixed:**
1. `DateTime` parameters threw `param_incompatible`, although the types accepted `Date`. They now use the `DateTime64` UTC path: UTC seconds text, a `DateTime('UTC')` wire type, then `CAST` to the declared type. The UInt32 range is checked before transport. Commit `fix(compiler): accept Date parameters for DateTime columns`, with `datetime-params.integration.ts` running under session_timezone America/New_York.
2–5. `UUID`, `Date32`, `Decimal(p, s)` and `Enum` parameters threw `param_incompatible`. Each is now strictly validated: canonical UUID text; the UTC day within 1900..2299; exact decimal text that fits p/s (never rounded); a declared enum name. Array forms are quoted where needed.
6. The sign of zero was lost on insert: `JSON.stringify(-0)` gives `"0"`. Inserts now send `"-0"`. Parameters still send `0`, deliberately: existing quantile tests pin `String(level)`, `-0 = 0` in filters, and MergeTree normalizes anyway.
7. Pre-1970 `DateTime64` with a fraction was stored wrong. ClickHouse 24.8 `best_effort` parsing flips the fraction: `1969-12-31T23:59:59.999Z` is stored as -1999 ms. Inserts now send integer ticks as a JSON number, which is exact for 1900..2299 at p = 0..3. The probe showed this exact under both `best_effort` and `basic`.

**Server behavior, documented in `reference/types.md` and pinned by a canary test in the same file:**
- ClickHouse 24.8 float text parsing is not correctly rounded beyond about 10^±22 or for subnormals: 25–40% of such samples are 1 ULP off, and `5e-324` becomes 0. This affects inserts and `{p:Float64}` parameters alike, and `precise_float_parsing` does not help. Values between 1e-6 and 1e15, and prices, had 0 errors in 800 samples. User decision: keep readable SQL; the property generates floats in [1e-6, 1e15] plus ±0, and the canary fails when the server is fixed.
- `MergeTree` stores `-0` as `+0`; `Memory` keeps it.
- `Float32` decodes to its shortest identifying decimal. The property compares `Math.fround(read)`, which is the stored float32 exactly. Changing the decoder to return the fround value would show `0.10000000149011612` for `0.1`.

**Kept rejected:** `LowCardinality(...)` parameters over the newly supported types (DateTime, Date32, UUID, Decimal, Enum), as before; ClickHouse gates those LowCardinality types. `slice4e-adversarial` had pinned the old "Enum8/Decimal/UUID fallbacks are param_incompatible" behavior; it was updated to the new serialization, and IPv4 is still rejected.

**Noticed, not changed:** filters on UUID/Date32/Decimal/Enum columns are not merged by the optimizer. Each nests its own `SELECT`. This is correct output, but an optimization gap.

**Evidence.** The property passes with seeds 42, 7 and 2026 at 300 runs each (about 135 s per seed). Negative controls: removing the DateTime parameter branch fails it with `param_incompatible: DateTime`; reverting DateTime64 inserts to ISO text fails it with `dt64ms: wrote 1966-03-04T19:18:44.999Z, read 1966-03-04T19:18:43.001Z`. New unit tests: `parameter-types.test.ts`, `date.test.ts`, `encode-insert.test.ts`. Type tests: `Date` is accepted, and date strings are rejected for Date/DateTime/DateTime64. Full gates: see the commit message.

## Docs homepage: recognizable first example (2026-11-03)

**Done (uncommitted).** The hero and first tab are now a web-analytics query: "top pages this month" over `page_views` (`date`, `path`, `visitorId`), with `count()` + `uniq()` and a `{p0:Date}` parameter. The hero window now also shows the row type (`{ path: string; views: bigint; visitors: bigint }[]`). Tenant filtering is gone from every example; row-level security is the right tool for that. Filter, Compose and Join now use an `orders` table and a reusable `paid` rule. The Join example declares an expression helper, `isEnterprise = (c: Row<Infer<typeof customers>>) => c.plan.eq('enterprise').and(c.active)`, and the compiler pushes the combined `plan = {p1:String} AND active` into the customers subquery. The Aggregate tab was dropped; Top pages covers grouping.

**Fixed since (see "Round-trip property" above): a `DateTime` parameter type/runtime mismatch.** `col.DateTime()` decodes as `Date`, and TypeScript accepts `r.ts.ge(new Date(...))`. But `compile` throws `param_incompatible: DateTime`, because `serializeParameter` (`packages/compiler/src/parameters.ts`) only converts a `Date` for `Date` and `DateTime64(p <= 3)`. Reproduced with a scoped `tsc` (exit 0) plus `compile()` on the built packages. Fix it in the compiler (serialize as UTC `YYYY-MM-DD hh:mm:ss`), or reject it in the types, with runtime, native and type tests.

**Not stale: the composition guide's nested SQL.** `tutorials/composition.md` is current: `test:guide-examples` compiles from `packages/compiler/src`. The nesting comes from the rename `map(e => ({ eventId: e.id }))`; ORDER BY/LIMIT do not yet fold over a renaming projection. Without the rename the same query compiles to one flat SELECT. This is a possible optimization.

**Evidence.** All four examples type-check (scoped `tsc`, exit 0, with a negative probe confirming coverage). `pnpm --filter @typedhouse/docs check`: 0 errors. `test:site`: 7704 links, panels `top-pages/filter/compose/join`. `test:browser`: 8 passed. All five generated-SQL drift checks pass. Hero and Join tab screenshots show no clipped lines. Plain `tsc -p apps/docs` over `**/*` overflows TypeScript's stack. That is environmental and not caused by these files; `astro check` is the gate.

## Docs site: redesign with reusable components (2026-11-03)

**Done (branch `site-redesign`, uncommitted).** New visual design for the docs site, inspired by ellf.ai's colors, type and layout, with code examples in the style of react.dev (TypeScript beside the SQL it compiles to). Night (aubergine) header, hero and footer in every mode; lavender-tinted paper surfaces; Bricolage Grotesque / Inter / JetBrains Mono from Google Fonts. All colors are tokens in `apps/docs/src/styles/tokens.css` (light, dark and `.on-night`).

- **Components** (`apps/docs/src/components/site/`): `Logo`, `Button` (primary/secondary/ghost), `Icon`, `Fonts`, `AnnouncementBar`, `SiteHeader` (owns the theme picker script), `SiteFooter`, `Section` (paper/night tone, slanted edge), `SectionHeading`, `Code`, `CodeWindow`, `CompileExample` (split/stacked), `ExampleTabs` (WAI-ARIA tabs; every example shows without JS), `Feature`, `GuideList`. `layouts/Site.astro` composes them; `bleed` opts a page out of the centered column.
- **Examples are real compiler output.** `src/lib/examples.ts` `compileExample()` compiles each example at build time: SQL (sql-formatter), params, a row type from `rel.output` + `toTypeScript`, and a playground link carrying the exact file. The snippet shown is the `// #region example` part. Homepage examples live in `src/examples/home/{filter,compose,aggregate,join}.ts` (replacing `src/examples/homepage.ts`), registered with their notes in `home/index.ts`.
- **One highlighter** (`src/lib/highlight.ts`) for TS/SQL/JSON. JS string values, SQL `{pN:Type}` parameters and JSON param values share the `--tk-val` color, so a value can be traced from TypeScript into SQL. Inlined numbers (e.g. `LIMIT 10`) are deliberately not that color.
- **Starlight**: `docs.css` maps `--sl-*` onto the tokens; the header gets a night palette; the logo is `src/assets/logo.svg` (favicon recolored). Expressive Code uses `src/styles/code-themes.mjs` (mirrors `--tk-*`). Playground primary button and radius moved to the brand color.
- **Gotcha:** after changing Expressive Code themes, delete `apps/docs/.astro/data-store.json` and `apps/docs/node_modules/.astro/data-store.json`. The content cache otherwise keeps a stale `ec.*.css` link, which `test:site` reports as a broken link. Clean CI checkouts are unaffected.

**Evidence.** `pnpm --filter @typedhouse/docs check`: 0 errors, 0 warnings, 0 hints. `pnpm docs:build` then `test:site`: 7357 internal links verified. `test-site.mjs` now asserts 5 homepage sections, one playground link per example decoding to that exact file, all four tab panels and `{p0:String}`. `test:browser`: 8 passed. Manual Playwright screenshots (homepage light/dark at 1440, mobile at 390 with no horizontal overflow, docs light/dark, playground, blog): no page errors. Tab click and arrow-key wrap verified. Not run: the rest of `docs:verify` (README/guide/function example checks; no markdown content changed), and `check:all`.

# Current work

## Upstream Decimal wire settings

Merged the shared `outputSettings` constant and native exact-Decimal regression from `12d1792`. Local decoding already supports branded decimal strings; the upstream historical `decode_unsupported` note does not apply to this merged client. SELECT requests retain quoted Decimal/64-bit values, quoted denormals and ISO dates.

Merge acceptance against `origin/master` at `9cb89d5`: `pnpm install --frozen-lockfile` and uncached `NX_DAEMON=false pnpm check:all --skip-nx-cache` passed, including 366 compiler/client native tests. Full `pnpm docs:verify` passed with all 8 browser tests on isolated port 14329. Logs: `/tmp/typedhouse-merge-inserts-check.log` and `/tmp/typedhouse-merge-inserts-docs.log`.


Keep this file focused on open tasks and the latest relevant verification. Completed-task history belongs in git, not an append-only log. API contracts and settled design decisions live in [spec.md](spec.md), especially “Decided, and still open”; documentation requirements live in [docs.spec.md](docs.spec.md).

## Owner-approved scope decisions

- **M5 error contract:** error-to-IR attribution is no longer required. Client execution errors retain emitted SQL, parameters and the original driver error (`cause`); identifying or exposing an offending IR node/path is not an acceptance requirement. This supersedes the original M5 attribution requirement without changing `spec.md`. The existing `QueryError.node` root reference is not meaningful attribution; removing that public field is a separate API cleanup, not implemented by this scope decision.

## Progress through M6

Estimates carried forward from `1e84bec`, now synced with `origin/master` at `a5360bc` (not rescored after the sync), not formal milestone acceptance or estimates of time remaining. Percentages describe implemented scope and verification coverage; the total is an equal-weight average, not an effort-weighted forecast. M7–M8 are excluded.

| Milestone | Estimated complete | Status / remaining work |
| --- | ---: | --- |
| M1 — ClickHouse types and TS mapping | 100% | Accepted foundation; real corpus, parser/printer, mappings and regression gates implemented. |
| M2 — Codegen CLI | 100% | Live generation/check, schema/functions snapshots and stale detection implemented and tested. Upstream hidden-column metadata is integrated and passed combined codegen checks. |
| M3 — Builder, IR, naive emitter | 95% | Broad end-to-end API, joins, aggregates/subqueries, six type gates and permanent naive emitter implemented. Finish the current-spec/example and future-engine-constraint audit. |
| M4 — Rewrites and flat emitter | 90% | Rewrites, 500-case differentials, exact lowStock and EXPLAIN corpus implemented. Hidden-alias fixes are integrated and passed combined validation; projection-folding/EXPLAIN follow-ups remain. Upstream records M4 closure, but that does not validate this divergent local candidate. |
| M5 — Client run, stream, errors | 90% | Driver-backed execution, conversions, caching and 10M-row memory checks pass. Error-to-IR attribution is no longer required by the owner-approved scope above; final integrated acceptance remains pending. |
| M6 — Hardening | 85% | Malformed-IR/property tests, 500 mutation recipes, exact diagnostics, shrinking/replay and adversarial coverage exist. Remaining work is a systematic current-contract coverage audit and final integrated acceptance; the scheduled 10k differential workflow is still absent locally. |
| **Total through M6** | **~93%** | **Strong implementation coverage; not yet a fully integrated, accepted v1 release.** |

Latest hosted status observed: upstream master run `41469787715` passed; newer dependency-upgrade run `41475329636` was still running. Upstream's M4 closure records four consecutive green master runs (`41461412891`, `41462576854`, `41463998696`, `41464751452`). These runs do not include the current local merge and uncommitted changes.

## Simple insert scope extension — local verification

- Implemented `from(table).insertMany(rows)` and `client.execute(command)`, exact writable/defaulted row types, immutable snapshots, optional backend writes, validated JSONEachRow encoding and insert-specific errors. Supported descriptor/value policies are in `spec.md`; no automatic retries.
- ClickHouse 24.8 dependent-default regression is guarded with one-row parser blocks only for heterogeneous supplied-column sets. Homogeneous omissions retain normal bulk throughput. Native MergeTree regressions cover 8,193-row batches, zero/null and transitive defaults.
- Final `pnpm check:all` passed uncached: 1,432 unit tests (one skipped), 8 codegen integration tests, 365 compiler/client integration tests including 8 insert cases; typecheck, builds, package consumers, precise diagnostics and corpus gates passed. `node scripts/check-type-performance.mjs --all` passed unchanged instantiation budgets for TypeScript 5.5.4, 5.8.3 and 7.0.2; declaration corpus/insert diagnostic checks also passed across those versions. Full integration gate was run on the default compiler, not all three versions.
- Independently reviewed; no confirmed correctness blockers. Mixed-presence default batches remain slower by design. Not published.

## Open tasks

- [ ] **Verify the synced candidate in hosted CI / the remaining TS matrix.** Sync with `origin/master` at `a5360bc` passed the default local full gate. Includes hidden-alias guards/codegen, CI-aware query limits/prefetch, release tooling and dependency upgrades; preserves local Nx, devtools, driver-first conversions, SQL snippets and advisory wall policy. The upstream CI fix supersedes the local one-thread/20-second workaround.
- [ ] **Finish safe projection-consumer folding.** Reconcile the reviewed LIMIT work from `.worktrees/optimizer-followups` against the merged compiler; `.worktrees/limit-folding-final` is a separate integration worktree. Sort/Limit/Aggregate folding requires proof of safe alias substitution and preserved evaluation sets. Do not remove conservative guards wholesale or claim unmerged work is complete.
- [ ] **Close EXPLAIN proof gaps.** Replace consumer-kind blanket exceptions with independently justified boundaries; fail closed on unparsed header dependencies; match read budgets to table occurrences rather than any demand for the same table. Add injected negative controls. Existing EXPLAIN passes do not establish these stronger claims.
- [ ] **Reconcile upstream M4 closure with the local candidate.** Upstream now records the required consecutive green CI runs. Integrate/review the newer fixes, resolve local proof gaps, then verify this combined candidate on both TypeScript matrix jobs (5.5.4 and latest), retaining per-file integration timings. Preserve the 500-case naive/optimized differential, byte-exact lowStock SQL/params and EXPLAIN requirements.
- [x] **Reconcile DateTime parameter work.** Closed 2026-11-03: `.worktrees/datetime-parameters` no longer exists, and no branch, local or remote, or commit carries it. DateTime parameters were implemented fresh; see "Round-trip property" at the top.
- [ ] **Audit remaining v1 acceptance against the current spec.** The former milestone ledger was a stale scaffold-era snapshot. Green scoped gates are not a declaration that milestones 1–6 are complete. In particular, reconcile hardening/property coverage and the specified scheduled 10k differential campaign (no nightly workflow currently exists).

## Latest verification

### Latest master sync — local full gate passed

Merged `a5360bc` into the local line. `pnpm install --frozen-lockfile` and uncached `NX_DAEMON=false pnpm check:all --skip-nx-cache` pass: **1,354 unit tests** (one existing skip), **8 codegen integration tests**, **351 compiler/client integration tests**, plus type/corpus/build/package/fixture checks; full gate took **5m31s**. No fresh 5.5.4/latest matrix claimed. Log: `/tmp/typedhouse-sync-acceptance.log`.

Merge-specific test repairs: copied native-generated descriptor data into the Vitest realm before source-compiler use (strict plain-object validation unchanged); updated only the new skip-alias snapshot's Map comment/hash. Initial codegen failures are retained in `/tmp/typedhouse-sync-check-all.log`. One full-gate attempt was interrupted by the tool's four-minute timeout; the later complete run used a longer limit.

Docs checks/build/static links passed; the concurrent docs run had one browser navigation-context failure. A separate browser run passed all **8 tests**; no production/browser-test change or proven root-cause claim. Logs: `/tmp/typedhouse-sync-docs.log`, `/tmp/typedhouse-sync-browser.log`. The pre-sync stash is retained as a recovery copy; `.playwright-cli/` is untouched. No push performed.

### Specification reconciliation

Updated `spec.md` to reflect approved driver-conversion/Map scope, trusted scalar SQL instead of removed extension APIs, advisory wall budgets, results-only differential semantics and retained rewrite safety guards. EXPLAIN, nightly and hardening requirements remain open. The later owner-approved error-attribution scope decision is recorded above. Documentation-only validation: `git diff --check`; no runtime or full-gate rerun.

### CI aggregate/Union timeout fix — local workaround superseded by upstream

- Failed GitHub run: `41444598788`, seed `20261118`, path `37`, ClickHouse code 159: **10.4066 s > 10 s**. This was a server query timeout, not a result mismatch or Vitest timeout. Resource contention is plausible, not proven.
- Before the edit, the local path-37 replay passed.
- After the edit, `CI=true pnpm exec vitest run --config vitest.compiler.config.ts packages/client/test/aggregate-union.integration.ts packages/client/test/fixture-differential.integration.ts` passed **12 tests**, with two workers, in **56 s**. The full 500-case aggregate/Union campaign took **19.759 s**.
- Log: `/tmp/typedhouse-ci-fix.log`. No full gate or hosted CI acceptance is claimed for this edit.

### Upstream merge — accepted and committed as `1e84bec`

Merged upstream `0648176` with local compiler/client/devtools work. The isolated acceptance candidate excluded the separate CI timeout/thread edit above.

Recorded acceptance:
- Uncached full gates passed on official TypeScript **5.8.3 / 5.5.4 / 7.0.2**: **1,307 unit**, **342 compiler/client native**, and **7 codegen native** tests per version; one existing unit skip.
- Nonincremental roots and **371 source/built precise negatives** passed per version.
- Full docs verification passed, including **8 browser tests**.
- Actual **10,000,000-row** streams produced checksum **49,999,995,000,000**, with peak heaps below **200 MB**.
- Performance policy self-test and **45 CLI probes** passed. Instantiation ceilings remain hard; wall-time comparisons are advisory on every host class. Measurements, reference ceilings, input hashes and malformed-metric/compiler failures remain enforced as applicable; no baseline or limit was raised.
- Evidence: `/tmp/chql-merge-evidence/`. These are recorded acceptance results, not checks rerun during TODO cleanup.

## Scope decisions to retain

- **Error semantics:** the spec's results-only contract governs optimization. Naive success requires identical optimized rows/types and no new failure. If naive fails, optimized execution may fail or return guard-first-oracle rows. Existing stronger regression checks and fallible-expression fences remain; this is not blanket permission to remove them.
- **Client conversions:** rely on the official driver's parsing/streaming plus the small compatibility adapter. Preserve supported bigint and Date conversions, including supported array/tuple recursion. Decimal values remain exact strings with the quoting setting; Maps retain driver objects and conservative types, not promises of recursively converted contents. A general decoder and separate one-HTTP-chunk proof are outside the owner-approved scope; the 10M-row memory gate remains.
- **Extension surface:** removed custom-function extension APIs stay removed. Use the supported generated catalog and trusted SQL snippets; do not revive historical extension designs from old notes.
- **Outer joins:** descriptor-faithful outer joins and null-rejection work arrived in the upstream merge; older “inner/cross only” deferrals are obsolete. Preserve current type/native contracts rather than reusing the superseded brief.
- **Deferred milestones:** real temporary-table materialization and incremental/live execution remain outside v1 (milestones 7–8). Ordinary CTE materialization behavior is not implementation of those deferred features.

## Updating this file

Replace an item's status when it changes; remove completed items once their evidence is no longer needed for pending acceptance. Keep only concise verification summaries and explicit remaining gaps. Do not append worker transcripts, repeated review rounds, full SQL payloads or superseded blockers.
