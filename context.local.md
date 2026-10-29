# chql

Typed ClickHouse query algebra. ESM-only pnpm workspace using strict TypeScript; Node.js 20+ required.

## Structure
- `packages/core/src/` — dependency-free types, descriptors, expressions, relational IR.
- `packages/codegen/src/` — ClickHouse introspection and generation CLI.
- `packages/compiler/src/` — validation, rewrites, SQL emission.
- `packages/client/src/` — execution, streaming, decoding.
- `test/` — workspace tests (Vitest).
- `spec.md` — implementation contract; milestones 1–6 are v1, 7–8 deferred.
- `TODO.md` — progress and current tasks.
- `README.md` — setup and development overview.

## Commands
- Setup: `corepack enable && pnpm install`
- Validate: `pnpm check:all` (typecheck → test → build).
- Individually: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Integration tests require Docker (`clickhouse/clickhouse-server:24.8`).

## Worktrees
- Create worktrees under the repository's ignored `.worktrees/` directory, not `/tmp` or sibling directories.
- From the repository root: `mkdir -p .worktrees && git worktree add -b <branch> .worktrees/<name> master`.
- Install dependencies inside each worktree: `cd .worktrees/<name> && pnpm install --frozen-lockfile`.
- Worktrees start from committed files; they do not include uncommitted changes from the main checkout. Preserve that work when merging back.
- Run validation inside the worktree before merging. After merging, remove it from the repository root with `git worktree remove .worktrees/<name>`.
