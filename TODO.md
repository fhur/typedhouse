# v1 implementation coverage and next batch

## Audit baseline

- Contract read in full: `spec.md`, lines 1–870. Do not modify it.
- Audited scaffold commit: `e925313`. All four `packages/*/src/index.ts` files contain only `export {};`. No parser, descriptors, builder, generator, compiler or client exists yet.
- Verified locally: `pnpm check:all` passes TypeScript, **one** Vitest test (`test/workspace.test.ts`: core has no runtime dependencies), and four empty-package builds. This is scaffold evidence, **not milestone acceptance**.
- `.github/workflows/ci.yml` has TypeScript 5.5.4/latest jobs, but no observed CI run is evidence here. Strict/exact optional types are configured. Core has no runtime dependencies.
- `docker version --format '{{.Server.Version}}'` returned `29.1.5`. No ClickHouse container, real columns capture, integration, differential or performance gate has been run in this audit. No demonstrated environmental blocker.
- An untracked `context.local.md` was present during inspection; it was neither read nor modified. It is not required. Preserve unrelated user files.

**Current milestone: 1. Do not begin milestone 2 until milestone 1 acceptance is green, including CI.** Only this document is changed by the PM. Workers do not commit unless explicitly assigned verification/commit responsibility.

## Milestone coverage ledger

| Milestone | Status and required evidence still missing |
| --- | --- |
| 1 — CH types | **Independently confirmed locally, including added adversarial regressions and both TS matrix runs; actual CI pending.** Recursive parser/printer, frozen descriptors/table metadata, complete mapping assertions, 216 genuinely captured records / 54 distinct types, canonical round trips, live corpus verification and fuzz gates. See worker evidence below. Do not advance to M2 yet. |
| 2 — codegen | **Blocked by M1.** Live introspection (tables/views/materialized views, metadata, aliases/dotted names), deterministic schema/functions snapshots and version/hash headers, known-function flags and missing-deterministic-column fallback; CLI flags/env credentials; both-file stale-check nonzero exit against pinned testcontainers fixture. |
| 3 — builder/IR/naive emitter | **Blocked by M2.** All unchanged API examples and negative diagnostics; immutable identity-based IR, runtime columns, modes/names/promotions/nullability, full generated typed catalog and combinators/extensions, all joins/array joins/set/order/group/subquery/raw/hint operators, validation/parameter serialization; permanent `emitNaive()`; live execution and correct decoding of every executable example. All six type gates and all Part 4 constraints below are required. Deterministic six-table DDL/seed must include the specified two tenants, row counts, nulls, empty arrays, shared/orphan ids, versions, weekly history, later insertedAt duplicates and warnings. |
| 4 — rewrites/flat emission | **Blocked by M3.** Independently tested validation/resolution, each of nine rewrite rules including negative preconditions, terminating fixpoint/50-iteration failure, one final source-order/shared-demand prune, table-driven block planning/fences; byte-exact lowStockCategories SQL and params; parameter identity, quoting, outer-join settings, CTE sharing/collision handling, no optimized `*`. Real 500-case CI differential with shrinking/both SQLs, 10k nightly, corpus EXPLAIN snapshots asserting allowed subqueries and read-column pruning. |
| 5 — client | **Blocked by M4.** Production run/stream with compile identity memoization, reused recursive decoders and execution settings, no more than one HTTP chunk buffered; actual 10M-row stream below 200 MB heap; server errors wrapped with SQL/params/cause and best-effort offending IR node/path without secondary exceptions. Basic execution/decoding already needed in M3, hardened here. |
| 6 — hardening | **Blocked by M5.** Arbitrary valid and malformed IR property tests: compile or named-node validation error, never compiler TypeError; all earlier gates remain green, including integration, differential, performance and both TypeScript versions. |
| 7 — deferred | Real temporary-table materialization in HTTP sessions; not v1. M3/M4 still require stable Materialize node/API, CTE behavior and warning. |
| 8 — deferred | Incremental Z-set engine, JS evaluators, sources/transport, live()/changes(), insert/delete differential backend. Not v1; compatibility constraints below are v1. |

### M3 compatibility constraints (all currently absent)

- Catalog SQL name/sqlName, optional **unset** js, deterministic, aggregate linear metadata; now/rand/today non-deterministic. Spec lists this twice: preserve both descriptions as one implementation requirement.
- Raw opacity (`opaque: true`) and validator tracking.
- `Query<R, C extends Caps = Caps>`, `Caps = { live: boolean }`, exported `IsLive<Q>` and capability propagation; no live()/changes() declarations.
- `table()` optional `source?: ChangeSource`, `ChangeSource = { readonly kind: string }`; generator never sets source.
- Single decoded value model and core `canonicalKey(row, columns): string`, used by differential comparisons.
- Client `Backend { name: string; compile(rel: Rel): Plan; run(plan: Plan): AsyncIterable<unknown[]> }`; clickhouse and clickhouse-naive plugins in harness.
- Param retains distinct identity/node kind through compilation, never converted to Literal.

