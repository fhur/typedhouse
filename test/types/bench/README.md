# M3 corpus gate — focused PASS; latest full matrix infrastructure BLOCKED

Current repair: `ColumnsRow<C>` now reifies its mapped object at the table boundary.
All 248 exact/not-any runtime rows and real emitted declarations pass on official
5.8.3, 5.5.4 and 7.0.2; AST review finds exactly 18 first-argument expansions and
no changes to the other query arguments. Original 200+2 inputs are unchanged.
Fresh three-process source/built measurements pass every unchanged budget; the
prior wall-time failure below remains real historical evidence, not retried away.
Default and minimum full matrices pass. Latest fails container setup for the
aggregate/Union suite (`No host port found for host IP`), so full acceptance is
still blocked; no retry or test exclusion was applied. See the latest TODO section
and `/tmp/typedhouse-readable-*.log` for measurements and limitations. Full M3 and v1
remain incomplete.

## Host-class wall budgets (current policy, M4 slice 3c)

`scripts/check-type-performance.mjs` enforces two kinds of ceiling from `budget.json`:

- **Instantiations are hard on every host.** `baselines["<tsVersion>/<built|source>"].instantiations`
  is hardware-independent and is always read from `budget.json`, whatever machine runs the check.
- **Wall time is hard only for a host class that has a budget; otherwise it is advisory.** The host
  class is `{ cpu: os.cpus()[0].model, platform, arch }` (the values `budget.json.host` records); on
  GitHub Actions (`GITHUB_ACTIONS=true`) it also carries `runner: ImageOS ?? RUNNER_OS` so every runner
  of one image/CPU model forms one class. The slug is lower-case with non-alphanumerics collapsed to
  `-`, prefixed `github-` on Actions: `apple-m3-max-darwin-arm64`,
  `github-amd-epyc-7763-64-core-processor-linux-x64`.

Wall lookup order, per run:

