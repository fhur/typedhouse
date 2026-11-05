# TypedHouse

Type-safe ClickHouse query builder for TypeScript: typed builder → relational IR → rewrite passes → flat ClickHouse SQL, plus codegen and a Node client. ESM-only pnpm workspace, strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node.js 22.22+ (or 24.11+) to develop; the published packages declare no `engines`. Not an ORM; no DDL/inserts.

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
- Format: `pnpm format` rewrites in place and repeats until stable; `pnpm format:check` only reads, and fails on a Prettier deviation or a missing blank line. Both take optional paths. See "Formatting".
- Full gate: `pnpm check:all` (format check → testcontainers patch checks → typecheck → test → verify:type-corpus → build → package consumer verifications → verify:expr-surface → codegen integration → verify:fixture-seed → compiler/client integration). Takes ~5 min and needs Docker.
- Individually: `pnpm typecheck`, `pnpm test` (unit only), `pnpm build`, `pnpm test:compiler-integration`, `pnpm test:codegen-integration`.
- Docs: `pnpm docs:dev`, `pnpm docs:verify` (also regenerates/checks example SQL; `pnpm --filter @typedhouse/docs examples:*` to regenerate).
- Expr surface is generated: edit the catalog, then `pnpm generate:expr-surface --write`; `verify:expr-surface` fails on drift.
- CI runs `check:all` on TypeScript 5.5.4 and latest via `TYPEDHOUSE_TYPESCRIPT_VERSION`; type snapshots exist per version (5.5.4 / 5.8.3 / 7.0.2). Run the matrix locally when touching types.
- Type-performance budget: `node scripts/check-type-performance.mjs [--all]` — instantiation ceilings (`test/types/bench/budget.json`) are hard on every host; wall ceilings are advisory on every host class, retaining measurements and reference budgets (`budget.<slug>.json`, or `budget.json` on its own M3 Max host); record a runner budget with the manual `type-budget.yml` workflow (`--record-host-budget`), see `test/types/bench/README.md`.
- Release: `pnpm check:publish` publishes all public packages (`@typedhouse/core`, `compiler`, `codegen`, `client`) at one shared `0.0.X` version: clean up-to-date master + `npm login` → `check:all` → audit published deps (high/critical block) → pack and inspect tarballs (path allowlist `package.json`/README/LICENSE/`dist/*.js|.d.ts`, size cap, secret/local-path/source-map scan, no lifecycle scripts, `publishConfig.access: public`) → `npm publish` → commit `release: v0.0.X`, tag, push. The version comes from the registry, so a failed run resumes the same version on rerun. Rehearse with `pnpm check:publish --dry-run [--skip-checks]`.
- Integration tests use Docker image `clickhouse/clickhouse-server:24.8` (`testcontainers` is patched via `patches/`; see `patches/README.md`).

## Conventions
- Settled design decisions live in `spec.md` → "Decided, and still open"; do not relitigate them without a note.
- Every JS value becomes a `{pN:Type}` parameter, never inlined SQL. Identifiers are always backtick-quoted. `SELECT *` is never emitted by the optimizing path.
- IR sharing is by object identity; shared nodes become CTEs `tN`.
- New features ship with: runtime tests, native (integration) tests, type-level positive and negative tests, snapshot updates, and a TODO.md entry recording verification evidence.
- Do not commit `apps/playground/` or `.worktrees/`.

## Formatting
- Prettier (`.prettierrc.json`) sets the layout. Two options exist to keep it from changing code: `embeddedLanguageFormatting: off`, because it would otherwise rewrite runtime strings in `html`, `css`, `graphql` and `markdown` templates; and `quoteProps: preserve`, because unquoting keys such as `'select'` and `'ñ'` changes the syntax tree, which would defeat the check that formatting leaves it unchanged. It does not add blank lines, so ESLint (`eslint.config.mjs`) enables exactly two autofixable rules for them: `@stylistic/padding-line-between-statements` and `@stylistic/lines-between-class-members`. Add no other lint rules here. Inline ESLint comments are disabled.
- Scope: TS, TSX, JS and MJS under `packages/`, `scripts/`, `apps/docs/` and `test/types/`, minus `.prettierignore`, which is the only exclude list (ESLint reads it too). Docs Markdown examples use their own width 60 formatter (`format:examples`).
- Never format the excluded paths. A check depends on the exact bytes or lines of `test/types/negative/` (diagnostics matched by line), `test/types/bench/` and `scripts/generate-type-{bench,stress}.mjs` (`inputHash`), and generated snapshots, corpora, `expr-methods.generated.*` and fixtures. No check covers the other two: `apps/docs/src/playground/generated/` is generated output, and `apps/docs/src/examples/` is shown verbatim on the homepage. Each entry in `.prettierignore` states its reason.
- `// @ts-expect-error` applies only to the next line. To stop Prettier wrapping that statement, put `// prettier-ignore` directly above the directive before formatting; it does not unwrap a statement that is already wrapped.

### Migrating a long-lived branch
Run these on the branch, with `<tooling>` and `<rewrite>` as the two formatter commits on master. `<rewrite>` is formatting only, so keeping the branch's side of a conflict in step 5 loses nothing, as long as you merge exactly `<rewrite>` and not a later commit.
1. Commit all pending work: `git status` must be clean.
2. `git merge <tooling>` and resolve conflicts normally. If `pnpm-lock.yaml` conflicts, take one side, run `pnpm install --no-frozen-lockfile`, and confirm that `pnpm install --frozen-lockfile` then passes. Plain `pnpm install` defaults to frozen when `CI` is set. If there is no lockfile conflict, run `pnpm install --frozen-lockfile`.
3. New paths under `packages/`, such as `packages/studio`, are already in scope. Add any generated, snapshot, or fixture paths on the branch to `.prettierignore`, along with any file a check reads byte for byte.
4. `pnpm format`, then `pnpm typecheck`, then `git add -A && git commit -m "style: format branch"`. A TS2578 means a `@ts-expect-error` statement wrapped: fix that statement so it fits on the next line again, because adding `// prettier-ignore` does not unwrap it.
5. `git merge -X ours <rewrite>`. `-X ours` does not settle modify/delete conflicts. For each file the branch deleted or renamed, run `git rm <path>`. A rename also appears this way, because rename detection does not fire after the rewrite, and `git add -A` would bring the old file back. Then restore every existing file that step 3 newly excluded, which the merge still reformats: `git checkout <step 4 commit> -- <path>`. If the merge stopped, `git commit --no-edit` finishes it, including those restores. If it completed by itself, commit them with `git commit -m "style: restore excluded files"`.
6. `pnpm format`, and if it changed anything, `git add -A && git commit -m "style: reformat after merge"`.
7. `pnpm format:check` must pass. `git diff <step 4 commit> HEAD` should be empty.
8. `git merge master` for anything newer, resolving conflicts normally.

## Worktrees
- Create worktrees under the ignored `.worktrees/` directory: `mkdir -p .worktrees && git worktree add -b <branch> .worktrees/<name> master`.
- Install inside each worktree: `cd .worktrees/<name> && pnpm install --frozen-lockfile`.
- Worktrees start from committed files only. Run validation inside the worktree before merging; remove with `git worktree remove .worktrees/<name>` afterward.