## Acceptance-gate audit

At the scaffold audit, `package.json` ran only `tsc --noEmit && vitest run && pnpm -r build`, with only the dependency test. M1 now adds all parser/mapping/corpus/fuzz tests and mandatory live `verify:type-corpus` to `check:all`. The six M3 type gates and later acceptance checks remain absent; do not equate current green checks with v1 completion.

Extend `check:all` as gates are implemented, without skipping Docker-dependent checks or weakening assertions:

1. M1: parser fixture/fuzz runtime suite and exact mapping/descriptor type assertions; corpus provenance/count checks; verify both TS CI versions.
2. M2: real 24.8 codegen snapshot/check integration and generated-file compilation.
3. M3 six gates: exact positive types plus not-any, per-statement diagnostic code/message harness (missing/extra/wrong error fails), runtime-columns-derived type snapshots, 200-query + 25-step-chain + 10-way-join extendedDiagnostics budget, readable declaration snapshots, deterministic generated method declaration snapshot and standalone compile. Set genuine measured instantiation/time budgets with 50% headroom, never fabricate or silently raise them.
4. M3 onward: executable full example corpus, recursive decoder cases (big integers/decimals, time precision, denormal floats, nested collections, nullable types), Part 4 contract tests.
5. M4: per-stage and EXPLAIN structural tests; 500 real differential cases mandatory in CI; add separate scheduled 10k workflow (not 10k on every local check).
6. M5: measured 10M-row/<200 MB heap streaming gate and real error attribution.
7. M6: arbitrary IR robustness. Keep all prior gates active; regeneration must compare, not silently overwrite expected output during acceptance.

## First worker batch — milestone 1 only

Paths below are relative to `/Users/fernandohur/personal/chql`. Suggested new names are explicit worker targets, not claims of existing APIs. Run steps sequentially; no later-milestone implementation in this batch.

### M1-A — recursive parser and canonical printer

Targets: `packages/core/src/ch-type.ts`, `packages/core/src/index.ts`, `packages/core/test/ch-type.test.ts`.

- Export the exact spec `CHType` discriminated union, `parseCHType(text: string): CHType`, and `print(type: CHType): string`. Implement a cursor/recursive descent parser, not a regex-only parser. Handle all scalar names, wrappers, Map, named/unnamed Tuple, Variant, Dynamic, aggregate states/simple aggregates, FixedString, dates/timezones, decimal sugar and enum signed integers.
- Canonical Decimal32/64/128/256 precision is 9/18/38/76. Preserve Unknown.raw and print it unchanged. Bare DateTime needs a documented consistent AST representation. Preserve optional fields under exactOptionalPropertyTypes.
- Test escaped quotes/backslashes, commas/parentheses within quoted enum labels/timezones, quoted tuple names, whitespace, nesting, negative enum values, trailing garbage, truncated delimiters, unsupported/new type spellings and very deep input. No uncaught exceptions on arbitrary strings; malformed/unsupported whole inputs return Unknown rather than a partly accepted prefix.
- Exact `print(parseCHType(s)) === s` for canonical server corpus; canonical normalization for noncanonical decimal aliases/formatting, with AST parse/print stability. Explicit tests distinguish these promises.
- Acceptance: `pnpm exec vitest run packages/core/test/ch-type.test.ts`, `pnpm typecheck`, `pnpm build`. These alone do not complete M1.

### M1-B — descriptors and complete type mapping

Targets: `packages/core/src/columns.ts`, `packages/core/src/table.ts`, `packages/core/src/types.ts`, `packages/core/src/type-mapping.ts`, `packages/core/src/index.ts`, `packages/core/test/columns.test.ts`, `test/types/ch-types.ts`.