1. `test/types/bench/budget.<slug>.json` if it exists — wall is hard from that file (a key the file
   lacks is advisory for that key only, printed as
   `ADVISORY wall <key> <measured>s (no wall budget for <key> in <file>, host class <slug>; <budget.host.cpu> ceiling <ceiling>s) — not enforced`;
   it never falls back to another host's ceiling). The file's
   `policy` and `inputHash` must match, exactly like `budget.json`'s, or the run fails.
2. else `budget.json` when its `host` matches the running class exactly (today: the Apple M3 Max the
   budget was recorded on) — wall is hard from `budget.json`.
3. else no wall budget — wall is measured and printed per `<version>/<mode>` as
   `ADVISORY wall <key> <measured>s (no wall budget for host class <slug>; <budget.host.cpu> ceiling <ceiling>s) — not enforced`
   and does not affect the exit code. The reference name and ceiling are `budget.json`'s `host.cpu`
   (today `Apple M3 Max`) and its `wallSeconds` for that key, printed for comparison only.

The JSON header line carries `hostClass`, `hostClassSlug` and `wallBudgetFile` (the host-class budget
file consulted, or `null`); whether wall is enforced is decided per key and shown by the ADVISORY lines.
A `budget.json` baseline without `wallSeconds` is fatal on every path, like a missing instantiation ceiling.
Exit codes: instantiations over ceiling → 1 on any host; wall over ceiling with a host budget → 1;
wall over with no host budget → 0 plus the advisory line; `inputHash` or `policy` mismatch → 1 before
any measurement; missing metric, unparsable `--extendedDiagnostics` output, non-zero `tsc` or an
unknown `<version>/<mode>` baseline → 1 on any host (the advisory branch covers the wall comparison
only). `--self-test` pins all of these without Docker or a compiler run.

Recording a budget for a new host class (never for `budget.json` itself):

```sh
node scripts/check-type-performance.mjs --record-host-budget --all   # or without --all: the TYPEDHOUSE_TYPESCRIPT_VERSION selector only
```

runs three fresh sequential compiles per selected version/mode under the same policy (maximum × 1.5,
instantiations rounded up — recorded for provenance, only wall is ever read from the file) and writes
`budget.<slug>.json` with `policy`, `inputHash`, `hostClass`, `host`, `recordedAt`, `baselines`. It
refuses to overwrite an existing file (exit 1, naming it); deleting or re-recording one is a reviewed
human decision. For the GitHub runner class dispatch the manual workflow
`.github/workflows/type-budget.yml` (install, `pnpm build`, `--record-host-budget --all`, upload
`test/types/bench/budget.*.json` as an artifact); download the artifact, review the numbers and commit
the file by hand. Once committed, wall becomes hard on that class through lookup step 1. A file
recorded with one `TYPEDHOUSE_TYPESCRIPT_VERSION` selector covers that version's two keys only; CI
jobs on other versions stay advisory for their keys until the file is re-recorded with `--all`.

No-raise rule: ceilings in `budget.json` and in any `budget.<slug>.json` are never raised or
rebaselined silently; a raise needs an explicit reviewed note, and a failed or over-ceiling compile is
never a baseline. When a file in `budget.json.inputs` changes, recompute `inputHash` as the script does
and append an `inputHashHistory` entry by hand; host-class files carry the same `inputHash` and must be
re-recorded or deleted in the same review.

## Historical acceptance (after a2409ad, before readability repair)

`queries.ts` contains **200 unannotated exports**: twenty domain input shapes
composed with ten relational operations (not changed literals). `manifest.json`
records each root/expression/composition. All six tables, latest/FINAL, tuple-array
payloads, histories, aggregation, membership/scalar, joins, ARRAY JOIN, union,
ordering and CTE reuse occur. `correspondence.ts` consumes each inferred row with
exact/not-any assertions against independently runtime-CHType-derived snapshots.
The original **25-step / ten-way inputs are byte-for-byte unchanged**.

Mandatory local commands (also wired additively into `verify-query-package.mjs`):

```sh
node scripts/generate-type-stress.mjs
node scripts/generate-type-bench.mjs
node scripts/check-type-performance.mjs --self-test
node scripts/check-type-performance.mjs --all
node scripts/check-corpus-types.mjs --self-test
TYPEDHOUSE_TYPESCRIPT_VERSION=5.5.4 node scripts/check-corpus-types.mjs --self-test
TYPEDHOUSE_TYPESCRIPT_VERSION=latest node scripts/check-corpus-types.mjs --self-test
```

The last three commands currently **fail intentionally on the actual acceptance
contract**, not an expected-failure exemption: 18 supported exports emit decoded
`ColumnsRow<...Column descriptors...>` instead of a flat object. `filterTenantActive`
in `supported-types.ts` is the smallest existing corpus witness. Actual unmodified
compiler output is in `../snapshots/corpus/supported-{5.8.3,5.5.4,7.0.2}.d.ts`.
`bench-*.d.ts` are also actual emitted declarations, not expected-type substitutes.
The **248 runtime-derived exact/not-any rows (48 supported + 200 bench)** and stale,
descriptor-mismatch, inferred-widening and unreadability controls pass before that
failure. Core repair requires renewed parent authorization; no production change
was made. Consequently final wired `pnpm check:all` is red, and M3 is not accepted.

`../corpus-coverage.json` is the per-example ledger, including missing symbols,
scalar nullability, approved latest/cte changes, SQL-only SAMPLE and deferrals.
Full v1 and all six universal gates remain incomplete. This is a type harness,
not live execution/EXPLAIN proof of the new 200 compositions.

### Measured performance policy and baseline

Policy fixed before initialization: three sequential fresh official CLI processes
per actual version and source/built path; maximum of three, with ceilings exactly
50% above that maximum (instantiations rounded up). No incremental cache. OS caches
are warm: this is cold **compiler process**, not cold machine. External wall time
includes pnpm/CLI startup; build and version-resolution startup are excluded.
TS check/total time and memory are retained separately in `budget.json`, with exact
commands, input SHA256, Node/host and timestamp. Apple M3 Max / 36 GiB, Darwin arm64,
Node v24.11.0. TS7 is its actual official CLI, not a compiler-API fallback.

| Actual TS | Input | Instantiations | Instantiation ceiling | Max wall s | Wall ceiling s |
| --- | --- | ---: | ---: | ---: | ---: |
| 5.8.3 | built | 2,132,446 | 3,198,669 | 2.8270 | 4.2405 |
| 5.8.3 | source | 2,709,599 | 4,064,399 | 3.1108 | 4.6663 |
| 5.5.4 | built | 2,130,575 | 3,195,863 | 2.8125 | 4.2188 |
| 5.5.4 | source | 2,707,502 | 4,061,253 | 3.1629 | 4.7443 |
| 7.0.2 | built | 1,339,161 | 2,008,742 | 1.5018 | 2.2527 |
| 7.0.2 | source | 1,543,292 | 2,314,938 | 1.5289 | 2.2933 |

Initialization was explicit (`--initialize --self-test`), after successful complete
compiles and rebuilt core. It refuses an existing budget. Normal invocation only
compares: unknown versions, changed input hashes, missing metrics, timeout/compiler
failure or excess ceilings fail closed. Never raise a future ceiling without an
explicit reviewed rationale/approval; do not call a failed compile a baseline.
The initial full normal comparison and three wired matrix performance phases passed.
A final follow-up failed: unchanged default/built 2,132,446 instantiations, but
wall times 8.716 / 14.118 / 4.264 s exceeded the unchanged 4.2405 s ceiling.
Subsequent host load was 12.98 / 11.92 / 11.25 (Virtualization ~252% CPU); contention
is plausible, not proven. See `/tmp/typedhouse-m3-performance-final.log`. No retries to
hide that result, no budget increase: final local performance status is red.

The synthetic controls include missing metrics, unknown baseline, wall-only excess
and tiny ceilings. A real run with `/tmp/typedhouse-m3-tiny-budget.json` also failed with
2,132,446 instantiations over its ceiling of 1. No budget was raised after testing.

`--refresh` on the corpus script explicitly regenerates runtime snapshots, exact
assertions and versioned **actual** declarations; it still fails unreadable output.
Normal checks never regenerate. Deterministic bench generation has separate
explicit `--refresh`, and normal mode verifies checked-in bytes.

All prior suites were freshly run **before adding mandatory wiring** on default,
5.5.4 and latest: 774 runtime + 7 codegen + 154 integration; 225 precise negatives;
prior 500-case suites and actual 10M stream in each. Final wired matrices stop at
the new readability failure, not at a regression in those prior suites. See TODO
for exact logs and limitations. No hosted CI or full-v1 claim.

## Historical stress repair — locally passing; full performance gate was open

## Repair evidence

The original stress files and generator are unchanged (hashes below). Both now
pass actual TS **5.8.3 / 5.5.4 / 7.0.2**, against built public declarations and
against source (`-p test/types/bench/tsconfig.source.json`). No intermediates were
annotated and no compiler budget, suppression, or descriptor erasure was added.

Before editing, freshly rebuilt declarations reproduced TS2590 at chain step5
and in the original `/tmp/typedhouse-m3-minimal.mts`. The fresh default failure used
1,856,858 instantiations, 513,377K memory, 3.28s check / 3.41s total.

The single-precise-proxy change alone **did not fix it**: 1,827,814 instantiations,
501,173K, 3.23s check / 3.36s total, still TS2590. Descriptor intersections from
`ExprNode['type']` were also accumulating across projection boundaries. Reifying
concrete descriptors with a homomorphic mapped type removed this accumulation.
Shallow reconstruction passed the chain but exposed TS2590 in existing nullable
scalar and tuple tests; recursively reconstructing nested descriptors at map and
aggregate boundaries passed those unchanged tests too. Broad CHType stays opaque.
The repair preserves descriptor fields/unions, nominal Expr identity, decoded
rows, names/modes, Query defaults, nested grouping and aggregate IR refinement.

Final fresh-process measurements (one run/version/path, warm filesystem caches;
external time includes pnpm startup, build excluded; same host as below):

| TS | Input | Instantiations | Check / total s | External s | Memory K |
| --- | --- | ---: | ---: | ---: | ---: |
| 5.8.3 | built | 625,664 | 1.12 / 1.26 | 1.50 | 286,032 |
| 5.5.4 | built | 624,822 | 1.05 / 1.18 | 1.47 | 277,345 |
| 7.0.2 | built | 513,821 | 0.328 / 0.348 | 1.15 | 190,444 |
| 5.8.3 | source | 845,063 | 1.29 / 1.44 | 1.67 | 270,661 |
| 5.5.4 | source | 843,995 | 1.29 / 1.43 | 1.71 | 258,809 |
| 7.0.2 | source | 674,339 | 0.351 / 0.375 | 0.96 | 223,104 |

Logs: `/tmp/typedhouse-repair-bench-{default,5.5.4,latest}-{tsconfig.json,tsconfig.source.json}.log`.
These are diagnostic measurements, **not** initial 200+2 budget baselines.
No repeated-run budgeting policy or ceiling has been fabricated.

New exact/not-any tests in `../query-proxy.ts` also run in the existing built
package verifier. Runtime twins are checked in core `query-proxy.test.ts`.
Sequential final full check:all matrices default/selected minimum/latest pass:
773 runtime + 7 codegen + 154 integration tests, 225 precise negatives each.
Explicit root CLIs separately passed fresh non-incremental checks at all three
actual versions. Existing latest float/integer/erased fallback, copied-operand,
mode and nested-arithmetic regressions are unchanged and pass.
Every matrix ran the prior bounded 500-case suites and actual 10M stream;
see TODO for logs/counts. The full 200-query corpus, coverage ledger, independent
runtime/declaration snapshots and enforced budget remain follow-on work.

## Historical preflight — blocker reproduced before repair

These are the original two stress inputs, preserved without casts, descriptor erasure,
intermediate query annotations, or diagnostic suppressions. `chain25.ts` has 25
map/join steps after its seed projection (13 arithmetic maps and 12 join/map steps).
`join10.ts` has ten simultaneous inputs covering all six fixture tables. Both consume
the inferred decoded output with exact/not-any assertions. The 200-query corpus,
coverage ledger, readable declarations, budget enforcement and failure controls
remain unimplemented; do not treat this directory as closing M3.

```sh
pnpm --filter @typedhouse/core build
node scripts/generate-type-stress.mjs # check only; --refresh explicitly regenerates
pnpm exec tsc -p test/types/bench/tsconfig.json --extendedDiagnostics --pretty false
pnpm --package typescript@5.5.4 dlx tsc -p test/types/bench/tsconfig.json --extendedDiagnostics --pretty false
pnpm --package typescript@latest dlx tsc -p test/types/bench/tsconfig.json --extendedDiagnostics --pretty false
```

The isolated config resolves built core declarations, not root source aliases.
The root typecheck also includes these deliberately unsuppressed `.ts`
inputs (failing at the historical preflight, now passing). No root config or existing acceptance gate was changed to exclude them.

## Reproduced blocker

Actual CLI versions 5.8.3, 5.5.4 and 7.0.2 all report TS2590 at
`chain25.ts(12,15)` (step5): “Expression produces a union type that is too complex
to represent.” This is not TS2589, nor an absent API. A separate default-CLI run
of `join10.ts` passes. A smaller public-package reproduction is:

```ts
import { col, table, from, join } from '@typedhouse/core';
const q = from(table('counter', { id: col.String, countOfParts: col.UInt64 },
  { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const a = q.map(r => ({ id: r.id, count: r.countOfParts }));
const b = a.map(r => ({ id: r.id, count: r.count.plus(1n) }));
const c = join({ a: b, b: q }).on(r => r.a.id.eq(r.b.id))
  .map(r => ({ id: r.a.id, count: r.a.count }));
const d = c.map(r => ({ id: r.id, count: r.count.plus(1n) }));
const e = join({ a: d, b: q }).on(r => r.a.id.eq(r.b.id))
  .map(r => ({ id: r.a.id, count: r.a.count }));
export const f = e.map(r => ({ id: r.id, count: r.count.plus(1n) })); // TS2590
```

Default CLI reproduction: `/tmp/typedhouse-m3-minimal.mts`, config
`/tmp/typedhouse-m3-minimal-config.json`, log `/tmp/typedhouse-m3-minimal.log`.
Six maps without joins, and the version without renaming countOfParts to count,
did not reproduce in exploratory probes. The original stress input is unchanged.

Candidate repair investigation: `Query.map` and `JoinQuery.map` currently return
`Query<Infer<P>, ...> & { row: ProjectionRow<P> }`, intersecting the default row
proxy with descriptor-bearing proxy evidence. Investigate representing one exact
proxy through the existing Query Proxy parameter, and normalizing descriptor
intersections at projection boundaries, without erasing descriptors, decoded-row
precision, names, modes, nominal operand identity or capability evidence. This is
a hypothesis, not a tested fix; no production types were edited. Preserve approved
latest float/integer/erased-input behavior and copied-operand/nested-arithmetic
negative checks when evaluating a repair. Readability may need additional work.

## Failed-run diagnostics (not budget baselines)

One fresh non-incremental compiler process per version, sequential on Apple M3 Max,
36 GiB RAM, Darwin 23.6.0 arm64, Node v24.11.0. OS filesystem caches were warm;
no cold-machine/cache-flush claim. External wall time includes pnpm/CLI startup;
TS check/total time is separately reported. Core build is outside these timings.

| Actual TS | Instantiations | TS check / total seconds | External seconds | TS memory K |
| --- | ---: | ---: | ---: | ---: |
| 5.8.3 | 1,856,858 | 3.31 / 3.43 | 3.69 | 508,328 |
| 5.5.4 | 1,856,016 | 3.30 / 3.45 | 3.77 | 533,791 |
| 7.0.2 | 643,901 | 1.026 / 1.057 | 1.65 | 349,571 |

TS7 is the actual native CLI, not a JS API fallback. Its instantiation counts are
not directly comparable to TS5. Logs: `/tmp/typedhouse-m3-stress-{default,5.5.4,latest}.log`.
The small failing reproduction uses 1,384,999 instantiations, 1.69s check / 1.80s
total, 339,671K TS memory on 5.8.3. No budget is created from a failed compile.
Initial unresolved-package setup errors were fixed by the isolated built-package
paths mapping; those erroneous runs are not performance evidence.

SHA256 of the tested inputs:

- chain25.ts: `7bdc0d22fa3f1d1267c261b987b76d551cccb22e86e87b73aa46ee1dc4a83a47`
- join10.ts: `ab665f29aacaa8a258946cabac2aaab9b84ff60bea8ccd5c6da3eca41481798b`
- built core index.d.ts: `1fc506c49a326298c9fd48c993770844ddeac682bc13e0d2fecbec16bc157c77`

No full check:all matrices, real-SQL 500 suites, 10M stream, or corpus snapshot
gates were rerun in this blocked attempt. Existing suites remain unchanged.
