## Track D: `-State`/`-Merge`, `SETTINGS`, `ASOF JOIN`, `WITH FILL`, `OVER` (2026-11-05, PM)

**Status.** D1 to D11 and D21 are accepted by the PM; see the acceptance sections at the end of this track. D12 to D19 run in parallel worktrees: `with-fill` stacked on `five-keywords`, `over` stacked on `with-fill`, rebased by the orchestrator at each landing. Q1 to Q7 are recorded under Decisions; orchestrator rulings stay open to the owner's objection. Build order is the owner's. Line numbers are at master `cd59ba9`.

Facts below were measured on `clickhouse/clickhouse-server:24.8` (24.8.14.39) unless stated. The minimum-version checks ran on 24.3.18.7 and cover only what the 24.3 notes name. The SQL in the API proposals was run on 24.8 by hand; a compiler does not emit it yet, so the exact text is a target.

**Confirmed on master, through the built packages.** A descriptor with an `AggregateFunction` column fails `from(s).count()`, `from(s).map(...)` and `agg.uniqMerge(...)` with `aggregate_state_selection at root.input`. `sumMerge` and `sumState` fail with `unsupported_aggregate_combinator`. The cause of the first is `emit-naive.ts:840`, which checks every node's output instead of the query's result.

### Design note: `-State` and `-Merge`

**Server behaviour.**
- A raw state returned to the client is binary in a JSON string, and invalid UTF-8 is lost: `uniqState` output contained U+FFFD. Raw selection at the result stays rejected.
- States pass through subqueries, CTEs, `UNION ALL` and join inputs. An unmatched row of an ordinary `LEFT` join keeps the default state and merges to 0; `ASOF LEFT` was not measured with a state, so D10 covers it.
- The `-Merge` result matches the base function: `sum(UInt32)` gives `UInt64`, `sum(Nullable(UInt32))` gives `Nullable(UInt64)`, `sum(Decimal(18, 2))` gives `Decimal(38, 2)`, `avg` gives `Float64`.
- On empty input: `sumMerge` 0, `countMerge` 0, `maxMerge(Nullable)` NULL, `avgMerge` NaN, `uniqMerge` 0.
- A state's type drops `LowCardinality`: `maxState(LowCardinality(String))` is `AggregateFunction(max, String)`, and `LowCardinality(Nullable(String))` gives `AggregateFunction(max, Nullable(String))`. `aggregateCall` copies the argument type unchanged, so it disagrees with the server. Fix this in both runtime and types.
- Parametric states carry the level in the type: `AggregateFunction(quantile(0.9), Float64)`. **`-Merge` ignores the stored level.** A state built at 0.9 gave 90 from `quantileMerge(0.9)`, 10 from `quantileMerge(0.1)`, and 50 from `quantileMerge` with no level. So `quantileMerge` must take a level, like `quantile`, and the docs must say the merge level decides.
- `sumStateIf` gives `AggregateFunction(sum, UInt64)`, which `sumMerge` accepts. `sumIfState` gives `AggregateFunction(sumIf, UInt64, UInt8)`, which `sumMerge` rejects with code 42. Any later `If` combination must use the `StateIf` order.
- The server accepts things the row model should not: `WHERE total = total`, `ORDER BY total`, `GROUP BY total`, `DISTINCT` over a state and `uniqExact(total)`. Their results depend on binary state contents. `max(total)` and `sum(total)` raise code 43.
- Reading a materialized view's `TO` table, the view itself, `FINAL` and `PREWHERE` over a rollup all merge correctly. `finalizeAggregation(total)` returns per-row values before merging; the rollup had 3 rows for 2 days.
- `sumMerge(total) AS total ... HAVING total > 0` raises code 43 under `prefer_column_name_to_alias = 1`. The existing alias guard in the Aggregate arm fences this; D3 pins it, because this name collision is the normal case for rollups.

**Corrections, reported by the Worker. Confirmed: Tester's native tests pass in the PM's run, and the PM reproduced each by hand on 24.8.14.** Where these differ from the bullets above, these take precedence.
- "`-Merge` ignores the stored level" holds only for non-Nullable states. `quantileState(0.9)(Nullable(UInt32))` merged at another level or none raises code 43. A mismatch now raises `invalid_merge_state`.
- `LowCardinality` is dropped at every depth, and from `SimpleAggregateFunction(max, LowCardinality(String))`.
- Parameterized level 1 renders as `quantile(1.)`, so a union of a `quantile(1)` column with a fresh state at level 1 fails closed with `union_descriptor_mismatch`.
- `agg.uniqMerge` is not in generated catalogs, because `system.functions` has no combinator names. It works only through a handwritten catalog entry.

**Rule.** `aggregate_state_selection` applies only to the query result and to a `Subquery` result. Intermediate nodes may carry states. A typed expression, sort key, `LIMIT BY` key, group key or nested `Distinct` that reads a state raises a new `aggregate_state_operand`, except a `-Merge` of the same function. Known-tier calls stay exempt: their result is the caller's declaration.

**Passes.** `rewrite-rel`: no change. `totalAggregate` and `safeAggregate` already refuse combinators, so `HAVING` key push-down and join rules are fenced conservatively. `prune-columns`: no change, and pruning already removes unread states. `plan-selects`: no change. `emit-naive`: move the check, and add `State`/`Merge` to the aggregate name. `resolve.ts`: accept `['State']` and `['Merge']`, and recompute the result from `state.args`. Client: `decoder` keeps refusing `AggregateFunction` (`decode.test.ts:116`). Codegen: renders states already; add a parametric test.

### Design note: `SETTINGS`

**Server behaviour.**
- A tail `SETTINGS` applies to subqueries, CTEs and every `UNION ALL` branch in the shape the compiler emits. Only a parenthesized union ignores it (`(SELECT) UNION ALL (SELECT) SETTINGS` kept the default); the compiler does not emit that. `UNION DISTINCT` holds too, from a hand-built node (`settings-native.integration.ts`).
- SQL `SETTINGS` overrides HTTP parameters: `?join_use_nulls=0` with `SETTINGS join_use_nulls=1` reads true. A repeated key takes the last value.
- `SETTINGS x = {p:UInt32}` is a syntax error, so values must be literals, like `LIMIT`. `log_comment = 'x''y'` round-trips, so strings need the existing escaper.
- `readonly = 1` rejects any change with code 164, as it already does for the emitted `join_use_nulls`. `readonly = 2` accepts it.
- Open settings break the row contract, all measured: `limit=2` and `offset=2` drop rows; `final=1` changes a count from 4 to 2; `aggregate_functions_null_for_empty=1` changes `sum` to `Nullable`; `group_by_use_nulls=1` changes a key type; `date_time_output_format` and `output_format_json_quote_64bit_integers=0` break the decoder, and win over the client's `outputSettings`; `result_overflow_mode`, `read_overflow_mode` and `timeout_overflow_mode` set to `break` return partial results with no error.
- Resource limits raise codes 158, 159, 307 and 396. The optimized path reads a different amount than the naive path, so a limit can fail on one and not the other (Q2).

**Passes.** None. `compile` and `emitNaive` peel a root `Settings` node before validation and append its settings to the tail. Anywhere below the root raises `invalid_settings_placement`. `Backend.compile(rel)` takes only a `Rel`, and plans are cached by `Rel` identity; a node keeps both true with no `Backend` change. Correction after D6: the client did change, for a general defect that `settings()` exposed; see "D5 to D7 acceptance".

### Design note: `ASOF JOIN`

**Server behaviour.**
- Only `ASOF INNER` and `ASOF LEFT` exist (`RIGHT`/`FULL` code 48). At least one equality is required (code 62) and exactly one inequality (code 403, also when missing). `>=`, `>`, `<=`, `<` all work, on either side and in either position.
- Expressions and parameters work in both: `t.ts - {sec:UInt32} >= q.ts`, `lower(t.sym) = lower(q.sym)`.
- A single-side condition in `ON` is accepted (`q.flag = 1`), and it filters before matching. The builder must not accept it, and must not move a residual above the join as inner joins do, because the two mean different things.
- Inequality types: integers, floats, `Decimal`, `Date`, `Date32`, `DateTime`, `DateTime64`, also `LowCardinality`; mixed temporal pairs compare correctly (`Date`, `Date32`, `DateTime` across zones, `DateTime64` across precisions, all distinguishing values, on 24.3, 24.8 and 26.10). Mixed numeric is partial: `Int32` vs `UInt8` and `Decimal` across scales compare correctly, `UInt32` vs `Float64` worked on one row, and `UInt64` vs `Int64`, `UInt64` vs `Float64`, `Decimal` vs `Float64` and a temporal vs a number raise code 386. `String` raises code 169. **NaN does not behave as a comparison:** `1 >= NaN` and `NaN >= 1` each matched a row, on all three versions.
- `Nullable` works on the inequality and the equality, on both sides; a NULL on either side never matches. It was accepted on 24.3 too. `ASOF LEFT` keeps that left row, with NULLs under `join_use_nulls = 1` and defaults without it. Null-extended types match ordinary `LEFT`, so `joinOutput('left', ...)` applies. CTE and self-join inputs work.
- **A right-side filter does not commute, even for `ASOF INNER`.** `WHERE q.flag = 1` above returned one row; filtering `quotes` first returned two, and matched a different quote. A left-side filter does commute. `EXPLAIN` shows the server pushes neither side below `ASOF`.
- `LeftToInner` is valid on the probed case (same rows), but it adds risk for little gain.
- Ties on `(equalities, inequality)` are unspecified and **not repeatable**. The earlier "first row in the right stream wins" (four equal rows gave 1, `ORDER BY v DESC` on the right gave 4) was a single-part result. Correction, PM measured on 3 parts with 3 tied rows per key, 200 left rows: the same SQL run twice returned different rows on 24.8, 24.3 and 26.10, and changing the right input's columns, nesting, or `max_threads` changes them too. `max_threads = 1` gave the same rows on all three versions in this probe, once each. The count is always 200. So docs must say so, differential tests must use unique right keys, and tie tests can assert only the count and that the chosen row is one of the tied rows.
- `join_algorithm`, correction from the Worker's and Tester's measurements, reproduced by the PM on each version: `partial_merge`, `grace_hash` and `direct` raise code 48 on `ASOF` on 24.3, 24.8 and 26.10. `full_sorting_merge` raises 48 on 24.3 and works on 24.8 and 26.10. `hash`, `parallel_hash` and `auto` work on all three. "`full_sorting_merge` agrees with the default" holds only without ties: with duplicate right `(k, t)` it returned different rows with the same count of 200, which no longer separates it from the default, since the default differs from itself. The default on 26.10 is `direct,parallel_hash,hash,ie_join`. `join_algorithm` stays out of the settings allowlist, but a client or profile can set it: a code 48 then surfaces as `QueryError`, on both paths, with no compiler check, as for engines in Track C.

**IR.** `Join` gains `strictness?: 'asof'`, with the inequality as the last element of `on`. Every walker (`edges`, `references`, prune, `plan-ctes`, rebinding, `visit`) then works unchanged, and `nullExtended` keeps working on `joinKind`.

**Passes.** `rewrite-rel`: `LeftToInner` skips `asof`, and `PushFilterJoin` admits only the left input. `prune-columns`: none, since keys are in `on`. `plan-selects`: none. `emit-naive`: keywords `ASOF INNER JOIN`/`ASOF LEFT JOIN`, the inequality in the ON text, and `validate` (`inner`/`left` only, binary, last `on` element an inequality with one alias on each side, `invalid_asof_condition`, `invalid_asof_type`).

### Design note: `WITH FILL`