- Export value descriptors carrying CHType plus a phantom TS value, `col` constructors/constants, `table(name, columns, metadata)`, `TableDef<R>`, `Infer<typeof table>`, Decimal/UUID/IPv4/IPv6/AggregateState brands. Keep type machinery in types.ts and core dependency-free.
- Preserve literal inference (enum names, Decimal precision/scale, named tuple keys); provide all grammar descriptors, Decimal sugar, named `col.Tuple({ ... })` and unnamed readonly tuple forms. Mapping should be reusable for codegen/runtime type snapshots, e.g. `toTypeScript(type: CHType): string`, with documented required brand imports; this does not require implementing the CLI yet.
- Cover every mapping-table row: number vs bigint, Bool, branded addresses, Date/Date32/DateTime, DateTime64 <=3 Date/>3 string, Decimal string brands, Enum union, Nullable, transparent LowCardinality, recursive arrays, string-like-key Record maps versus numeric/bigint-key pair arrays, named objects/readonly tuples, unknown types and opaque AggregateState, SimpleAggregateFunction transparency. Decide/document Nothing -> never (Nullable(Nothing) -> null), absent from mapping table.
- Table metadata preserves engine/sortingKey/partitionKey and primaryKey/column alias metadata needed by later introspection. Support optional ChangeSource now without codegen inventing sources; do not build query operators yet.
- Use `expectTypeOf(...).toEqualTypeOf<...>()` and `.not.toBeAny()`; check runtime descriptor AST against inferred mapping, not only assignability. Exercise the fixture partSpecification Array(Tuple), metric metadata, nullable/low-cardinality nesting and quoted/dotted keys. Type failures should be intentionally scoped; broad casts must not erase literal types.
- Acceptance: `pnpm exec vitest run packages/core/test/columns.test.ts`, `pnpm typecheck`, `pnpm build`; TS 5.5/current CI must compile all mapping assertions.

### M1-C — genuine corpus capture, property tests and milestone verification

Targets: `scripts/capture-type-corpus.ts`, `packages/compiler/test/fixtures/type-corpus.sql`, `packages/compiler/test/fixtures/columns.json`, `packages/compiler/test/fixtures/columns.provenance.json`, `packages/core/test/ch-type-corpus.test.ts`, `packages/core/test/ch-type-fuzz.test.ts`, `test/types/ch-types.ts`, `package.json`, `.github/workflows/ci.yml` only as needed.

- Start a real testcontainers `clickhouse/clickhouse-server:24.8`; query `system.columns` after executing controlled type-coverage DDL and/or collecting real built-in schema columns. Check in at least 200 **actual returned column records**, retaining database/table/name/type and useful position data. Do not hand-author a type list and label it real cluster output. This count is real column values, not an unsupported requirement for 200 unique type spellings; report total/distinct counts and separately cover grammar branches not present on 24.8.
- Capture provenance: actual server version, pinned image (and digest if available), executed query, fixture source, capture command and content hash. DDL-generated tables are valid live introspection evidence only when actually created/query-returned; label them honestly as controlled fixtures, not production data. Unsupported experimental type setup must be documented, not fabricated.
- Give the capture script a runnable command (e.g. package script building it with installed tsup then running Node); no undeclared tsx assumption. Make corpus tests assert count >=200, parse all records without Unknown for known supported fixture types, canonical exact print equality, AST stability and mapping coverage. Expected mappings must not simply be produced by the same function being tested.
- fast-check arbitrary strings must never throw; valid strings may parse, invalid strings return Unknown. Add valid recursive AST/string generators and targeted punctuation/escape/unknown tests. Retain reproducible failure seeds and shrinking.
- Required acceptance: actual capture command succeeds; `pnpm exec vitest run packages/core/test/ch-type-corpus.test.ts packages/core/test/ch-type-fuzz.test.ts`; `pnpm check:all`; both TS 5.5.4/current CI jobs. Record actual counts, commands/results and capture provenance here. If Docker/image/server behavior fails, record exact blocker/error, not a skipped green suite.
- Only after evidence review mark M1 complete and obtain a fresh M2 brief. A local green scaffold or parser-only tests are insufficient.

## Independent M1 break-it plan

1. Extend the runtime/type bridge with Decimal and high-precision DateTime64 map keys: these decode to strings but are not CH string-like types. Assert exact pair-array types, not assignability.
2. Run a fresh pinned 24.8 container with enum labels containing hex, unknown and control escapes; compare parsed labels to actual selected labels and require exact system.columns print round trips. Keep these separate from the captured corpus; never rewrite expected corpus to hide a mismatch.
3. Exercise deep nesting boundaries, unsupported nested types, hostile quoted tuple keys and descriptor immutability/prototype-key handling.
4. Build packages and test real ESM package exports from Node (not Vitest path aliases), including a standalone consumer declaration typecheck.
5. Run pnpm check:all with new regressions active, plus live corpus verification/build individually if an earlier failing gate short-circuits. Record failures and exact production fix locations; do not fix production or advance M2.

## Independent M1 re-review break-it plan

