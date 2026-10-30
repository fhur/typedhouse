# TypedHouse

Type-safe ClickHouse query builder for TypeScript: typed builder → relational IR → rewrite passes → flat ClickHouse SQL, plus codegen and a Node client. ESM-only pnpm workspace, strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node.js 20+. Not an ORM; no DDL/inserts.

## Structure
- `packages/core/src/` — dependency-free: `ch-type` parser/printer, table descriptors, `Expr` (methods generated from the catalog into `expr-methods.generated.ts`), `catalog/`, query builder (`query`, `join`, `union`, `subquery`, `ordering`), IR (`ir.ts`), known/user functions.
- `packages/compiler/src/` — `compile.ts` pipeline: `validate-structure`/`resolve*` → `rewrite-rel` (merge/push-down) → `prune-columns` → `plan-ctes` (shared nodes by identity) → `plan-selects` → `emit-naive.ts` (emitter; `emitNaive` stays forever for differential tests).
- `packages/client/src/` — `createClient`, `run`/`stream`, `backend.ts` adapters, `decode.ts`, `QueryError`.
- `packages/codegen/src/` — ClickHouse introspection and `typedhouse generate|check` CLI; snapshots under `packages/codegen/test/snapshots/`.
- `apps/docs/` — Astro/Starlight site + playground (GitHub Pages). Guide/README SQL blocks are generated and checked by `apps/docs/scripts/compiler-examples.mjs`.
- `test/types/` — type-level tests: positive files, `negative/expressions/*` (expected diagnostics), `snapshots/` per TypeScript version, `bench/` type-performance budget.
- `packages/*/test/` — Vitest unit tests (`*.test.ts`) and Docker integration tests (`*.integration.ts`). Fixture DDL/seed/corpus: `packages/compiler/test/fixtures/`.
- `scripts/` — verification scripts wired into `check:all` (type corpus, expr surface, package consumers, fixture seed, type performance).
- `spec.md` — implementation contract (API examples are the user-facing contract; milestones 1–6 are v1, 7–8 deferred; see "Decided, and still open"). `docs.spec.md` — docs site spec. `IMPLEMENTATION.md` — historical notes, may lag. `TODO.md` — progress log and current tasks (very large; read the top).
- `packages/core/KNOWN_FUNCTIONS.md`, `USER_FUNCTIONS.md` — contracts for generated known functions and bounded user scalar functions.

## Commands
- Setup: `corepack enable && pnpm install --frozen-lockfile`
- Full gate: `pnpm check:all` (testcontainers patch checks → typecheck → test → verify:type-corpus → build → package consumer verifications → verify:expr-surface → codegen integration → verify:fixture-seed → compiler/client integration). Takes ~5 min and needs Docker.
- Individually: `pnpm typecheck`, `pnpm test` (unit only), `pnpm build`, `pnpm test:compiler-integration`, `pnpm test:codegen-integration`.
- Docs: `pnpm docs:dev`, `pnpm docs:verify` (also regenerates/checks example SQL; `pnpm --filter @typedhouse/docs examples:*` to regenerate).
- Expr surface is generated: edit the catalog, then `pnpm generate:expr-surface`; `verify:expr-surface` fails on drift.
- CI runs `check:all` on TypeScript 5.5.4 and latest via `TYPEDHOUSE_TYPESCRIPT_VERSION`; type snapshots exist per version (5.5.4 / 5.8.3 / 7.0.2). Run the matrix locally when touching types.
- Integration tests use Docker image `clickhouse/clickhouse-server:24.8` (`testcontainers` is patched via `patches/`; see `patches/README.md`).

## Conventions
- Settled design decisions live in `spec.md` → "Decided, and still open"; do not relitigate them without a note.
- Every JS value becomes a `{pN:Type}` parameter, never inlined SQL. Identifiers are always backtick-quoted. `SELECT *` is never emitted by the optimizing path.
- IR sharing is by object identity; shared nodes become CTEs `tN`.
- New features ship with: runtime tests, native (integration) tests, type-level positive and negative tests, snapshot updates, and a TODO.md entry recording verification evidence.
- Do not commit `apps/playground/` or `.worktrees/`.

## Worktrees
- Create worktrees under the ignored `.worktrees/` directory: `mkdir -p .worktrees && git worktree add -b <branch> .worktrees/<name> master`.
- Install inside each worktree: `cd .worktrees/<name> && pnpm install --frozen-lockfile`.
- Worktrees start from committed files only. Run validation inside the worktree before merging; remove with `git worktree remove .worktrees/<name>` afterward.