**Server behaviour.**
- Order of operations: `WHERE`, then fill, then `LIMIT BY`, then `LIMIT`. Filled rows count toward both limits. An outer filter sees them: `(... WITH FILL) WHERE d >= x` kept a filled row that the folded `WHERE d >= x ... WITH FILL` lost. The server does not push across it (also with `query_plan_filter_push_down = 0`), and an outer `ORDER BY`, `count()` or `GROUP BY` keeps the filled rows. So nothing folds above a fill except `LIMIT BY` and `LIMIT`.
- Parameters work in `FROM`, `TO`, `STEP` and `INTERVAL {p:Int32} DAY`. 24.3 accepts them too. `FROM '2024-01-01'` is rejected (475), so a typed parameter is required, and `FROM 19000` on a `Date` silently means a day number.
- Key types: integers, floats, `Date`, `Date32`, `DateTime`, `DateTime64`, also `Nullable`. `String`, `LowCardinality(String)` and `Decimal` raise 475, in every form tried for `Decimal`. Bounds must match the key's kind: a `DateTime` bound on a `Date` key, or a fractional step or bound on an integer key, raises 475. A negative bound on an unsigned key raises 475.
- Integer step on a temporal key is unsafe: `DateTime64(3)` `STEP 86400` is 86400 seconds, not milliseconds. `INTERVAL` works on all temporal keys, including `MONTH`. `Date` with `INTERVAL 12 HOUR` raises 475.
- Sign: `ASC` needs a positive step and `FROM <= TO`; `DESC` a negative step and `FROM >= TO`. `STEP 0` raises 475. `DESC` with no step fills downward.
- **`NULLS FIRST` silently disables the fill**, with `ASC` and `DESC`: `ORDER BY nd NULLS FIRST WITH FILL` returned no filled row. `NULLS LAST` and the default fill, with NULLs last.
- Filled rows get type defaults in every non-key column, not a re-evaluation: `v + 1 AS w` is 0, not 1. `Nullable` is NULL, an array `[]`, a `Date` `1970-01-01`. With `sumMerge`, the filled total is 0. **An `Enum` with no zero member fails with code 36** as soon as a filled row reaches output.
- Keys before the fill key form a group (`use_with_fill_by_sorting_prefix = 1` is the default): `ORDER BY k, n WITH FILL` fills per `k` and keeps `k`. A key after it gets the type default. An unselected fill key still produces filled rows. Fill runs on `DISTINCT` output in the same SELECT, and an empty input with `FROM`/`TO` still produces rows.
- There is no upper bound: `TO 2000000000` produced 1999999999 rows under a 100 MB memory limit. Docs must warn.
- `INTERPOLATE (v AS v)` carries the last value; see Q5.