- Re-read the entire spec, actual pending files/diff and prior regressions; do not trust repair logs alone.
- Probe multibyte UTF-8 hex escapes (two-, three-, four-byte characters and mixed literal Unicode) against actual ClickHouse selected enum labels and system.columns canonical output. ASCII-only hex coverage does not establish byte decoding correctness.
- Probe numeric object keys in enum descriptors: JavaScript Object.entries stringifies these, so require the exact same string-literal union in the phantom and runtime mapping bridge, including use as Map keys.
- Run mandatory check:all with all new tests enabled. If typecheck short-circuits, separately execute runtime tests, live corpus verification and built ESM consumer gates. Keep regressions failing for worker fixes; do not alter production code or advance to M2.

## Independent M1 third-pass break-it plan

- Verify the repaired parser and enum phantoms by reading actual implementations and all existing tests/harnesses, not relying on logs.
- Extend genuine 24.8 comparisons to UTF-8 BOM, adjacent hex runs separated by controls, and hostile named-tuple identifiers containing tab/newline/backspace/backticks. Assert both decoded names and byte-exact system.columns printing; string-literal fixes must also work for identifier quoting.
- Keep prior invalid-input/depth/type disagreement and package consumer gates intact. Run full `pnpm check:all`; independently run remaining gates if a failure short-circuits. No production edits or M2 work.

## Independent M1 adversarial results (2026-10-27)

- Read all 870 spec lines, TODO, actual tracked diff and implementation/tests/capture harness. No production files or spec edited, no commits. Added `packages/core/test/adversarial.test.ts`, `test/types/adversarial-maps.ts`, expanded the existing runtime/phantom bridge, and added `scripts/verify-core-package.mjs` as a mandatory post-build `check:all` gate.
- Final `pnpm check:all` **FAILED**: typecheck passes; **7 failing / 318 passing tests (325 total)**. Six live escaping cases and the mapping bridge fail. Full output: `/tmp/chql-adversarial-check.log`. Tests remain enabled, not expected-failure/skipped.
- **Fix 1: `packages/core/src/ch-type.ts:60` (`Parser.quoted`)**: real 24.8 selects prove `\\x41` decodes to A, `\\q` retains its backslash, `\\a` is BEL and `\\v` is vertical tab. Current implementation silently changes these labels. Implement ClickHouse escape semantics, including hex-byte handling and preservation of unrecognized escapes; retain quote/backslash handling. The regression compares both raw spelling and canonical system.columns spelling to the actual selected enum label.
- **Fix 2: `packages/core/src/ch-type.ts:21–22` (`quoteString`)**: system.columns emits backspace/form-feed as `\\b`/`\\f`; printer currently emits literal control characters, violating exact canonical round trips. Match server canonical escaping (also exercise the other controls after parser fixes).
- **Fix 3: `packages/core/src/types.ts:20`, `packages/core/src/columns.ts:29`**: MapValue tests decoded K extends string, incorrectly inferring Record for Decimal and DateTime64(9) keys. `toTypeScript` correctly emits pair arrays for these non-string-like CH types, so the exact runtime/phantom bridge fails TS2344. Live 24.8 successfully creates both map types. Carry CH key classification through descriptor types rather than relying solely on decoded TS K; preserve Record for String/FixedString/Enum/address/LowCardinality string-like keys. Do not change the runtime mapper to hide the disagreement.
- Separate gates passed despite `check:all` short-circuit: `pnpm verify:type-corpus` genuinely reverified **216 records / 54 distinct types on 24.8.14.39**; `pnpm build` passed all four packages; `pnpm verify:core-package` passed Node ESM package exports plus a strict NodeNext standalone consumer declaration compile without aliases. `git diff --check` passed.
- Passing adversarial checks include 128/129-depth boundary, whole-input unsupported nested types/trailing SQL, hostile tuple/prototype keys, recursive frozen AST mutation and caller metadata isolation. No environmental blocker. Rerun all gates and both TS matrix versions after fixes; actual CI evidence remains outstanding. **Do not advance to M2.**

## Independent M1 re-review results (2026-10-27)

