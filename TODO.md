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

## Animal table in the "Latest value and average" guide (2026-11-05)

**Done.** The guide now builds a table of every animal, adding pagination, sorting, and filtering one section at a time, and ends with a single `getAnimalTable` endpoint.

**Verified.** The guide's final code, extracted from the page, matched a JavaScript oracle on ClickHouse 24.8: 448 page requests, 0 mismatches, across 16 filter sets, every column and direction, and every page. `pnpm docs:verify` passed.

**Noted, not changed.** Consecutive `.where` calls over a subquery are not merged, so each filter adds a subquery layer to the SQL.

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