**Version sweep (PM, 2026-11-07).** Every claim above was rerun with `chprobe.py` on 24.3.18, 24.8.14, 25.3.14, 25.8.33, 25.10.7, 26.3.62 and 26.10.3, with the analyzer on (the default) and again with `allow_experimental_analyzer = 0`. `enable_analyzer` is unknown on 24.3, code 115. Tables, tagged with image digests: `/tmp/claude-1000/-home-fernandohur-repos-typedhouse/d8f68019-bf18-4d79-bf40-0d5ca77cb719/scratchpad/probe/fill.md`, `fill-noanalyzer-old.md`; statements in `fill.sql`. Unless a bullet below says otherwise, each claim above held, unchanged, on all seven versions, analyzer on and off: order of operations; outer filters; `LIMIT`, `OFFSET` and `LIMIT BY` counting filled rows; `count`, `ORDER BY` and `GROUP BY` over a nested fill; CTE and `UNION ALL`; empty input; parameters in `FROM`, `TO`, `STEP` and `INTERVAL` (including `DateTime64(3)` parameters); key types and refused types; integer step on `DateTime64(3)` in seconds; `MONTH` steps; sign rules; prefix and trailing keys; filled-row defaults; computed columns as defaults; `INTERPOLATE`; aliases; `max_block_size = 1` and `100`; `max_threads = 1`.
- **Corrected: `NULLS FIRST`.** It disables the fill only without `FROM`. With `FROM`, it fills from the first non-null key and ignores the `FROM` value itself: `nv NULLS FIRST WITH FILL FROM 0` gave `NULL, 1, 2, …` with no 0, and the `Date` case did the same. Neither form is a fill a caller would expect, so the rule refusing `NULLS FIRST` on a fill key stands, now for both reasons.
- **New, version-dependent:** a `DateTime` bound on a `DateTime64` key is accepted on 26.10 and raises 475 on 24.3 to 26.3. The planned type rule (a bound has the key's own kind) refuses it everywhere, so emission never depends on this.
- **New: `STALENESS`** exists from 25.3 (code 62 on 24.3 and 24.8), and its result depends on the analyzer. With the analyzer off, 25.3 to 25.10 omit a trailing filled row and accept `STALENESS` with `FROM`/`TO`, which raises 475 with it on. Not exposed, on the `percent_rank` precedent: absent on the declared minimum.
- **New: parameter types.** A `Nullable(T)` parameter in `FROM` raises 475 on all versions, so a bound on a `Nullable` key binds as `T`. A `Float64` step parameter on a `UInt32` key raises 475; `Int64` bounds on a `UInt32` key and an `Int32` bound on a `Float64` key work. So a step parameter takes the key's family (integer keys: `Int64`, so a negative `DESC` step fits; float keys: `Float64`), and bounds take the key's non-`Nullable` type.
- **New: integer step on a zoned `DateTime` crosses DST.** `STEP 86400` on `DateTime('Europe/Berlin')` gave `12:00`, then `13:00` after the change; `INTERVAL 1 DAY` kept `12:00`. This supports the rule that temporal keys take only `INTERVAL`.
- **New: `Bool` keys fill** (no rows added between `false` and `true`), and a `Float64` key with no step uses step 1. `Bool` stays outside the typed key set: it is not a sensible fill key.
- **Checked: `Enum` with no zero member** raises after output started: code 36 on 24.3 and 24.8, code 691 on 25.3 to 26.3, and 26.10's framing ended the raw HTTP response early. The client's `parsedRow` path handles 26.10's framing (D6).
- **Checked: ties.** With 3 parts, `ORDER BY d WITH FILL LIMIT 3` over tied keys returned different rows between runs on 24.8, the only version where the 5 runs disagreed. With a total order (`d WITH FILL, v`) every version was stable. Differential tests keep the total order.
- **Checked: fill over an outer join.** A null-extended non-key `Tuple` reads `NULL` on filled rows on 26.3 and 26.10 without D21; D21's read wrap covers it.
- **Checked: the guard.** `max_result_rows` counts filled rows (code 396), on every version.

**IR.** `SortKey.fill?: { from?, to?, step? }`, where `from`/`to` are typed `Param`s and `step` is a `Param` plus an optional interval unit. No rewrite rule crosses `Sort` (only Aggregate, Project, Union, ArrayJoin and Join have push rules), the planner's rank opens a new block for a Filter above it, and the Aggregate and Distinct arms already refuse a block with a `Sort` clause. A fill key must be a bare `ColumnRef` (`invalid_fill_key`); computed keys go through `map` first. This avoids the `n + 10 AS n ... ORDER BY n` alias problem, and the probe showed the base column's filled value is a default anyway.

**Passes.** `rewrite-rel`: `edges` and the `Sort` arm of `visit` must include fill parameters. `prune-columns`: fill key demand as for `Sort`; no fill-specific change. `plan-ctes`: `expressions`. `plan-selects`: a `Project` above a fill folds only if it is an identity selection (already the rule); D13 pins that with a test. `emit-naive`: three block renderers plus the naive `ORDER BY`, printing `FROM`, `TO`, `STEP` in that order, and negating the step for `DESC`.

### Design note: `OVER`

**Server behaviour.**
- **A parameter inside the window definition fails with code 456, "Query parameter was not set"**, in `PARTITION BY`, `ORDER BY`, frame offsets and named `WINDOW`, confirmed over HTTP. Parameters in the function's own arguments work (`sum(n + {o})`, `lagInFrame(u, {o}, {d})`, `ntile({o})`, `quantile({l})`). So keys cannot hold JS values, and frame offsets must be inlined like `LIMIT`.
- Placement: `WHERE`, `HAVING`, inside an aggregate and inside another window all raise 184. Folding changes results: `(... row_number() ...) WHERE id > 1` gave ranks 2, 3 where the folded form gave 1, 2. The server does not push even a partition-key filter below the `Window` step (`EXPLAIN`). `LIMIT`, `LIMIT BY`, `ORDER BY` and `DISTINCT` run after windows.
- **A SELECT alias captures names inside `OVER`.** `id AS k, row_number() OVER (PARTITION BY k ...)` partitions by the alias. So items must be qualified.
- Functions: `row_number`, `rank`, `dense_rank`, `ntile` return `UInt64`. `lagInFrame`, `leadInFrame`, `first_value`, `last_value`, `nth_value` return the argument's type. All catalog aggregates and `sumMerge` work, and `sumIf` too. `lag`/`lead` do not exist (code 63). `percent_rank` is absent on 24.3, the declared minimum; `cume_dist` is absent on 24.8.
- Defaults, not NULL: `lagInFrame(u)` on a first row is 0, and over an empty frame `sum` is 0, `max` 0, `avg` NaN, `sum(Nullable)` NULL. `leadInFrame` under the default frame only reaches peers: it returned 0 on every row with a unique order, and the correct value only with an explicit `UNBOUNDED FOLLOWING` frame. Docs must warn.
- `first_value` and `last_value` skip NULLs. `RESPECT NULLS` exists.
- Frames: `ROWS` works with `n PRECEDING/FOLLOWING`. `RANGE` offsets need exactly one numeric or `Date` key (codes 36 and 48); `INTERVAL` offsets raise 36 on `Date`. `1 FOLLOWING AND 1 PRECEDING` raises 36.
- A constant key is not positional (`ORDER BY 1` gave one frame), but it is meaningless. Use the `LIMIT BY` rule: every key reads a column.
- With no total order, `row_number` is unspecified: differential tests must order by a unique key.

**Measured for `.over()` on 24.8.**
- **`sum` with a constant in its argument breaks under `OVER`.** `sum(u + 1) OVER (ORDER BY id)` raises code 10, and where no other column is read it silently returns the wrong row count: `count()` over it gave 1, not 5, and `SELECT sum(number + 1) OVER (ORDER BY number) FROM numbers(3)` returned one row, on 24.3 too. The error names the rewrite to `sum(u) + 1 * count(u)`; `optimize_arithmetic_operations_in_aggregate_functions = 0` removes it. Parameters behave like literals. `u + 1`, `u - 1`, `f + 1` and `dc + 1` failed; `u * 2`, `u / 2`, `(u + 1) * t`, `ifNull(v, 0) + 1`, and column-only arguments did not; nor did `avg`, `min`, `max`, `count`, `sumIf`, `argMax`, `quantile`, `uniq`, `first_value` or `lagInFrame` over `u + 1`. Computing the value in a subquery first is correct: `sum(i.x) OVER (...) FROM (SELECT u + {p} AS x ...) AS i`.
- Arithmetic around `OVER` works, with parameters: `sum(u) OVER () * {p}`, `row_number() OVER (...) + {p}`, `ifNull(lagInFrame(v) OVER (...), {p})`, `CAST`, `multiIf`, `if`, `u / sum(u) OVER (...)`, and two windows in one expression. So do parameters in an `-If` predicate, a level, an offset and a default. Different specs can share one SELECT.
- After `GROUP BY`: `sum(sum(u)) OVER (...)` and `rank() OVER (ORDER BY sum(u) DESC)` give the same rows as the nested form over a derived table.
- A `WHERE`, `ARRAY JOIN` or `DISTINCT` in the same SELECT gave the same rows as the nested form with those below the window (for `DISTINCT`, above it). `ORDER BY` and `LIMIT` on a window alias agree too, also under `prefer_column_name_to_alias = 1`.
- Alias capture. `id AS k, row_number() OVER (PARTITION BY k ...)` partitions by the alias under the default settings and by the column under `prefer_column_name_to_alias = 1`, so the two settings disagree. `sum(u) OVER () AS u, u + 1 AS x` gives `x` = 151. Qualifying every name (`i.k`) removes it. An item's own alias does not capture its own definition: `sum(u) OVER (PARTITION BY u) AS u`, `row_number() OVER (ORDER BY u DESC) AS u` and `sum(u) OVER (PARTITION BY k) / 2 AS k` read the columns.
- Window results drop `LowCardinality`: `lagInFrame(lc)`, `first_value(lc)`, `max(lc)` and `argMax(lc, t)` are `String`; `LowCardinality(Nullable(String))` gives `Nullable(String)`. Otherwise window-only functions return the argument's type, and aggregates match their `GROUP BY` result (`sum(Decimal(9, 2))` is `Decimal(38, 2)`, `avg(Nullable)` is `Nullable(Float64)`).
- Function arguments. `ntile` needs a positive constant and an `ORDER BY` (`ntile(2) OVER ()` raises 36). `nth_value` and `lagInFrame` offsets must be above 0 (36). A default must be the argument's type: `'x'`, `1.5` on `UInt32` and `NULL` on a non-nullable argument all raise 36. `row_number(id)` and `rank(id)` silently ignore their argument.
- Frames. `ROWS` offsets are non-negative 32-bit integers (1.5 and -1 raise 36) and work without `ORDER BY`. `RANGE` offsets need exactly one `ORDER BY` key (36), which may be an integer, `Date` or `Nullable` integer; `Decimal`, `String` raise 48. A float offset raises 36, and `UNBOUNDED FOLLOWING` cannot start a frame (36).
- **Window results repeat only under a total order.** One CTE joined to itself with `row_number() OVER (PARTITION BY g)` on 600,000 rows in 2 parts differed on 529,376 rows; with `ORDER BY id` it differed on 0.
- `sumState(u) OVER ()` returns a state. A `Subquery` in a key is accepted by the server.
- 24.3 runs all nine window functions below and the catalog aggregates under `OVER`. It has the same code 456 and the same `sum` defect, and the alias capture.

**Version sweep (PM, 2026-11-07).** As for `WITH FILL`: seven versions, analyzer on and off. Tables: `/tmp/claude-1000/-home-fernandohur-repos-typedhouse/d8f68019-bf18-4d79-bf40-0d5ca77cb719/scratchpad/probe/over.md`, `over-noanalyzer.md`, `over2.md`, `over3.md` (with `-noanalyzer` variants); statements in `over*.sql`. Unless a bullet below says otherwise, each claim above held on all seven versions with the analyzer on. That covers placement (184 in `WHERE`, `HAVING`, `GROUP BY`, inside an aggregate or another window), arithmetic around `OVER`, parameters in arguments, `-If` predicates and levels, `GROUP BY` with windows matching the nested form, `DISTINCT`, `LIMIT BY`, `HAVING`, alias capture by a sibling under the default settings and not under `prefer_column_name_to_alias = 1`, qualified names, `LowCardinality` dropped from results, `Nullable` kept, empty-frame defaults, frame errors (36 or 48), first-row `lagInFrame` defaults and the `leadInFrame` default frame. It also covers every catalog aggregate and `If` form as a window function, `-State` returning a state, `-Merge` over a state column, and the shared-CTE result differing without a total order (600,000 of 600,000 rows).
- **Corrected: code 456** happens on 24.3 to 25.8 only. 25.10 and later accept parameters in an inline `PARTITION BY`, `ORDER BY` and frame offsets, and 26.10 also in a named `WINDOW`. The `invalid_window_key` rule stays, because 24.3 is the declared minimum.
- **Corrected: the `sum(x ± constant)` defect** exists on 24.3 to 26.3 (code 10, or a wrong row count of 1 instead of 5) and is fixed on 26.10. With the analyzer off it raises codes 215 or 47 instead. `invalid_window_argument` stays, on the same minimum-version grounds.
- **Corrected: function availability.** `percent_rank` exists from 24.8 and `cume_dist` from 26.3. `lag`/`lead` exist from 25.8 with the analyzer on; with it off they raise code 48 on 25.8 to 26.3. The nine typed functions exist on all seven.
- **New: `ntile` on 24.3** raises code 36 when another window function in the same SELECT has an identical spec; with the analyzer off, every version up to 26.3 does. Alone, or beside a different spec, it works everywhere. Settled on the engines precedent (Track C): the server's error surfaces as `QueryError`, documented, with no compiler workaround.
- **New, version-dependent type: a `lagInFrame`/`leadInFrame` default of another type.** A `Float64` default on a `UInt32` argument, or `NULL`, raises 36 on 24.3 to 26.3, and on 26.10 succeeds and widens the result to `Float64` or `Nullable(UInt32)`. So the rule that the default has the argument's own type (`NoInfer`) is required, not only tidy: otherwise the result type would depend on the server.
- **New, version-dependent rows: `RANGE` offsets over a `Nullable` key.** On the row whose key is `NULL`, 24.3 to 26.3 returned 110 and 26.10 returned 20. Settled: `invalid_window_frame` refuses `RANGE` offsets over a `Nullable` key. `ROWS` frames and `RANGE UNBOUNDED`/`CURRENT ROW` are unaffected.
- **New: `RANGE … INTERVAL` offsets** work with the analyzer off on 24.3 to 26.3 and raise 36 with it on. Refused, as planned.
- **New: `row_number(x)`** returned 3 on some versions and 1 on others for the same first row. It stays zero-argument only.
- **Checked: filters and limits above a window stay above.** `EXPLAIN` shows the `Filter` step above the `Window` step for a partition-key and a non-key filter, and `LIMIT` above `Window`, on all seven. Rows are correct in both nested forms.
- **Checked: ties.** `row_number` and `first_value` with tied `ORDER BY` keys returned different rows between runs on every version; `rank` was repeatable; `max_threads = 1` was repeatable in this probe. Differential tests order by a unique key.
- **Checked: a window and `WITH FILL` in one SELECT.** The window column of a filled row is the type default (0), not computed. A window over a filled subquery computes over the filled rows. D13 and D17 keep the window and the fill in separate blocks unless a test pins the folded form.
- **Checked: a window over a null-extended `Tuple`** reads `NULL` on 26.3 and 26.10 without D21.

**Call shape (owner decision, Q3).**
```ts
from(events).map(r => ({
  running: sum(r.amount).over({ partitionBy: r.category, orderBy: r.ts.desc() }),
  rn: row_number().over({ partitionBy: r.category, orderBy: [r.ts.desc(), r.id] }),
  prev: lagInFrame(r.amount, 1, 0n).over({ orderBy: r.ts }),
  week: sum(r.amount).over({ orderBy: r.ts, frame: { rows: [{ preceding: 6 }, 'current'] } }),
  share: sum(r.amount).over({ partitionBy: r.category }).divide(r.amount),
}));
```
```sql
SELECT sum(`amount`) OVER (PARTITION BY `category` ORDER BY `ts` DESC) AS `running`, ... FROM `events`
```
- **Aggregates.** All 11 catalog aggregates, their `If` forms and `-Merge` accept row operands. `-State` does not (`test/types/expressions.ts:127` stays). There are no new overloads, which would turn every `TS2345` pin into `TS2769`. `AggregateOperand<T>` widens to include `Expr<T, string, 'row'>`, and the return is conditional: all non-constant operands row gives `WindowCall<T, N, D>`; grouped or constant gives today's type. `any` keeps today's type, since a distributing conditional broke `slice4b`/`4c`/`4d` tests in the prototype. Mixed row and grouped operands stay rejected, at the type level and at runtime.
- **`WindowCall<T, N, D>`** is a type with one method, `over(spec)`, so it fits the Decided row "Two-stage calls". It is not an `Expr`: `map`, `aggregate`, `where` and `.plus` all reject it. At runtime it is still today's `Agg` `Expr` in mode `agg`, so runtime behaviour without `.over()` is unchanged: `map` refuses the mode, and `aggregate` raises `invalid_expression_mode`.
- **Window-only functions**, exported from core under their ClickHouse names (Decided row "Function names"): `row_number()`, `rank()`, `dense_rank()`, `ntile(n)`, `lagInFrame(x, offset?, default?)`, `leadInFrame(x, offset?, default?)`, `first_value(x)`, `last_value(x)`, `nth_value(x, n)`. Each returns `WindowCall`. Zero-argument forms take no argument. `n` and `offset` are positive JS numbers bound as parameters; `default` is `NoInfer` of the argument's value. They live in a new `windowDefinitions` table, not `aggregateDefinitions`, so forged use under `Aggregate` raises `unsupported_aggregate`.
- **`count()`** has no operand to decide on, and its exact type is pinned (`test/types/expressions.ts:51`). An intersection broke that pin in the prototype. So `Expr` declares `over(this: Expr<bigint, 'count', 'agg'>, spec)`. Known gap, type-level only: `count().plus(1n).over(w)` and `sum(g.count).over(w)` type-check and fail at runtime with `invalid_window_function`.
- **`M` is a new mode, `'window'`**: `.over()` returns `ResolvedExpr<T, N, 'window', D>`. The generator adds `OperandMode<M> = M extends 'window' ? 'row' | 'window' : M` to every operand position, so a window receiver accepts row and window operands and stays `'window'` through arithmetic, comparisons, `ifNull` and `cast`. A row receiver rejects a window operand: `r.u.divide(sum(r.u).over(w))` is a type error, because a `'row'` result could reach `where`. Write the window first, or use a later `map`. Only `map` accepts `'window'`, through a new `MapProjection`; `Projection` stays row-only, so `groupBy` is unaffected. The next operator sees ordinary row columns.
- **Spec.** `{ partitionBy?: Expr | Expr[]; orderBy?: Expr | Ordering | (Expr | Ordering)[]; frame? }`, with `Expr` in mode `'row'`. `frame` is `{ rows: [start, end] }` or `{ range: [start, end] }`, each bound `'unbounded' | 'current' | { preceding: n } | { following: n }`; `'unbounded'` means `PRECEDING` as a start and `FOLLOWING` as an end. Offsets are inlined like `LIMIT`, since parameters raise code 456.
- **After a grouped query.** `.aggregate(...).map(r => ({ running: sum(r.total).over({ orderBy: r.day }) }))` is expressible and emits a window over a derived table; the rows matched `sum(sum(u)) OVER`. `sum(sum(g.x)).over(...)`, `.over()` inside an `aggregate` callback and window functions over grouped operands are not expressible.
- **Known tier.** `agg.percent_rank().as(col.Float64).over(w)` works, since it has no operand. Known aggregates with operands stay grouped-only, so they cannot use `.over()`; raw `sql` stays the fallback. Their `over` return needs its own signature in `KnownAggregate`.

**Legal positions.** Only a `map` value, including nested under `Call`, `Cast` or `Case`. Everywhere else is rejected three times: by type, by the builder (`containsWindow(ir)`, needed because a JavaScript caller can build a row receiver with a window operand), and by the compiler for hand-built IR (`invalid_window_placement`). The prototype confirmed each type rejection.

| Position | Type | Builder and compiler |
|---|---|---|
| `where`, `prewhere` | TS2322, `'window'` is not `'row'` | `invalid_predicate`; `invalid_window_placement` |
| `orderBy`, `thenBy` (sort on the `map` output instead) | TS2322, also through `.desc()` | `invalid_sort_expression`; `invalid_window_placement` |
| `limitBy`, `groupBy` | TS2322 | `invalid_limit_by_key`, `invalid_expression_mode`; `invalid_window_placement` |
| `aggregate` result, `.over()` in its callback | TS2322, `.over` missing on a grouped result (TS2339/TS2684) | `invalid_expression_mode`; `invalid_window_placement` |
| `join().on`, `.asof`, `arrayJoin` | TS2322 | `invalid_join_predicate`, `invalid_expression_mode`; `invalid_window_placement` |
| Operand of an aggregate, or window inside a window (argument or key) | TS2345/TS2322 | `invalid_window_operand`; `invalid_window_placement` |
| `sql` snippet argument | mode check | `rowOperand` in `sql.ts` learns `Window` |
| Bare `sum(r.x)`, `row_number()` used without `.over` | TS2740/TS2322 `WindowCall`; `.plus` TS2339 | `map` and `aggregate` mode checks, as today |
| `.over().over()`, `sum(x).plus(1).over()` | TS2339 | `invalid_window_function` |

**IR.** A new `ExprNode` kind: `Window { fn: Agg, partitionBy: ExprNode[], orderBy: SortKey[], frame?: WindowFrame, type }`. Not `Rel['kind']`, so `'Window'` is not added to `test/types/ir.ts:38-53`. Not a field on `Agg`: `references`, `mapExpression`, prune, `referencesName` and `readsName` walk only `args` and `params` of an `Agg`, so a forgotten case would silently lose key demand or an alias check, and `hasAggregate` and `invalid_aggregate_placement` would treat it as a `GROUP BY` aggregate. Under a new kind `resolveTotal` throws, `deterministic` and `referencesName` return their conservative default, and the rest is listed here. `fn` keeps `Agg`, so resolution is reused; `State` and two-combinator forms are rejected under it.

**Every `ExprNode` dispatch that must learn it.**
- `core`: `ir.ts` union; `query.ts` `readsRow` (`:318`), `deterministic` (`:386`, explicit false), `rebindSort` (`:410`, never reached; raise); `sql.ts` `rowOperand` (`:45`); `known-functions.ts` and `catalog/greatest.ts`, `projection.ts`: `'window'` and `'row'` mixes follow the existing mode checks, with a test each. A new exported `containsWindow`.
- `compiler/rewrite-expressions.ts`: `exprNode` edge restoring (`:15`), `mapExpression` (`:53`), `contains` (`:313`), `deterministicExpression` (`:303`). `resolveTotal` needs no change, only a test.
- `compiler/rewrite-rel.ts`: `scoped` and `repeatable` (`:406`, `:410`) and `mergeProject`. `edges` needs nothing, since `Project.exprs` already covers it.
- `compiler/prune-columns.ts` `expression` (`:77`), `compiler/plan-ctes.ts` `expression` (`:62`), `compiler/validate-structure.ts` expression fields and `choice` (`:256`, `:284`), `compiler/resolve.ts` new `resolveWindow` and `repeatable` (`:324`).
- `compiler/emit-naive.ts`: `resolvedType` (`:169`), `expression` (`:202`, with a new scope for `fn` so its row-mode refs pass the `ColumnRef` rule at `:207`). `hasAggregate` (`:34`) does not descend, on purpose.
- `compiler/plan-selects.ts`: `referencesName` (`:47`) and `readsName` (`:56`) keep their conservative default, with a comment and a test; the Distinct arm and the nested-selection arm change.
- `devtools`: `format-expression.ts` (`:60`), `dataflow.ts` (`:166`). `canonical-key.ts` handles types and values only; no expression goes through it, so it has nothing to learn.

**Fence, pass by pass.** Detection is `hasWindow(e) = contains(e, a => a.kind === 'Window')`. `contains` recurses through `Call`, `Raw`, `Agg`, `Cast` and `Case`, so `sum(x).over(w).divide(y)` is detected like a bare window.

| Pass | Risk | How it is fenced | Change |
|---|---|---|---|
| `PushFilterProject` | A filter below a window changes ranks (measured) | `totalExpression` is false for any `Window`: a used window makes the substituted predicate non-total, and an unused one fails `names.every(...)` | None; test |
| `MergeFilter`, `PushFilterJoin`, `LeftToInner` | Same, one level up | `fallible` counts a `Project` with a non-total expression, so `fallibleComputation` and `fallibleWithin` are true above it | None; test |
| `PushFilterAggKey`, `PushFilterUnion`, `PushFilterArrayJoin` | A filter reaches the window through them | They stop at the `Project` above | None; test |
| `MergeProject`, inner has a window | A window substituted into other expressions, into another window, or duplicated | `scoped` adds `Window`; `repeatable` is false | Add |
| `MergeProject`, outer has a window | A `Param` reaches a key (456), `x = u + 1` reaches `sum(x)` (the defect) | `values(outer.exprs).some(hasWindow)` returns `outer` | Add |
| Aggregate folding | `sum(rn)` in one block raises 184 | The Aggregate arm requires `!child.project` | None; test |
| `Filter`, `Sort`, `LimitBy`, `Limit` above | `WHERE` runs before windows | `(!child.project \|\| limitProject)`; `limitProject` requires `totalExpression`, so all open a derived table, conservatively for `Sort` and `Limit` | None; test |
| `Distinct` above | The arm folds over a `child.project` | Same rows measured, but the fold is not needed: require no window | Add |
| `ArrayJoin` above, join input, identity `Project` above | Would run below the window | Their arms require `!child.project`; a join input is a derived table | None; test |
| `Project` with a window below | May fold only on a scan block | The computed-`Project` arm requires a `table` source with Filter clauses, where `WHERE`, `PREWHERE` and `ARRAY JOIN` run first (measured). The nested-selection arm requires `directSelection`, which a window fails | Test |
| Alias capture on that fold | A sibling alias captures a key (measured) | The arm's `referencesName` returns true for `Window` by default, so any non-identity alias equal to a physical name opens a derived table; naive and derived forms qualify | None; test |
| `prune-columns` | Keys and arguments lose demand | `expression` visits `fn`, `partitionBy`, `orderBy`. An unread item is dropped: a window never changes the row count, and dropping a failing one is allowed by results-only | Add |
| `plan-ctes` | A shared window node | `expression` sets `extractable = false` and walks. A shared window is not a CTE; each use is its own subquery in both emitters. An explicit `.cte()` is a `Materialize`, and ClickHouse may evaluate it per use. Docs carry the measured total-order rule | Add |
| `deterministic`, live | A window is not incremental | `live: false` through `map`'s existing `deterministic` | Explicit case |

**Keys, arguments and frames, in `.over()` and again in compile.**
- `invalid_window_key`: a key holding a `Param`, `Subquery` or `Raw`, or reading no column. A direct `val()` is also a type error; a `Param` nested in an expression cannot be seen by types. Remedy, in the message: compute it in an earlier `map` and name the column; MergeProject's fence keeps it there. Raw `Param`s go through the same check, so code 456 is never reached.
- `invalid_window_argument`: a `Param` or `Raw` anywhere in the argument of a typed `sum` under `.over()`. The rule is broader than the failures measured, because the rewrite's conditions are server internals. Same remedy. Other functions keep parameters.
- `invalid_window_function`: `.over()` on anything but a root `Agg`, on `State`, or with `ntile` lacking an `ORDER BY` or having a `frame`.
- `invalid_window_frame`: non-integer, negative or above 32-bit offsets, start after end, `RANGE` offsets without exactly one integer or `Date` key.
- Emit names qualified in naive and derived forms.

**Availability.** Typed: nine functions above, on all seven versions (with the `ntile` limit on 24.3), plus the catalog aggregates. `lag` and `lead` do not exist; `percent_rank` only on 24.8, through the known tier; `cume_dist` on neither.

**Prototype, in a scratch copy, TypeScript 5.8.3, types only.** The owner's shape, arithmetic with row and window operands, a later `where`, and a grouped query's output all infer correctly under `pnpm typecheck` apart from the pins in Q7. Bench source instantiations rose 1.03%, from 3,338,847 to 3,373,260, and passed the budget. Built inputs were not rebuilt, and 5.5.4 and 7.0.2 were not run.

### Gap summary

| Keyword | Exists | core | compiler | client | codegen | docs | type tests |
|---|---|---|---|---|---|---|---|
| `-State`/`-Merge` | IR field, 6 exports, types, descriptor | 16 exports, LC fix, level on `quantileMerge` | resolve, rule move | none | parametric test | new rollups guide, 16 function entries | positive and negative |
| `SETTINGS` | Emitted for 3 internal settings | terminal `settings()`, allowlist, node | peel, tail, validation | none | none | new section, spec | positive and negative |
| `ASOF JOIN` | none | `asofJoin`, `asofLeftJoin`, `.asof()` | validate, emit, 2 rule fences | none | none | joins page | positive and negative |
| `WITH FILL` | none | `Ordering.withFill`, `interval`, key generics | validate, 4 renderers, edges | none | none | ordering page, warnings | positive and negative |
| `OVER` | Raw `sql` only | `.over()`, `'window'` mode, 9 functions, `Window` expression kind | fences, emit, validation | none | none | new page, spec reversal | positive and negative; Q7 |

Devtools (`node-label.ts`, `dataflow.ts`) needs labels and edges for each new node. The unmerged `studio` branch may switch over `Rel['kind']`; not checked.

### Tasks

Every feature task ships with its own runtime and positive and negative type tests. Tester tasks add native, differential, EXPLAIN corpus and adversarial coverage, and run negative controls. Snapshot updates go with the task that changes them. Worker tasks must not change a pre-existing expectation; see Decisions and Q6.

**D1. State rule and `-State`/`-Merge` in compiler and core.** Depends: none. Status: accepted, uncommitted.
Move `aggregate_state_selection` to the query result and `Subquery` results; add `aggregate_state_operand`; extend `resolveAggregate`; add `invalid_merge_state`; add the exports; strip `LowCardinality` in state descriptors, at runtime and in `StateResult`; `quantileMerge(level)` and `quantileExactMerge(level)`.
Accept: `from(s).count()`, `from(s).map(plain)`, `sumMerge`, known-tier `agg.uniqMerge(...).as(col.UInt64)`, and `aggregate(sumState).aggregate(sumMerge)` compile on both emitters. Raw `from(s)` and root `sumState` stay rejected. Forged metadata, wrong-function merge, wrong level and non-state operands are rejected in both emitters. Positive types for each function with `.not.toBeAny()`; negative types for wrong-function merge, merge in `map`, and `quantileMerge` without a level. Only the expectations listed under Decisions change, and only in D3.

**D2. `-State`/`-Merge` catalog result agreement.** Depends: D1. Status: accepted, uncommitted.
Accept: a native test compares `toTypeName` of every state and merged result with the descriptor, for each function over plain, `Nullable`, `LowCardinality`, `Decimal` and temporal inputs (extending the catalog native-agreement test). Codegen test: `AggregateFunction(quantile(0.9), Float64)` renders and feeds `quantileMerge` in types.

**D3. `-State`/`-Merge` native and differential coverage.** Depends: D2. Owner: Tester. Status: accepted, uncommitted.
Applies the approved expectation edits under Decisions, exactly and nothing else. Accept: real `AggregatingMergeTree` plus a materialized view `TO` table, multi-part before merge, through `run` and `stream`, compared with handwritten SQL and a JavaScript oracle; empty-input values above; `FINAL`, `PREWHERE`; union of rollup state and fresh state; state through a join input and an unmatched outer row; `sumMerge(total) AS total` under `prefer_column_name_to_alias = 1`; a merge level differing from the stored level, on a non-nullable state, with a Nullable state raising `invalid_merge_state` on a mismatch; every Worker-reported correction in the design note; `count`, `uniq` and `uniqExact` merging a stored argument other than the catalog's, and `avg` over `Decimal` rejected. Differential arbitrary gains states over an aggregating fixture, naive and optimized equal. Negative controls: leaving the check on every node, not stripping `LowCardinality`, and dropping the `-Merge` function match each fail a test.

**D4. `-State`/`-Merge` docs and spec.** Depends: D2. Status: accepted, uncommitted.
New guide for reading rollups and materialized views, one function entry per pair or a shared page, generated SQL. `spec.md:575` (states pass through; only the result is rejected), `spec.md:720` (the shipped list), a Decided row. Accept: docs state that the merge level decides, that `finalizeAggregation` is per row, and the raw-selection rule. `pnpm docs:verify` passes.

**D5. `SETTINGS` in core and compiler.** Depends: D4. Status: accepted, uncommitted.
`Query.settings(obj)` returns a terminal object with `ir`, `_rowType`, `caps`, `toSQL` and nothing else. Accepts only the allowlist; values validated per key; strings through the escaper; `{ live: false }`. Root-only `Settings` node, a `Rel` kind, peeled by `compile` and `emitNaive`; the Tester adds `'Settings'` at `test/types/ir.ts:38-53` (Q6). Merges with compiler-owned settings; those keys are not settable.
Accept: runtime tests for each key, bad values, unknown keys, compiler-owned keys, `log_comment` escaping, and placement. Positive types: result accepted by `run` and `stream`. Negative types: `.where`, `.limit`, `.settings`, as a join, union or subquery input. Plan caching keeps working by node identity. Added from D1 to D4: the peel happens before validation, because `aggregate_state_selection` compares against the query root (`rel === root`) and would miss a state under a `Settings` wrapper, so `from(rollup).settings(...)` must still raise it at path `root` on both emitters, a forged `Settings` under a `Subquery` is rejected, and `columns` and `columnPaths` come from the input. Integer keys accept only non-negative safe integers or a bigint: `max_memory_usage = 1.5` silently reads back as 1, and `1e21` (how JavaScript prints it) and `-1` raise code 70. `max_execution_time` keeps fractions (1.5 reads back). `log_comment` containing `*/` and `--` reads back, and sits correctly before the trailing `join_use_nulls` comment.

**D6. `SETTINGS` native coverage.** Depends: D5. Owner: Tester. Status: accepted, uncommitted.
Accept: `getSetting` through scan, join, CTE, `UNION ALL` and `UNION DISTINCT` on both emitters. Internal settings stay in force. Each resource limit surfaces as `QueryError` with its code; code 241 is reachable with `uniqExactMerge` over a rollup under `max_memory_usage = 1000000` (measured on 1,000 stored rows). Every value reads back through `getSetting` equal to what was set. Do not assume a limit separates the paths: `max_bytes_to_read` gave the same outcome for the pruned and the all-columns nested shape over a rollup, because the server prunes unread columns itself, and `count()` over a table ignored limits of 1. `readonly = 1` surfaces code 164. Differential: the same rows with and without performance settings. Negative controls: placement check removed, escaper bypassed.

**D7. `SETTINGS` docs and spec.** Depends: D5. Status: accepted, uncommitted.
`spec.md` Emission details and Decided row with the allowlist and Q1, Q2 outcomes. Accept: docs list every key and why others are refused, and state the `readonly = 1` behaviour. `pnpm docs:verify` passes.

**D8. `ASOF JOIN` in core.** Depends: D7. Status: accepted.
`asofJoin` and `asofLeftJoin`, one aliased input per argument as `leftJoin`. `.on(equalities)` returns an intermediate whose only method is `.asof(inequality)`; `.asof` builds the node, `{ live: false }`.
Accept: positive types for both kinds, including the `Nullable` right side on `asofLeftJoin`. Negative types: the intermediate used as a query (`where`, `map`, `toSQL`, `run`), a `.asof` before `.on`, a second `.asof`. Runtime: non-equality in `.on`, equality in `.asof`, one-side inequality, `join_condition_not_equi` wording, duplicate alias, arity.

**D9. `ASOF JOIN` in compiler.** Depends: D8. Status: accepted.
Fields, `validate`, keywords, naive and planned text, rule fences, `invalid_asof_condition`, `invalid_asof_type`.
Accept: unit tests that a right-side `Filter` stays above on `ASOF INNER` and `ASOF LEFT`, a left-side conjunct moves below, `LeftToInner` does not fire, and `join_use_nulls = 1` is emitted for `asofLeftJoin`. Forged IR rejected on both emitters. Parameters number in text order.

**D10. `ASOF JOIN` native and differential coverage.** Depends: D9. Owner: Tester. Status: accepted.
Accept: all four operators, reversed operands, each type family and mixed pairs, `Nullable` on both sides, expression and parameter operands, a CTE input, self-join, a null-extended `meta` check per column kind, `run` and `stream`, compared with handwritten SQL. Oracle-based test of right-filter non-commutation. Differential arbitrary gains `ASOF` with unique right keys, which is required: tied rows differ between repeat runs of one SQL. Tie tests assert only the count and that the chosen row is one of the tied rows. Mixed pairs include those raising code 386, with one `QueryError` shape on both paths, and NaN on each side, pinned as measured. The `join_algorithm` table in the design note is pinned through a client-level setting. A smoke run of the core cases on 24.3 and 26.10, or a recorded reason if the harness cannot run it. EXPLAIN corpus entry. Negative controls: admitting the right input, removing the `LeftToInner` fence, and moving residuals above the join each fail a test.

**D11. `ASOF JOIN` docs and spec.** Depends: D9. Status: accepted.
Joins page and `compiler/select-blocks.md`; `spec.md` Joins and Join strictness rows, Decided row. Accept: docs cover ties (not repeatable, and affected by `settings({ max_threads })`), the right-side filter trap with the reproduced rows, supported types and the pairs raising code 386, NaN, and unsupported `join_algorithm`s per version. `pnpm docs:verify` passes.

**D21. Read a null-extended `Tuple` or `JSON` as its typed default.** Depends: none. Status: accepted at `643281f`. The form changed during the work, see "D21 acceptance". Worker, then Tester.
In `joinRead` (`emit-naive.ts`), when the input is null-extended and the declared type is a `Tuple` or `JSON`, emit `ifNull(<col>, defaultValueOfTypeName(<quoted printed type>))`. This restores the Decided row "Outer join row types": these kinds "keep their type and the server default when unmatched". A 5-line prototype passed every check in the defect note below. The prototype's `same(...)` branch order is not binding, but `ON` conditions and non-extended inputs must stay untouched.
Accept: on 24.3, 24.8, 25.3, 25.8, 25.10, 26.3 and 26.10, on both emitters, through `leftJoin`, `rightJoin`, `fullJoin` and `asofLeftJoin`, rows and `meta` equal the 24.8 baseline for whole-column reads, each scalar element, nested `element`, and `where`, `orderBy`, `groupBy` over an element, a join over a join, and raw `sql` over the column. `JSON` where the server has it. `left-join-tuple-element-null.integration.ts` passes unchanged, which clears the 60 red tests. A `Tuple` whose printed type holds a quoted `Enum` label, a zoned `DateTime`, backticked names, and a `Nullable` member. A `col.Nullable(Tuple)` column stays unwrapped. Negative controls: no wrap for `Tuple`, no wrap for `JSON`, wrap on a non-extended input, unquoted type text. Docs: `joins.md` drops "Tuple columns on ClickHouse 26.10" and the `asofLeftJoin` link to it, and records the emitted form and the `Point` limit; `spec.md` Decided row replaces its "Known limit" with this. Edits to `null-extended-tuple-limit.integration.ts`: the Tester flips its 8 pins of the limit (`26.10 > * > an unmatched row`, `26.10 > * > meta`) to the new behaviour, once the owner has acknowledged that the fix overtakes "documented, not fixed". Nothing else existing changes.

**D12. `WITH FILL` in core.** Depends: none. Status: ready. It may run in a second worktree now, because it touches core and types only; it must rebase onto D21 before D13.
`Ordering.withFill({ from?, to?, step? })`, `interval(n, unit)`, with `Ordering` carrying the key's value type (default keeps today's type). Accept: positive types for integer, float, `Date`, `DateTime`, `DateTime64` and `Nullable` keys, ascending and descending, with `thenBy`. Negative types: `String` and `Decimal` keys, bare number step on temporal, interval on numeric, wrong-typed bound, `nullsFirst` then `withFill` and the reverse, `withFill` on a grouped key. Type performance stays under ceilings.