- Read spec.md in full, actual pending diff and complete parser/descriptor/mapping/table implementations, existing regression/type/fuzz/corpus tests, capture script and package-consumer harness. Changed only TODO and tests, no production changes or commits; preserved context.local.md.
- Implemented the re-review break-it plan above in `packages/core/test/adversarial.test.ts` and `test/types/adversarial-maps.ts`. Prior repair cases pass, but new cases expose two further defects.
- `pnpm check:all` **FAILED** at typecheck (TS2344), log `/tmp/chql-rereview-check.log`. Independently ran `pnpm test`: **5 failed / 331 passed (336 total)**, log `/tmp/chql-rereview-tests.log`. Four live UTF-8 cases and the exact runtime/phantom bridge fail. No tests skipped or weakened.
- **Fix A — `packages/core/src/ch-type.ts:64–66`, Parser.quoted:** hex escapes represent bytes, not independent Unicode code points. Real 24.8 returns é for `\\xC3\\xA9`, but parser returns mojibake. Three-/four-byte sequences and literal Unicode mixed with escapes also disagree. Decode hex byte sequences as UTF-8 while preserving literal Unicode, ASCII/unknown/control escapes and dependency-free/browser-safe core behavior. Keep the existing server-label and canonical-output assertions.
- **Fix B — `packages/core/src/columns.ts:24–25`, Enum8/Enum16:** `keyof V & string` drops numeric object keys even though Object.entries creates labels `'0'` and `'42'`. Infer the stringified string-or-number keys (e.g. a shared helper in types.ts using template-literal conversion), excluding symbols; apply to both constructors. Keep exact union/Map assertions and the runtime mapper unchanged. Numeric-key enums currently lose valid label values and enum Map keys in inferred types.
- Separate gates passed: `pnpm verify:type-corpus` genuinely verified **216 records / 54 distinct types on 24.8.14.39**; `pnpm build` all four packages; `pnpm verify:core-package` real ESM exports and standalone consumer declarations; `git diff --check`.
- No environmental blocker. M1 is not accepted; do not start M2. Re-run check:all and TS matrix after fixes; actual CI evidence remains required.

## M1 worker evidence (2026-10-27)

- M1-A implemented: exact specified CHType alternatives, recursive descent with a 128-level guard and whole-input Unknown fallback, canonical printer, quoting, parametric aggregate signatures. Bare DateTime parses as `{ kind: 'DateTime' }`; scalar DateTime also prints correctly. Decimal aliases canonicalize. Exact bytes are required for server corpus, not arbitrary whitespace/aliases.
- M1-B implemented: frozen `Column<T>` runtime twins, complete `col` constructors, table metadata including optional source/alias metadata, brands and reusable `toTypeScript`. `Nothing -> never`, `Nullable(Nothing) -> null`; an empty named tuple also maps to `readonly []` because its runtime AST is indistinguishable from Tuple(). DateTime is `col.DateTime(tz?)`; nonliteral DateTime64 precision conservatively infers Date|string. No Expr methods, compiler imports or runtime core dependencies added.
- M1-C captured via actual `pnpm capture:type-corpus`: **216 returned records, 54 distinct types**, from four controlled 54-column Memory tables; explicitly not production data. Server **24.8.14.39**, image **clickhouse/clickhouse-server:24.8**, digest `sha256:1ffa82edee000a42c09313bd9f1293d94c570aee74babc1b3ca9983a35fa597b`. `columns.provenance.json` stores actual query, command, timestamp and corpus/DDL SHA-256. `verify:type-corpus` starts a new pinned testcontainer and compares live records byte-for-byte without rewriting fixtures; it is mandatory in `check:all`.
- Genuine setup findings: initially bundling testcontainers pulled optional native ssh dependencies; fixed by externalizing testcontainers. Server rejected Nullable(Nothing) as a table column with **Code 370 DATA_TYPE_CANNOT_BE_USED_IN_TABLES**; replaced that fixture column with Nullable(Float64), while Nothing remains explicitly tested. JSON/Dynamic/Variant are covered in unit/type tests and were not enabled in the live fixture; provenance states this.
- Tests passed: `pnpm exec vitest run packages/core/test/ch-type.test.ts` (59), `pnpm exec vitest run packages/core/test/columns.test.ts` (32), corpus+fuzz command (220). Final suite **313 tests in 6 files**, including a CLI-compiled exact runtime-mapping/phantom bridge. Fuzz seed **20261027**: 10,000 arbitrary strings + 2,000 recursive ASTs + 2,000 trailing-garbage cases per run. `pnpm typecheck`, all four builds, capture and repeated live verification passed.
- `pnpm check:all` passed. Both `CHQL_TYPESCRIPT_VERSION=5.5.4 pnpm check:all` and `CHQL_TYPESCRIPT_VERSION=latest pnpm check:all` passed, and full workspace CLI checks `pnpm --package typescript@5.5.4 dlx tsc --noEmit` and `pnpm --package typescript@latest dlx tsc --noEmit` passed. Installed build compiler is 5.9.3; registry latest actually resolved to **7.0.2**. These are local results, **not observed GitHub CI runs**.
- TS7 removed baseUrl and the legacy compiler API. Removed baseUrl in favor of relative paths (also passes TS5.5). CI now runs each matrix CLI directly instead of replacing the build tool's legacy compiler dependency; all type assertions run through that CLI, including the generated runtime bridge selected by CHQL_TYPESCRIPT_VERSION. tsup continues using the locked compatible build compiler. M3's requested compiler-API diagnostic harness must account for this API removal without weakening matrix coverage.
- Remaining acceptance: independent review and actual CI evidence. No M2 implementation, no commits, no change to spec.md or unrelated context.local.md. M1 is not declared CI-complete and milestones 2–6 remain unimplemented.

## M1 tester-fix worker evidence (2026-10-27)

- Read spec.md completely (all 870 lines) and limited changes to M1 repairs. No commits, no M2 work, no spec or unrelated user-file changes.
- `ch-type.ts`: quoted parsing now decodes two-digit hex escapes, BEL/vertical-tab and recognized quoted escapes, and preserves backslashes on unknown escapes. String printing canonicalizes backspace/form-feed to `\\b`/`\\f`. Existing real 24.8 adversarial label/canonical-output tests all pass; added seven independent parser/printer regressions.
- `types.ts`/`columns.ts`: `Column<T, StringKey>` carries a separate optional phantom for CH string-likeness, not decoded JS stringness. Scalars/FixedString/Enum classify explicitly; LowCardinality preserves classification; Decimal/time and other descriptors are non-string-like. `MapValue` uses that classification. Runtime mapper and exact runtime/phantom bridge are unchanged. Added independent exact/not-any map assertions, including wrapped decimal/enum keys; updated the exact UInt64 descriptor assertion for its explicit false classification.
- `pnpm check:all`: **332/332 tests in 7 files passed**, live corpus verified **216 records / 54 distinct types on 24.8.14.39**, all four builds and real ESM/standalone declarations passed. Log: `/tmp/chql-worker-fixes.log`.
- `CHQL_TYPESCRIPT_VERSION=5.5.4 pnpm check:all` and `CHQL_TYPESCRIPT_VERSION=latest pnpm check:all`: each passed all the same gates, including **332 tests** and fresh live corpus verification. Full workspace CLI commands `pnpm --package typescript@5.5.4 dlx tsc --noEmit` and `pnpm --package typescript@latest dlx tsc --noEmit` also passed. Versions independently queried: **5.5.4 / 7.0.2**. Logs: `/tmp/chql-worker-ts55.log`, `/tmp/chql-worker-tslatest.log`. `git diff --check` passed.
- Remaining: independent re-review and actual GitHub CI evidence; local matrix runs do not establish CI completion. No environmental blocker and no claim that v1 or later milestones are complete.

## M1 re-review repair worker evidence (2026-10-27)

- Read all 870 spec lines and TODO. Limited this batch to the two required M1 repairs; no commits, M2 work, spec changes or unrelated-file changes.
- `ch-type.ts`: decode consecutive hex escape bytes together with browser-standard TextDecoder, retaining adjacent literal Unicode and a leading UTF-8 BOM (`ignoreBOM: true`). Existing ASCII/control/unknown escapes are unchanged. Four genuine ClickHouse UTF-8 comparisons now pass; six added standalone regressions cover multibyte text, mixed astral/literal text, BOM and control-separated runs.
- `types.ts`/`columns.ts`: shared EnumNames stringifies string-or-number keys and excludes symbols for both Enum8 and Enum16. Retained exact enum/Map/runtime-phantom bridge tests; added exact/not-any assertions for numeric, negative numeric and symbol keys. Runtime mapping is unchanged; core still has no runtime dependencies.
- `pnpm check:all`, `CHQL_TYPESCRIPT_VERSION=5.5.4 pnpm check:all`, and `CHQL_TYPESCRIPT_VERSION=latest pnpm check:all` all passed: **342 tests / 7 files**, mandatory fresh live verification of **216 records / 54 distinct types on ClickHouse 24.8.14.39**, all four package builds and built ESM/standalone consumer checks. Logs: `/tmp/chql-rerepair.log`, `/tmp/chql-rerepair-ts55.log`, `/tmp/chql-rerepair-tslatest.log`.
- Full workspace matrix CLI commands also passed: `pnpm --package typescript@5.5.4 dlx tsc --noEmit` and `pnpm --package typescript@latest dlx tsc --noEmit`. These are local results, not GitHub CI evidence. Independent confirmation and actual CI remain outstanding; do not advance to M2.

## Independent M1 fourth-pass break-it plan