**D13. `WITH FILL` in compiler.** Depends: D12, D21 merged. Status: not started. From the sweep: bounds bind as the key's non-`Nullable` type, the step parameter as `Int64` on integer keys and `Float64` on float keys, no `STALENESS`, `NULLS FIRST` refused, and a window and a fill never folded into one SELECT.
`invalid_fill_key`, sign and bound checks when values are known, `Date` with sub-day unit rejected, renderers, `edges`, `expressions`, step negation.
Accept: SQL tests for `FROM TO STEP` order and parameter numbering in scan, join and aggregate blocks; `Filter + Sort(fill) + LimitBy + Limit` folds; a `Filter`, computed `Project`, `Aggregate` or `Distinct` above opens a derived table; every renderer emits the fill (a test walks each block shape, like PREWHERE's).

**D14. `WITH FILL` native and differential coverage.** Depends: D13. Owner: Tester. Status: not started. Runs on all seven sweep versions, starting from `fill.sql`, and pins each corrected or new fact in the note.
Accept: each key type and interval unit, descending, prefix keys, trailing keys, unselected key, `LIMIT` and `LIMIT BY` counting filled rows, an outer filter seeing filled rows, aggregate block with `sumMerge`, `DISTINCT` below, empty input, join and union inputs, CTE. Defaults per column type pinned against the descriptor. `Enum` without zero surfaces code 36 on the naive path; the optimized path may succeed when it prunes that column, per results-only. Differential arbitrary gains fill under a total order. Negative controls: folding a `Filter` above, dropping fill in one renderer, not negating the step.

**D15. `WITH FILL` docs and spec.** Depends: D13. Status: not started.
Ordering page; `compiler/select-blocks.md`; IR table in `spec.md`; Decided row. Accept: docs cover filled-row defaults and the computed-column case, `Enum`, no upper bound, the interaction order, and Q5's outcome. `pnpm docs:verify` passes.

**D16. `.over()` in core.** Depends: D15. Status: not started.
`Mode` gains `'window'`; `OperandMode` in `gen-expr-methods.ts`, regenerated; `MapProjection` on `Query.map` and `JoinQuery.map`; widened `AggregateOperand` with the conditional return on base, `If` and `Merge`, with a separate narrow operand for `State`; `WindowCall`; `Expr.over` for `count()` and at runtime; `windowDefinitions` and the nine functions; the `Window` node; `containsWindow`; checks in every illegal builder position; `invalid_window_key`, `invalid_window_argument`, `invalid_window_function`, `invalid_window_frame`; `{ live: false }`; devtools.
Accept: positive types with `toEqualTypeOf` and `.not.toBeAny()` for each function and aggregate, `If`, `Merge`, key and frame forms, arithmetic with row, window and constant operands, comparison, `ifNull`, `cast`, single-expression `map`, `JoinQuery.map`, a later `where`/`orderBy`/`limit` reading the result, and a grouped query's output. `any` operands keep today's types. Negative types for every row of the legal-positions table, plus mixed row and grouped operands, a direct `val()` key, `withFill` in a window key, wrong-typed `default`, `row_number(x)`, `maxState(r.x)`, `r.u.divide(window)`. Runtime tests: each builder rejection, including a JavaScript caller's row receiver with a window operand; `count().plus(1n).over(w)` raising `invalid_window_function`; `sum(r.x.plus(1)).over()` raising `invalid_window_argument`, and `sum(r.x.plus(r.y)).over()` allowed. `pnpm verify:expr-surface` passes after regeneration. `node scripts/check-type-performance.mjs --all` stays under the ceilings with no budget change; if it does not, stop and report. Pins in Q7 change only in D18.

**D17. `.over()` in compiler.** Depends: D16. Status: not started. From the sweep: `invalid_window_frame` also refuses `RANGE` offsets over a `Nullable` key, and the `lagInFrame`/`leadInFrame` default must have the argument's type in the compiler too.
Every dispatch listed above; `resolveWindow`, with results checked against the node (`LowCardinality` dropped); `invalid_window_placement`; validation of forged `Window` nodes; the MergeProject, Distinct and `plan-ctes` changes; emission.
Accept: unit tests for every row of the fence table, each asserting SQL shape and hits on both emitters. Named cases: a filter above a window stays above when it reads only the partition key, when it reads the window column, and when it reads neither; `sum(r.x).over(w).divide(r.y)` is fenced exactly like a bare window, in each row; `.map(x = u + 1).map(sum(x).over())` and a key over a computed `Param` column stay nested; a window never folds into an aggregate or `Distinct` block; an unread item is pruned and its keys and arguments are no longer demanded, while a key column read by no other expression is demanded; an alias equal to a sibling's key opens a derived table and an item's own alias does not; a shared window `Project` is not a CTE; the sole-column and `FROM`-less forms keep correct SQL. Forged IR with a window in `Filter`, `Sort`, `LimitBy`, `Aggregate`, `Join.on`, `ArrayJoin`, `RawRel`, an `Agg` argument and inside a key raises `invalid_window_placement` on both emitters. Parameters number in text order, with `fn` before its spec.

**D18. `.over()` native and differential coverage.** Depends: D17. Owner: Tester. Status: not started. Runs on all seven sweep versions, starting from `over*.sql`, including the 24.3 `ntile` limit as a `QueryError` and the 26.10 fix of the `sum` defect (the rule still refuses it).
Applies the Q7 edits, groups A to G, exactly as listed and nothing else. Accept: on 24.8 through `run` and `stream`, against handwritten SQL and a JavaScript oracle: each function and catalog aggregate; `If`, `Merge` over a rollup; frames; empty-frame and first-row values; `meta` equal to the descriptor per wrapper (`Nullable`, `LowCardinality`, `Decimal`, temporal); top-N per group through `where`; arithmetic and two windows in one item; over a join with `join_use_nulls`, an `ASOF` join, a grouped query, `ARRAY JOIN`, `PREWHERE`, a CTE and a union branch. Sibling alias capture under both `prefer_column_name_to_alias` values gives the column's result. `sum(column)` is correct after an earlier `map` computes `x + 1`, including row counts. A differential arbitrary adds `.over()` with a total order, naive and optimized rows equal, including nested arithmetic, parameters outside keys and pruning. EXPLAIN corpus: window step above a filter, no filter below it. A smoke test on 24.3 for every exported function, or a recorded reason if the harness cannot run it. Negative controls, each failing a test: removing each `Add` row in the fence table in turn; making `totalExpression` true for `Window`; removing `invalid_window_argument`; removing the `Param` check on keys; emitting unqualified names in the derived form. The types matrix runs on 5.5.4, 5.8.3 and 7.0.2, and any pin differing from the Q7 list comes back to the PM.

**D19. `.over()` docs and spec.** Depends: D17. Status: not started.
New query-builder page and one function entry per window function, with generated SQL. `spec.md`: line 20 (window functions leave the out-of-scope list), line 633 (`Window` in the `Expr` node list), the `Mode` and mode-gating text, the "Two-stage calls" row, and line 876 replaced. The note must say: the reversal was approved by the owner, and the reason, attributed to the orchestrator's analysis, is that `sql` windows work but leave the SQL unchecked and result types hand-asserted, on a very common analytics feature, in a library whose purpose is type safety. Record the expression shape, `map`-only placement, and the Window node.
Accept: docs cover legal positions and the `map`-first remedy; code 456 and the `sum` defect as the reasons for `invalid_window_key` and `invalid_window_argument`; frames and their rules; defaults instead of NULL and NaN on empty frames; `leadInFrame` needing an explicit frame; total order and repeated evaluation; `count().plus(1n).over(w)` failing at runtime; `percent_rank` through known functions and version availability. `pnpm docs:verify` passes.

**D20. Gates and evidence.** Depends: each keyword's tasks, then all. Status: not started.
Accept, per keyword before the next starts, and again at merge: `pnpm check:all` on TypeScript 5.5.4 and latest, `pnpm docs:verify`, `node scripts/check-type-performance.mjs --all` with no budget change unless approved, and this section updated with evidence. PM then checks coverage against the actual diff.

### Decisions

- **`-State`/`-Merge` test expectations (owner, relayed by the orchestrator, 2026-11-05): approved.** Scope: `packages/compiler/test/aggregation.test.ts`, `uniq-exact.test.ts`, `quantile.test.ts`, `aggregates-min-exact.test.ts` and `packages/client/test/stream.test.ts`, only expectations pinning `unsupported_aggregate_combinator` and `aggregate_state_selection`, and only where the new behaviour contradicts them. The Tester makes the edits, not the Worker. Any other pre-existing expectation goes back to the owner. These are the edits, for audit against the diff; the new codes assume Q4's recommendation, and rows 4 to 6 fall away if State/Merge stays limited to `count`, `sum` and `max`:

| # | Location | Forged input | Old | New | Why |
|---|---|---|---|---|---|
| 1 | `aggregation.test.ts:65-66` | `avgIf` node (2 args), `['State']`, `['Merge']` | `unsupported_aggregate_combinator` | `invalid_argument_arity` | Combinator now legal; base `avg` takes 1 arg. Split from the loop; `['If','If']` keeps its old expectation |
| 2 | `aggregation.test.ts:164` | `argMaxIf` node (3 args), `['State']` | `unsupported_aggregate_combinator` | `invalid_argument_arity` | Same; base `argMax` takes 2 |
| 3 | `aggregation.test.ts:339-343` | `argMax` node (2 args), `['Merge']`, `['State']` | `unsupported_aggregate_combinator at root.aggs.n` | `['Merge']`: `invalid_argument_arity at root.aggs.n`; `['State']`: `invalid_expression_type at root.aggs.n` | `-Merge` takes 1 state; for `-State` the args are valid but the node declares the value type. Split; `['If','If']` stays |
| 4 | `uniq-exact.test.ts:111-112` | `uniqExact` node, `['State']`, `['Merge']` | `unsupported_aggregate_combinator` | `['State']`: `invalid_expression_type`; `['Merge']`: `invalid_merge_state` | Declared type wrong for a state; operand is not a state. Split; `['If','If']` stays |
| 5 | `quantile.test.ts:112-113` | `quantile` node, `['State']`, `['Merge']` | `unsupported_aggregate_combinator` | Same as row 4 | Same |
| 6 | `aggregates-min-exact.test.ts:174` | `quantileExact` node, `['State']` | `unsupported_aggregate_combinator at root\.aggs\.x` | `invalid_expression_type at root\.aggs\.x` | Same |

  **Stay exactly as they are, checked:** `aggregation.test.ts:68` and `:347`, `uniq-exact.test.ts:105` (`params` on a non-parametric aggregate still raises the combinator code); `aggregates-min-exact.test.ts:175` and every `['If','If']`; `aggregation.test.ts:412` (root `sumState`) and `packages/client/test/stream.test.ts:125` (root `from(unsupported)`): raw selection at the result stays rejected, so `stream.test.ts` has no edit even though it is in the approved scope. Also unchanged, outside the approval: `backend.test.ts:207-213`, `decode.test.ts:116`.
- **Function names.** `row_number`, `dense_rank`, `first_value` and so on, per the Decided row "everything else the ClickHouse name". No camelCase aliases.
- **`percent_rank` not typed.** Absent on 24.3, the declared minimum. It stays reachable as a known aggregate: `agg.percent_rank().as(col.Float64).over(w)`. Not `cume_dist`, absent on 24.8.
- **Not added by this track.** `any`, `anyLast`, `groupArray`, `groupUniqArray` are in `spec.md:720` but not in the catalog; that gap predates this track. `sumStateIf`, `sumMergeIf` and the other two-combinator forms stay rejected; recorded as a later addition.
- **Q1, `SETTINGS` shape (owner): terminal `q.settings({...})` with the 12-key allowlist**: `max_threads`, `max_execution_time`, `max_memory_usage`, `max_rows_to_read`, `max_bytes_to_read`, `max_result_rows`, `max_result_bytes`, `max_block_size`, `max_bytes_before_external_group_by`, `max_bytes_before_external_sort`, `priority`, `log_comment`. `join_algorithm` stays out.
- **Q2, resource limits (owner): a named carve-out in `spec.md`**, for codes 158, 159, 241, 307 and 396 under user-set limits. D7 writes it. Code 241 was later raised by hand; D6 pins it.
- **Q3, `OVER` shape (owner): expression `.over()`**, not the PM's recommended `.window()` operator: `from(events).map(r => ({ running: sum(r.amount).over({ partitionBy: r.category, orderBy: r.ts.desc() }) }))`.
- **Q4, breadth (orchestrator, under the owner's request, not asked; open to the owner's objection): all 11 catalog aggregates get `-State`/`-Merge`**, since `spec.md:720` says "for each" and the request named rollup reading generally. So rows 4 to 6 above apply.
- **Q5, `INTERPOLATE` (orchestrator, under the owner's request, not asked; open to the owner's objection): deferred.** It was not in the request. D15 documents it as not supported.
- **Q6, `test/types/ir.ts:38-53` (owner): approved, additively and nothing else in that file.** The Tester adds `'Settings'` only. **`Settings` stays a `Rel` kind**: `Backend.compile(rel)` takes only a `Rel`, and plans cache on `Rel` identity. `Window` is an `ExprNode` kind, so it is not added to this union; `test/types/ir.ts:55-57` is covered by Q7.
- **D19 note (orchestrator's analysis; reversal approved by the owner).** `sql` windows work but leave SQL unchecked and result types hand-asserted, on a very common analytics feature, in a library whose purpose is type safety.
- **`-Merge` arguments (orchestrator, open to the owner's objection): `count`, `uniq` and `uniqExact` merge any stored argument**, since the result is always `UInt64`. The Worker is implementing this, subject to measurement. `avg` over `Decimal` stays rejected and documented.
- **Integer-level Nullable quantile columns (orchestrator, 2026-11-06, open to the owner's objection): fail closed with `invalid_merge_state`.** `AggregateFunction(quantile(1), Nullable(T))` has no typed merge, because the Float64 level parameter is spelled `1.` and the server raises code 43. The alternative, sending `{l:UInt8}`, works (PM measured 100) and was not built. `quantile(1.)` merges.
- **`Unknown` states (orchestrator, 2026-11-06, open to the owner's objection): fail closed through the `raw` text scanner**, overriding the "pass-through" wording. `spec.md` and `reference/types.md` carry the exception.
- **`count`, `uniq`, `uniqExact` (orchestrator, 2026-11-06, open to the owner's objection): merge any stored argument the server allows.** This settles the earlier "subject to measurement": `count` takes 0 or 1 stored arguments (2 raises code 42), the others 1 or more.
- **Existing test edits for `SETTINGS` (owner, relayed by the orchestrator): approved, and only these.** `test/types/ir.ts` adds `'Settings'`. `prewhere-adversarial.integration.ts:1638` expects `new Set(['6'])`, with the tolerant line tightened to the code. `backend.test.ts`: 3 tests move from a `json` mock to a `stream` mock, keeping what they guard.
- **`run` path (owner): Option A.** `runBuffered` always reads through `stream()`.
- **Gzip (owner): documented.** `compression: { response: true }` can lose the code. The owner accepted documenting it when told it was narrow, and has since been told the repeatable counts in `settings.md`. Not blocking unless the owner says so.
- **`SetQuery` requires `row` (orchestrator, open to the owner's objection).** This narrows a public type, so that a terminal `settings()` result is not a set operand.
- **`{ max_threads: undefined }` is refused at runtime (orchestrator, open to the owner's objection).** Leave the key out instead.
- **`max_threads` and `max_block_size` edges are accepted (orchestrator, open to the owner's objection), because they do not change rows.** This overrides D6's "every value reads back equal": on 24.8 `max_threads` is capped at 4096, `0` reads as the auto value, `max_block_size` is capped at 4294967296, and `0` reads as 65409.
- **`@clickhouse/client` floor is `^1.13.0` in `packages/client`; `packages/codegen` stays `^1.11.0`.** 1.11.0 fails to load, and 1.12.x loses the code on 26.10.
- **ASOF, owner (relayed by the orchestrator).** The alias-order bug is fixed on this branch. The EXPLAIN corpus edit is approved: 3 additive entries and snapshots in `explain-corpus.ts`. "26.10 `Tuple` limit documented, not fixed" is overtaken if D21 lands; see the defect note.
- **ASOF, orchestrator (open to the owner's objection, told to the owner).** Temporal against number is refused at compile time rather than surfacing as a server error, which differs from the PM's design note. `UInt8` against `Bool` and `Enum` against `UInt8` are stricter refusals. `sql` and `Cast` are allowed in ASOF conditions, `Case` and `Subquery` refused. `JoinBuilder`'s constructor gains an optional third argument, visible in declarations.
- **D21, orchestrator (open to the owner's objection, told to the owner).** The 12 unit tests pinning the first form's SQL were updated by the Tester: they were written on this branch, not a prior contract. `Point` and other parser `Unknown` kinds are not widened, because the owner approved D21 with `Point` staying a documented limit; widening is a follow-up.
- **Process (orchestrator).** D12 to D19 run in parallel worktrees: `with-fill` stacked on `five-keywords`, `over` stacked on `with-fill`, with branches rebased by the orchestrator at each landing.
- **Q7, pre-existing type expectations (owner, relayed by the orchestrator): approved.** The Tester may make the edits in groups A to G below, in D18, using `.over()`, and nothing outside this list. The known gap is accepted: `count().plus(1n).over(w)` and `sum(g.count).over(w)` type-check and fail at runtime with `invalid_window_function`. Measured with a prototype on TypeScript 5.8.3 only, so any pin differing on 5.5.4 or 7.0.2, or outside this list, comes back to the owner.

| Group | Locations in `test/types/` | Today | After |
|---|---|---|---|
| A. A bare row-operand call is no longer an error on its own line | `negative/expressions/declared-row.ts:4,5`, `descriptor-boundaries.ts:3`, `grouped.ts:3`, `membership.ts:9`, `z-low-stock.ts:12`, `z-sql-snippets.ts:15` | TS2345 at the call | The statement becomes a use, `q.map(() => ({ x: <call> }))`, expecting TS2322/TS2740 `WindowCall`: the protection moves from the call to its use |
| B. Same, as `@ts-expect-error` | `expressions.ts:123,125,137`, `descriptor-expressions.ts:54` | Directive on a bare call | Same rewrite. `expressions.ts:127` (`maxState`) stays as it is |
| C. Row operand inside `aggregate` | `negative/expressions/cast.ts:6`, `z-arg-max.ts:15`, `z-arg-min.ts:15`, `z-avg.ts:10`, `z-min.ts:6`, `z-quantile.ts:13`, `z-quantile-exact.ts:13` | TS2345 `AggregateOperand` | Still an error on the line: TS2322 `WindowCall` not assignable to `AggregateProjection` |
| D. Mixed row and grouped operands | `z-arg-max.ts:18`, `z-arg-min.ts:18`, `z-avg.ts:13`, `z-min.ts:10` | TS2345 on the predicate | Still an error by design; code and message to be recorded from D16. The prototype did not implement this rule and reported no error |
| E. Message only | `aggregation.ts:18`, `uniq-exact.ts:11` | TS2345 naming `"grouped"` or `AggregateOperand` | TS2345 with the new operand text |
| F. Message only, `map` now names both modes | `cast.ts:5`, `query.ts:4,6`, `union.ts:9`, `z-arg-max.ts:19`, `z-arg-min.ts:19`, `z-avg.ts:14`, `z-min.ts:11`, `z-quantile.ts:16`, `z-quantile-exact.ts:16` | TS2322/TS2353 naming `"row"` or `Expr<...>` | Same code, naming `"window" \| "row"` |
| G. `ExprNode` kinds | `ir.ts:55-57` | Exact union of nine kinds | Adds `'Window'`, nothing else |

### D1 to D4 acceptance (PM, 2026-11-06)

**Result: closed, uncommitted, with no blocking gap.** The merge gate in D20 is still pending, and `check:all` was not run as one command. The PM ran everything marked "checked" in a frozen copy of the worktree taken at 11:50 on 2026-11-06. After the runs, the source, tests, types and docs content still matched that copy; only one prose edit to the `spec.md` Aggregate states row came later, and the PM read it.

| Figure | Value | Status |
|---|---|---|
| `pnpm test` | 2277 passed, 1 skipped, 129 files | Checked |
| Compiler integration | 951 of 951, 48 files | Checked |
| Codegen integration | 8 of 8 | Checked |
| `check-type-diagnostics` | 526 on 5.5.4, 5.8.3, latest | Checked |
| `verify:type-corpus` | 216 records, 54 types, 24.8.14.39 | Checked |
| `verify:expr-surface`, typecheck, format check, build | Exit 0 | Checked |
| `docs:verify` | Exit 0, including the two line fixes | Checked |
| `check-type-performance` | Passes unchanged budget: built 2,559,101, source 3,340,785 instantiations | Checked on 5.8.3 only; `--all` is reported |
| Package verifications | Clean | Reported |
| Tester's negative controls | Failed tests as required | Reported, not rerun; the PM ran its own below |

**Existing-test audit.** `git diff` touches exactly 4 tracked test files and no snapshot, fixture, script or harness. The hunks are rows 1 to 6 under Decisions, with each row's stated old and new codes. `['If','If']` keeps its old expectation in rows 1, 3, 4 and 5. Unchanged as required: `aggregation.test.ts:68`, `:347`, `:412`, `uniq-exact.test.ts:105`, `aggregates-min-exact.test.ts:175`, `stream.test.ts`, `backend.test.ts`, `decode.test.ts`.

**Criteria against the diff.**
- **D1.** `emit-naive.ts` moves the check to `rel === root` and adds `checkStateReads`; `resolve.ts` has `State`, `Merge` and `invalid_merge_state`. All 16 new exports exist. The PM's own table, on both emitters: count, plain map, filter, merge, a merge with filter and sort on its alias, state-to-merge, union and join carriers compile; 9 root shapes raise `aggregate_state_selection`; wrong function, non-state, and reads in `orderBy`, `where`, `limitBy`, join `on` and nested `distinct` raise the required codes; a `groupBy` key on a state at the root raises `aggregate_state_selection`, since it is also the result. Positive and negative types are in `test/types/state-merge.ts` and `negative/expressions/state-merge.ts`, including wrong function, merge in `map`, and a missing level. Known-tier `agg.uniqMerge` compiles on both emitters, and `state-merge-agreement.integration.ts` runs it natively.
- **D2.** `state-merge-agreement.integration.ts` compares server types with descriptors per function and wrapper, as a new file rather than an extension of the catalog test. `state-parametric.test.ts` covers the codegen case.
- **D3.** Rollup and differential tests cover every listed case by title, through `run` and `stream`. The differential runs 400 cases. Each Worker correction is pinned.
- **D4.** `query-builder/rollups.md`, `functions/state-merge.md`, `spec.md:575`, `:720` and a Decided row. Docs state the merge-level rule with its Nullable exception, `finalizeAggregation` per row, and raw selection.

**PM's negative controls, on 505 tests in 10 state and aggregate unit files.** Each mutation failed tests:

| Mutation | Failed |
|---|---|
| Root check on every node | 168 |
| Root check not recursive | 60 |
| No state-read checks | 68 |
| `Subquery` result unchecked | 1 |
| `Distinct` over a state allowed | 20 |
| `UNION DISTINCT` over a state allowed | 3 |
| Any function merges | 24 |
| Nullable level unchecked | 28 |
| Integer-level spelling unchecked | 8 |
| `count`/`uniq` restricted to base operands | 1 |
| `LowCardinality` kept in states | 5 |
| Level 1 spelled `quantile(1)` | 2 |
| `Unknown` scanner off | 31 |
| `Map` not walked | 49 |
| Decoder refuses no nested state | 19 |

**Reproduced by hand on 24.8.14.** A nullable state at another level or none raises code 43, and at its stored level gives 90. A non-nullable state gave 50 at 0.5 and with no level. `LowCardinality` is dropped in arrays, tuples and `SimpleAggregateFunction`. A parameterized level 1 is `quantile(1.)` and a literal one `quantile(1)`. `system.functions` has no combinator names. `uniqMerge` and `uniqExactMerge` read multi-argument and array states. `countMerge` reads a 1-argument state, and a 2-argument `countState` raises code 42. The server itself accepts `avgMerge` over `Decimal`, so that rejection is this library's rule, as documented.

**Limits.**
- A state in `Dynamic` cannot be caught: its type says nothing about its contents. Documented, and a native test pins it.
- A deliberately hand-written `col.Unknown` with an embedded comment gets past the scanner: `AggregateFunction/*x*/(sum, UInt64)` does not match (PM checked the pattern). `system.columns` prints one spelling, so generated descriptors are not affected (Tester's native test).
- `Tuple` containing a state has compile-level evidence only. The server does accept such a column (PM checked), but a root selection is rejected before anything is sent, so a native test would add little.
- Native tests ran on 24.8 only. 24.3 was checked by hand for `sumState`/`sumMerge` and the `quantileExact` pair, not for every function.
- Hand-built `Case` over a state is not walked by `stateOperands`, but the emitter rejects every `Case` (`unsupported_expression`), so it is unreachable (PM checked).
- `totalAggregate` and `safeAggregate` refuse combinators, so `HAVING` key push-down and join rules stay fenced over merges. Correct but conservative; a later optimization.

### D5 to D7 acceptance (PM, 2026-11-06)

**Result: closed, uncommitted, with no blocking gap.** The merge gate in D20 is still pending for the whole track. The PM ran everything marked "checked" in a frozen copy of the worktree, taken at 16:37. Afterwards the worktree's packages, types, docs, scripts, lockfile, `spec.md` and `README.md` still matched that copy.

| Figure | Value | Status |
|---|---|---|
| `pnpm install --frozen-lockfile` | Exit 0, with the hand-edited lockfile | Checked |
| `pnpm check:all`, as one command | Exit 0 | Checked; this closes the Tester's "not verified" items for `check:all` and package consumers |
| Inside it: `pnpm test` | 2932 passed, 1 skipped, 135 files | Checked |
| Inside it: compiler integration | 1547 of 1547, 53 files | Checked |
| Inside it: codegen integration | 8 of 8 | Checked |
| Inside it: type corpus, core and codegen package verifications, format, typecheck, build | Clean | Checked |
| `check-type-diagnostics` | 555 on 5.5.4, 5.8.3, latest | Checked |
| `check-type-performance --all` | Budget unchanged, on 5.8.3, 5.5.4, 7.0.2. Source on 5.8.3: 3,342,574 instantiations | Checked |
| `pnpm docs:verify` | Exit 0 | Checked |
| Performance of `run`: 19% slower at 3M rows, 16% less memory | 7.5-7.6 s vs 6.1-6.4 s; 798-825 MB vs 963-989 MB | Reported; the old figure is the Tester's reconstruction |

**Existing-test audit.** Against master, 7 tracked test files changed: the 4 accepted in D1 to D4, and these 3, each exactly as approved. No snapshot, fixture or script changed.
- `test/types/ir.ts`: one added line, `'Settings'`.
- `prewhere-adversarial.integration.ts`: two lines, both stronger. `cause.code === '6' || /decode_missing_column/` became `cause.code` equal to `'6'`, and the set of codes is `['6']`.
- `backend.test.ts`: 3 tests. Each keeps its guard. The ownership test only swaps its mock. The rejection test still requires `cause`, context and one `close`, with the failure now thrown from the row. The decode test still requires `QueryError` and one `close`, and now pins `json` as not called. None was weakened.

**Criteria against the diff.**
- **D5.** `core/settings.ts` holds the allowlist and validation, read once. `compiler/settings.ts` peels before validation and re-checks hand-built nodes. `validate-structure.ts` raises `invalid_settings_placement` below the root. `TerminalQuery` has only `ir`, `caps`, `toSQL`. Negative types cover every listed method and input. Compiler-owned keys, `from(rollup).settings(...)` at `root`, `columns` and `columnPaths`, and escaping each have a test.
- **D6.** Read-back, limits and internal settings have native tests by title. Beyond the plan: mid-stream errors, a proxy, `KILL QUERY` and server signals.
- **D7.** `query-builder/settings.md`, `spec.md` Emission details, Testing, the Decided rows and the Q2 carve-out. Docs list every key, why others are refused, and `readonly`.

**PM's negative controls.** 19 mutations of the source and 1 reorder, run against 676 unit tests in 8 files. Each failed tests except one:

| Mutation | Failed |
|---|---|
| `Settings` allowed below the root | 52 |
| No peel in `emitNaive` | 309 |
| Settings dropped in `compile` | 140 |
| User settings dropped from the tail | 175 |
| User settings after the compiler's | 4 of 612 |
| Escaper bypassed | 12 |
| Integer keys take any number | 80 |
| Bigint range unchecked | 22 |
| Tiny timeout accepted | 12 |
| Compiler-owned check off | 11 |
| Unknown keys accepted | 30 |
| Compiler re-check off | 241 |
| Wrapper output unchecked | 14 |
| Input not validated in the peel | 4 |
| Set operand accepts `Settings` | 2 |
| Terminal query live | 1 |
| `parsedRow` never reads the error | 8 |
| `parsedRow` takes any bad line as error text | 23 |
| `run` reads `result.json` again | 19 |
| `http_write_exception_in_output_format` not sent | 0 unit; 10 of 12 native, in `midstream-errors` and `settings-midstream` |

**PM's own end-to-end run, through the built client, on 24.3.18, 24.8.14 and 26.10.3, both emitters, `run` and `stream`.** `max_result_rows` and `max_result_bytes` raise 396, `max_rows_to_read` 158, `max_bytes_to_read` 307, `max_memory_usage` 241. A query under the limit returns its rows. A real `exception` column holding `Code: 396. fake` stays data. A late `throwIf` keeps code 395 after up to 327,045 rows on `stream`, and `getSetting` reads the set value through a scan and a union. `max_execution_time` raised 159 at 14 s on all three by direct SQL. A code 160 in the PM's first probe was `sleepEachRow`'s own cap, not the limit; the server's estimated-time path was checked and did not raise 160 on that query.

**General client defect, fixed here.** On ClickHouse before 25.11, a server error after output starts arrives as a final `{"exception": ...}` line under HTTP 200, and the client read it as a row: lost code, or a wrong row with a real `exception` column. The fix is `http_write_exception_in_output_format: 0` in `outputSettings`, now compiler-owned, plus `parsedRow`. The committed `prewhere-adversarial` test pinned the old behaviour, so master has this path; no master checkout was run. **This changes behaviour on every read, not only under `settings()`, so it belongs in the release notes.**

**Lockfile warning.** `pnpm install --lockfile-only` in this worktree prunes `apps/playground` and vitest 3.2.7 entries, because that directory is absent. Edit the specifier by hand, as the Worker did. Only the specifier line changed.

**Limits, reported by the Tester and not closed by the PM.**
- A proxy ending the body cleanly gives short rows with no error, undetectably. Documented.
- `SIGTERM` and `SIGKILL` have thin samples: 1 or 2 per path, on 24.8 only. `any` has one measurement.
- The limit sweep on 24.3 and 26.10 was scan and union only, with no naive path. The PM's run adds both emitters on single scans and one aggregate, which is not a sweep.
- The `priority` ordering claim in the docs is unmeasured.
- Driver 1.13.0 had a decoding check and a mid-stream limit check, not the full suite. Codegen on a real 1.11 was not run.
- No real load balancer was tested.

**Minor, not blocking.** `renderSettings` is exported from core and used only by tests.

**Follow-ups, not done here.**
- The same validate-then-read Proxy flaw in a forged `Limit` node (`LIMIT 1 UNION ALL SELECT 1`), which predates this work.
- The cause of the 26.10 gzip `ECONNRESET`.
- The cause of `Z_DATA_ERROR`.
- The 19% `run` cost, whose cause is unknown.

**D8 to D11 re-read.** No owner decision is needed before the ASOF Worker starts. Each correction fits a settled precedent:
- Non-repeatable ties follow `LIMIT BY` without a total order (Track C) and the non-deterministic functions in `settings.md`: unspecified and documented, with unique keys in the differential. The contract's wording is unchanged by this. The owner may want to know that a repeat of one ASOF query can return different rows when right keys tie.
- NaN follows `min`, `max` and `argMin` (Track A): documented and pinned.
- Code 386 and code 48 follow engines (Track C): the server's error surfaces as `QueryError`, with no compiler check. `invalid_asof_type` stays for types that cannot be ordered at all. (Superseded in part by the orchestrator's ruling at D8 to D11 acceptance: temporal against number is refused at compile time.)
- The builder shape, IR and rule fences in D8 and D9 are unaffected, so D8's criteria do not change.

### D8 to D11 acceptance (PM, 2026-11-07)

**Result: closed at commit `d0ea03c`.** The only red tests are 60 in `left-join-tuple-element-null.integration.ts`, which is the defect below, not ASOF. They block the D20 gate and `check:all`, not this acceptance. `asofLeftJoin` inherits that defect, like every outer join, and D21 fixes all four kinds. The PM ran everything marked "checked" in a frozen copy of that commit.

| Figure | Value | Status |
|---|---|---|
| `pnpm install --frozen-lockfile` | Exit 0 | Checked |
| `pnpm test` | 3049 passed, 1 skipped, 138 files | Checked |
| Compiler integration | 2974 passed, 60 failed, 64 files; all 60 in the one file | Checked |
| Codegen integration | 8 of 8 | Checked |
| `pnpm check:all` as one command | Exit 1 at its last step, compiler integration; every earlier step passed, including format, typecheck, type corpus, build, package consumers, fixture seed | Checked |
| `check-type-diagnostics` | 583 on 5.5.4, 5.8.3, latest | Checked |
| `check-type-performance --all` | Budget unchanged; source on 5.8.3 3,343,884 instantiations | Checked |
| `pnpm docs:verify` | Exit 0 | Checked |
| Tester's native negative controls | | Reported |

**Existing-test audit.** Against master, the only tracked test file added since D5 to D7 is `fixtures/corpus/explain-corpus.ts`: the import, 3 `asof/*` entries and their spread, as approved, with 3 new snapshots. No other existing test, snapshot or script changed.

**Criteria against the diff.**
- **D8.** `asofJoin`, `asofLeftJoin`, `.on`, `.asof` in `join.ts`, `{ live: false }`, argument order kept. Negative types cover the intermediate, `.asof` before `.on`, a second `.asof`, and arity.
- **D9.** `strictness` on `Join`, carried by `strictnessOf` on every rebuild. `LeftToInner` is fenced, `PushFilterJoin` admits only the first input, and validation runs on both emitters.
- **D10.** All four operators, each type family and pair, `Nullable`, operands, inputs, and `meta`, on 24.3, 24.8 and 26.10 by test title. The differential runs 300 recipes with unique right keys and has non-vacuity checks. EXPLAIN pins right filter above and left filter below.
- **D11.** `joins.md` covers ties, the right-filter trap with rows, types, pairs raising code 386, NaN, `Decimal` scale overflow, and `join_algorithm` per version. `spec.md` and `select-blocks.md` agree.

**PM's negative controls, 18 mutations on 304 unit tests in 5 files.** All failed tests: strictness lost in `PushFilterJoin` (14) and `visit` (10); right input admitted (7); `LeftToInner` fires (3); inequality fences the left push (5); keyword dropped (35); last element unchecked (2); one-input inequality (1); any operand type (2); `LowCardinality` on both sides (2); folding off (11); builder equality any (4), inequality any (4), any comparison (3); live (2); ASOF left typed as inner (8); ASOF inputs from a merged record (2); outer inputs from a merged record (9).

**Minor.** `JoinBuilder`'s third argument is not checked against `inputs`; only internal callers pass it, but the class is exported.

### Defect: null-extended `Tuple` and `JSON` by server version (PM, 2026-11-07)

**Predates this track, and is not specific to ASOF.** Under `join_use_nulls = 1`, newer servers put these kinds in `Nullable`, against the Decided row "Outer join row types".

**When it starts, measured on 24.3.18, 24.8.14, 25.3.14, 25.8.33, 25.10.7, 26.3.62 and 26.10.3.** Point releases between these were not measured.

| Kind | Up to | From | Unmatched row |
|---|---|---|---|
| `Tuple` | 25.10 | **26.3**, not only 26.10 | `Nullable(Tuple)`, `NULL`, instead of a tuple of defaults |
| `Point` (a `Tuple` alias, `Unknown` to the parser) | 25.10 | 26.3 | `NULL` instead of `[0, 0]` |
| `JSON` | 24.8 | **25.3** | `Nullable(JSON)`, `NULL`, instead of `{}` |
| `Variant`, `Dynamic` | No change, 24.8 to 26.10 | | Keep their type and send `NULL` on all of them; the declared `unknown` holds |
| `Array`, `Nested`, `Ring`, `Map`, `AggregateFunction`, wrappable scalars, `LowCardinality`, `SimpleAggregateFunction` | No change, 24.8 to 26.10 | | As the Decided row says |

24.3 was not in this sweep except for `Tuple`, because the DDL used experimental flags it does not know.

**Through the builder on 26.3 and 26.10, both emitters, at `d0ea03c`.** A whole `Tuple` raises `decode_invalid`. `element` gives `null` for `UInt8` and `String`, and `decode_invalid` for `Int64`. `where(element.eq(0))` returns no rows where earlier versions return the unmatched ones. `groupBy(element)` gives a `null` group instead of 0. `JSON` gives `null` from 25.3 and `{}` on 24.8. Nested `element` differs only on 26.10.

**Options measured.**

| Option | Result |
|---|---|
| Server setting | **Ruled out twice.** `allow_experimental_nullable_tuple_type` exists from 26.3 and `enable_nullable_tuple_type` only on 26.10, and each raises code 115 on every version below. Neither helps: at 0 the type stays `Nullable(Tuple)` on 26.3 (where 0 is already the default) and 26.10 |
| `assumeNotNull` in the emitter | **Rejected.** A `Tuple` with an `Enum` without a zero member raises code 691 or a truncated response on 26.3 and 26.10. `assumeNotNull(element)` also strips a declared `Nullable` member |
| **`ifNull(col, defaultValueOfTypeName(type))` at the read, recommended** | **All 16 element types and the whole `Tuple` equal the 24.8 baseline on all 7 versions, both emitters**, including `where`, `orderBy`, `groupBy`, right, full and ASOF left, a join over a join, and `JSON` wherever available. Identity on older servers. No measurable cost on 3M rows |
| Fail closed on `.element()` | Refuses working queries on 24.x and pins 4 existing uses (`slice4b-adversarial.test.ts:99`, `slice4a-adversarial.integration.ts:330`, `slice4b-adversarial.integration.ts:534`, `test/types/slice4a-adversarial.ts:61`). It also leaves whole-column reads, sorting and grouping |
| Client version detection | Not permitted by the design: `Backend.compile` is synchronous and caches plans by `Rel`, and `toSQL()` has no connection. Not needed |

**Prototype evidence, in a scratch copy.** The wrap in `joinRead`: `pnpm test` 3049 passed with no SQL pin changed. Compiler integration: all 60 red tests pass, and of the rest only 8 fail, all pins of the documented limit in `null-extended-tuple-limit.integration.ts`. Another 3 failed only because that copy excluded `apps/`, which `asof-docs-pushdown-claim` reads. Types, the docs gate and the 5.5.4 matrix were not run on the prototype.

**Decision: settled by precedent, so this is task D21, not an owner choice.** The Decided row already says these kinds keep their type and the server default, and `joinRead` already wraps reads to keep descriptors true (`toNullable`). Two things go to the owner as information:
- D21 also removes the loud limit the owner chose to document, so that decision is overtaken, and the 8 pins flip. The owner should acknowledge this.
- Generated SQL for outer-join `Tuple` reads gains the wrapper, visible in `toSQL()`.

**Stays a limit after D21.** `Point` and other parser `Unknown` kinds that a server newly wraps: their declared type is `unknown`, so it is not a type lie, but rows differ by version (`NULL` or `[0, 0]`). Documented, not wrapped, because hand-written `Unknown` text cannot be trusted as a type name.

**Sequence.** D21 Worker, D21 Tester, then D12. They touch different hunks of `emit-naive.ts`, but the 60 red tests would fail every `check:all` in between, and Worker and Tester cannot edit concurrently, so running them in parallel gains nothing against a task this small.

### Version sweep before `WITH FILL` and `OVER` (PM, 2026-11-07)

**Tool.** `/tmp/claude-1000/-home-fernandohur-repos-typedhouse/d8f68019-bf18-4d79-bf40-0d5ca77cb719/scratchpad/probe/chprobe.py FILE.sql [--versions …] [--params k=v] [--out FILE.md]` runs each statement on 24.3, 24.8, 25.3, 25.8, 25.10, 26.3 and 26.10, one reused container per version (`pmprobe-<version>`), and tabulates column types and rows or the error code. Versions that agree are grouped, so a difference shows at a glance. Directives: `-- # section`, `-- label:`, `-- params:` (settings and `param_*`), `-- repeat: N` (flags results that are not repeatable), `-- hide`. Every table names the server version and the image digest. It does not use `asof-support.ts`, which it only read.

**Result.** Most claims in the two notes held on every version, and each note now lists what changed. The corrections:
- `NULLS FIRST` with `FROM`.
- The versions of code 456, the `sum` defect, `percent_rank`, `cume_dist` and `lag`/`lead`.

New and version-dependent:
- `DateTime` bounds on 26.10.
- `STALENESS`.
- Parameter types.
- `ntile` on 24.3.
- `lagInFrame` default widening on 26.10.
- `RANGE` over `Nullable` keys.

**Owner decisions.** None changes, and none is needed.
- Q5 (`INTERPOLATE` deferred): `INTERPOLATE` works the same on all seven versions, so nothing argues for or against it.
- Q7 (`.over()` with groups A to G): untouched; the sweep is server-side.
- The `count().plus(1n).over(w)` gap: untouched.

Each new item settles on precedent:
- `STALENESS` is not exposed, as `percent_rank` is not typed: absent on 24.3.
- The `ntile` limit surfaces as the server's error, as engines and `join_algorithm` do.
- The `lagInFrame` default rule, the `RANGE`-over-`Nullable` refusal and the 26.10 `DateTime` bound all choose the form whose rows and types do not depend on the server.

**Not swept.**
- `Point` and other parser `Unknown` kinds as fill keys.
- Fill keys of `Int128`/`UInt256`.
- Windows over `Map` or `Array` arguments.
- Load or large data, beyond 600,000 rows in 2 parts.

### D21 acceptance (PM, 2026-11-09)

**Result: closed at `643281f`.** The final form differs from the task text. The first form, `defaultValueOfTypeName('<declared>')`, changed matched rows when the descriptor lagged the table (a lagging `Enum` matched row read `1`), and `ifNull` alone changed `meta` even on 24.8, dropping `LowCardinality` members, `SimpleAggregateFunction` and `Point`. The accepted form takes the type from the column, so no descriptor text reaches the SQL: `CAST(ifNull(c, defaultValueOfTypeName(T)), T)` with `T = replaceRegexpOne(toTypeName(c), '(?s)^Nullable\\((.*)\\)$', '\\1')`. It also covers `SimpleAggregateFunction` over `Tuple` or `JSON`. The PM ran everything marked "checked" in a frozen copy of that commit.

| Figure | Value | Status |
|---|---|---|
| `pnpm install --frozen-lockfile` | Exit 0 | Checked |
| `pnpm check:all`, as one command | Exit 1 on 3 timeouts in compiler integration (`outer-join.integration.ts`: a driver "Timeout error" in one of 500 recipes; `query.integration.ts`: two weekly-Date tests over 30 s and 120 s). Every earlier step passed. The host load average was about 17 on 16 cores, with other agents' suites running | Checked |
| The two files with timeouts, rerun alone | 107 of 107 | Checked |
| Inside `check:all`: `pnpm test` | 3080 passed, 1 skipped | Checked |
| Inside `check:all`: compiler integration | 3887 passed, 1 skipped, 3 failed as above, 70 files | Checked |
| Inside `check:all`: codegen 8 of 8, type corpus, package consumers, fixture seed | Clean | Checked |
| `check-type-diagnostics` | 583 on 5.5.4, 5.8.3, latest | Checked |
| Full-project `tsc` | Clean on 5.5.4 and latest (the first 5.5.4 run ran out of memory without the heap flag; rerun with it) | Checked |
| `check-type-performance --all` | Budget unchanged; source on 5.8.3 3,343,884 instantiations | Checked |
| `pnpm docs:verify` | Exit 0 | Checked |
| 802 null-extension tests across 7 versions, a 55-test regex suite, the 3,360-query comparison against `d0ea03c`, cost within noise at 3M rows | | Reported |

**Existing-test audit, since `d0ea03c`.**
- `null-extended-tuple-limit.integration.ts` is renamed `null-extended-tuple-default.integration.ts`, with its 26.10 pins flipped as the owner approved.
- `asof-native.integration.ts` includes `tup` on 26.10 again, which restores coverage; it weakens nothing.
- `left-join-tuple-element-null.integration.ts` changes only its header comment.

No other existing test, snapshot or script changed. The 12 unit tests that pinned the first form are from this branch (orchestrator ruling above).

**PM's own server check, `chprobe.py` on all 7 versions (`probe/d21.md`).** The accepted form, written by hand, gave the same types and rows on 24.3 to 26.10 for every case tried:
- a `Tuple` with a `LowCardinality` member;
- `Enum` labels with a quote and a newline, plus a `Nullable` member;
- `Map` and `Array(Tuple)` members;
- `Point` and a zoned `DateTime64` member;
- backticked names, including one with a parenthesis;
- `SimpleAggregateFunction(any, Tuple)`;
- `WHERE` and `GROUP BY` over an element, which keeps the unmatched row;
- an inner join, where it is the identity.

`toTypeName` returns a multi-line type name for named tuples, which is why the regex needs `(?s)`. A `Tuple` with an `AggregateFunction` member could be filled only on 26.10, so it was checked there only.

**PM's negative controls, 8 mutations on 138 unit tests in 6 files.** All failed tests:

| Mutation | Failed |
|---|---|
| No wrap | 19 |
| `ifNull` without the `CAST` | 18 |
| The first form's declared type text | 17 |
| `JSON` not wrapped | 3 |
| `SimpleAggregateFunction` not unwrapped | 2 |
| Wrap on non-extended inputs | 4 |
| Regex without `(?s)` | 17 |
| `Unknown` widened | 6 |

**Docs.** `joins.md` and the `spec.md` Decided row describe the accepted form, the versions, the lagging-descriptor behaviour, and the `Unknown` kinds, and the PM's probes agree. The PM checked those sentences, not every sentence in the page.

**Follow-ups.**
- Widening the read to parser `Unknown` kinds. The Worker measured `Point`, `Tuple(p Point, …)` and `JSON(a UInt8)` declared as `Unknown` safe; this needs the owner, since `Point` was approved as a documented limit.
- `toSQL()` text is long for wrapped columns, about 170 characters each.
- "Wrap on a non-extended input" cannot be caught natively, since it is the identity there; only unit tests catch it.
- `asof-native`'s `meta` coverage is complete on 26.10 again.
- Under heavy host load, `outer-join.integration.ts` and the weekly-Date tests in `query.integration.ts` time out. They passed when rerun alone; a slow-host timeout policy may be worth a look.

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