- Read the complete spec, actual pending changes and parser/descriptor/mapping implementation plus capture, fuzz, bridge and package harnesses.
- Extend live 24.8 identifier comparisons beyond isolated controls: combined controls, literal backslash followed by n (must not become newline), single quotes, SQL-looking punctuation, reserved/type-like names and multibyte identifiers. Require exact server canonical bytes and decoded ASTs.
- Add deterministic property coverage over all ASCII controls in named tuple identifiers, including nested Array(Tuple), and malformed dangling identifier escapes. Preserve prior runtime/type bridge and depth/injection regressions.
- Run mandatory `pnpm check:all`, including fresh genuine corpus verification and built-package consumer checks; record real results. Do not fix production, commit, or advance M2; CI evidence remains a separate gate.

## Independent M1 third-pass results

- Read the entire spec (1–870), TODO, tracked diff, full parser/descriptors/mapping/table files and all existing M1 test/type/capture/package harness files. Changed only adversarial tests and TODO; no production edits, commits, M2 work or unrelated-file changes.
- Added twelve real-server regressions: two UTF-8 enum cases and ten named-tuple identifier cases. Prior UTF-8 and enum mapping repairs pass, including BOM and control-separated byte runs.
- Final `pnpm check:all` **FAILED**: typecheck green, **6 failed / 348 passed (354 tests)**. Log: `/tmp/chql-third-review.log`. The six failures are exact canonical round trips for named tuple identifiers containing newline, tab, backspace, carriage return, form feed and NUL. Both raw/canonical parsing correctly preserve decoded names; printing emits literal control characters instead of the escapes returned by actual 24.8 `system.columns`.
- **Actionable fix: `packages/core/src/ch-type.ts:24–25`, `quoteName`.** Preserve existing backslash/backtick escaping and safe-identifier behavior, but escape control characters as `\\n`, `\\t`, `\\b`, `\\r`, `\\f`, `\\0`, matching server canonical identifier rendering. Do not blindly apply single-quote escaping to backtick identifiers. BEL and vertical tab remain literal in observed canonical output and their new tests pass. Keep all live regressions enabled.
- Independently passed `pnpm verify:type-corpus` (216 actual records / 54 distinct types, server 24.8.14.39), all four builds, built Node ESM exports plus standalone declaration consumer, and `git diff --check`. No environmental blocker. Re-run full/matrix gates after repairs; actual CI evidence remains absent. **Do not advance to M2.**

## M1 named-tuple repair worker evidence

- Read all 870 spec lines and TODO. Changed only `packages/core/src/ch-type.ts`, `packages/core/test/ch-type.test.ts` and this status document; no commits, M2 work, spec edits or unrelated-file changes.
- `quoteName` now canonically escapes newline, tab, backspace, carriage return, form feed and NUL while preserving safe identifiers, backslash/backtick escaping, literal single quotes, BEL and vertical tab. Added eleven standalone AST/print/parse assertions; all existing genuine-server regressions remain enabled and pass.
- `pnpm check:all`, `CHQL_TYPESCRIPT_VERSION=5.5.4 pnpm check:all`, and `CHQL_TYPESCRIPT_VERSION=latest pnpm check:all` each passed **365 tests / 7 files**, fresh live verification of **216 system.columns records / 54 distinct types on ClickHouse 24.8.14.39**, all four package builds, and built ESM/standalone consumer declarations. Logs: `/tmp/chql-name-repair.log`, `/tmp/chql-name-repair-ts55.log`, `/tmp/chql-name-repair-tslatest.log`.
- Full workspace CLI checks `pnpm --package typescript@5.5.4 dlx tsc --noEmit` and `pnpm --package typescript@latest dlx tsc --noEmit` passed; independently queried versions were **5.5.4 / 7.0.2**. `git diff --check` passed.
- No environmental blocker. These are local results, not observed CI evidence. Independent confirmation and actual CI acceptance remain required before M2; v1 completion remains false.

## Independent M1 fourth-pass results

- Read all 870 spec lines, TODO, actual tracked diff and full relevant production/test/capture/build-consumer files. Implemented the fourth-pass plan in `packages/core/test/adversarial.test.ts` and `packages/core/test/ch-type-fuzz.test.ts`; changed no production code, fixtures, spec or unrelated files and made no commits.
- Added seven genuine 24.8 named-tuple probes (combined controls, literal backslash-n, single quote, keyword/type-like names, SQL-looking punctuation and Unicode), one 2,000-case nested control-character property and four malformed-input regressions. All prior depth, runtime/phantom, live escaping and immutability gates remain enabled.
- `pnpm check:all` **PASSED: 377 tests in 7 files**, no skips; fresh live verification of **216 records / 54 distinct types on 24.8.14.39**; four builds and real built ESM/standalone consumer declaration checks passed. Log: `/tmp/chql-fourth-review.log`.
- Both `CHQL_TYPESCRIPT_VERSION=5.5.4 pnpm check:all` and `CHQL_TYPESCRIPT_VERSION=latest pnpm check:all` passed (logs `/tmp/chql-fourth-ts55.log`, `/tmp/chql-fourth-tslatest.log`). Full workspace CLI checks with TypeScript 5.5.4/latest and `git diff --check` passed independently.
- No new production defect or environmental blocker found in this batch. Local M1 test coverage passes; **actual CI evidence remains outstanding and M2 must not begin until that gate is satisfied**. This is not v1 completion; compiler/codegen/client remain scaffolds.

## Verification/commit gate results

- Independently read the entire spec and reviewed the actual M1 source, tests, capture/provenance, package-consumer checks and configuration changes. No disabled, focused or skipped tests were found; no unsupported v1/CI completion claim was accepted.
- Ran `pnpm check:all` successfully: **377 tests in 7 files**, fresh live comparison of **216 system.columns records / 54 distinct types on ClickHouse 24.8.14.39**, all four package builds, and built ESM/standalone consumer checks. Verification log: `/tmp/chql-commit-verification.log` (not committed).
- Independently ran `pnpm --package typescript@5.5.4 dlx tsc --noEmit` and `pnpm --package typescript@latest dlx tsc --noEmit`; both passed. `git diff --check` passed. Earlier tester full matrix runs remain separately recorded above.
- Commit scope is M1 source/tests, genuine controlled-fixture corpus and provenance, acceptance scripts/configuration, and TODO only. Unrelated `context.local.md` is preserved and excluded; no production repairs were needed during verification.
- **Actual CI evidence is still outstanding. Do not start M2.** Local verification and this commit do not establish v1 completion.

## Spec inconsistencies / resolutions to preserve explicitly

1. **Exact print versus canonicalization:** Decimal aliases normalize and arbitrary whitespace cannot survive the specified AST. Minimal interpretation: byte-exact for canonical real system.columns text, canonical print/AST round trip for accepted noncanonical input. Verify real server formatting; record any counterexample rather than altering fixtures to hide it.
2. **Part 4 eight rows include duplicated catalog row:** implement all rows; there are seven distinct obligations, not permission to drop metadata.
3. **Raw generic erasure:** `sql<T>` and `sql.relation<R>` examples provide no runtime CHType descriptors, while decoding/RawRel.columns require them. Unresolved design issue for M3: maintain unchanged snippets; investigate actual response metadata/explicit compatible optional metadata, do not fabricate types from erased generics or silently remove typed decoding.
4. **Join columns/rows:** universal `Record<string, CHType>` and homomorphic Row<R> are flat, while Join columns/proxies are nested. M3 must explicitly model join-side metadata/proxies without weakening flat projection checks. Object input-order-dependent outer nullability also needs precise type tests, not an assumed stable union order.
5. **Infer<Query>:** shown Infer definition does not handle Query, but runtime/type snapshot tests require `Infer<typeof q>`. Add a Query branch when Query exists, preserving table/expression/object forms.
6. **toSQL dependency boundary:** examples require q.toSQL(), core must not import compiler at runtime. M3 must document a compiler attachment/adapter mechanism and initialization used by executable snippets; do not introduce a hidden core compiler dependency.
7. **Outer join toFixed diagnostic:** example asks ifNull first, but toFixed is not a catalog Expr method even for non-null numbers. Keep negative statement rejected; do not invent a positive toFixed API or pretend this alone proves nullable gating. Add separate nullable receiver tests.
8. **Fixture seed paths differ:** early text says `test/fixtures/seed.sql`, final section specifies `packages/compiler/test/fixtures/seed.sql`; use final fixture directory as canonical, documenting any forwarding path if needed.
9. **Nested map open question conflicts with explicit v1 failures:** keep flat-only projections/nested_projection for v1; no change without explicit justification. Inner join non-equality example is resolved by specified extra Filter extraction, not by rejecting it.
10. **Nothing mapping unspecified:** proposed never (and Nullable(Nothing) null) must be recorded/tested. Bare DateTime has two possible AST variants; choose one canonical parse output while printing both identically.
11. **EXPLAIN fence language versus expected SQL:** example deliberately contains derived join-input/aggregate tables; classify fences and actual 24.8 EXPLAIN structure before assertions, without deleting mandatory structural checks or changing expected byte-exact SQL.

Completion is false until milestones 1–6 and all their actual gates are implemented and verified. No later milestone is accepted by assumption.
