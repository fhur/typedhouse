## Studio (@typedhouse/studio) — in progress

Brief: requirements R1–R11 in the session's `studio-brief.md` (it's the source of truth). Single user on localhost, so keep it simple: few files, few dependencies, no auth.

**Architecture sketch.**
- `packages/studio` (`private: true`) runs one Node process on `127.0.0.1`. It serves tRPC v11 (superjson) at `/trpc`, plus the React+Vite UI: Vite middleware in dev, built `dist/web` static files from the `typedhouse-studio` bin.
- `server/eval.ts` takes the editor source. It transpiles with `ts.transpileModule`, allows imports from `@typedhouse/core` only, and evaluates in `node:vm` with a timeout. The introspected tables (`renderSchema` output) and the core exports are in scope. The result is a `Query`, then `compile` gives sql/params, and `rel.output` + `toTypeScript` gives the row type.
- `server/clickhouse.ts`: `introspect` sets up the schema once at start (with a refresh action), and `@typedhouse/client` `createClient({ clickhouse_settings: { readonly: '2' } })` runs queries. It must be `2`, not `1`: the backend sends output settings with every query.
- `server/llm.ts`: pi-ai `createModels({ credentials: piAuthFileStore })` + `openaiCodexProvider()` (or the configured provider). A pi-durable `Harness` (SQLite in the data dir) has one tool, `check_query`, which calls `eval.ts`; the model must call it until compile succeeds. Tests use pi-ai `fauxProvider`.
- Data dir `~/.typedhouse/studio/` (`--data-dir` overrides it) holds `saved.json` and the pi-durable SQLite. The frontend is `web/` (React 19, CodeMirror 6, vanilla `@trpc/client`, vega-embed) with one keymap module.

**tRPC procedures (contract; the Worker may refine the shapes).** `meta.get` → connection label, model `{provider, modelId}` or the reason it's unavailable, tables `[{name, columns:[{name,type}]}]`. `schema.refresh`. `query.run({source, autoLimit})` → `{sql, params, rowType, columns, rows, rowCount, limited, elapsedMs}`, or a typed error `{stage: 'parse'|'evaluate'|'compile'|'clickhouse', message}`. `ai.generateQuery({prompt, source?})` → `{source, sql, rowType, attempts}`. `ai.generateChart({prompt, columns, sample})` → `{spec}`. `saved.list`, `saved.save({name, prompt, source})`, `saved.delete({name})`.

**Decisions (orchestrator, after S1).**
- OAuth refresh race with a running `pi` on the shared `auth.json`: originally accepted with no lockfile. **Superseded in S2:** the Worker used pi's own lock (`proper-lockfile`, a `auth.json.lock` directory, 30 s stale). Writes from pi and the studio no longer interleave, and the Tester verified that a lock held by another process is honoured. `modify` re-reads inside the lock, writes atomically (temp + rename, pi's `JSON.stringify(…, null, 2)` format) and keeps other providers and the file mode. Remaining gap: `read`/`list` don't take the lock (follow-up F3).
- Data dir: `~/.typedhouse/studio` (`--data-dir` overrides it).
- Editor contract: tables and core exports are in scope with no imports; the query is `export default`, `export const query`, or a top-level `query` binding.
- Auto-limit: the SQL tab shows `.limit(100)` → `LIMIT 100`; the server executes `.limit(101)` so `limited` is exact.
- Evaluation is not a sandbox (single local user). It runs in-process with `vm.runInThisContext`, a 1 s timeout, strict mode, and shadowed `process`/timers/`globalThis`. An AST guard rejects async code, non-core imports, `require` and dynamic import. A process-level `unhandledRejection`/`uncaughtException` net is the last resort.
- `pnpm-lock.yaml` churn is accepted: `(tsx@4.23.15)` peer suffixes on vite/vitest/tsup/astro and the new `packages/studio` importer. The stale `apps/playground` importer is kept.
- Studio integration tests (`pnpm --filter @typedhouse/studio test:integration`) are not wired into `check:all` yet.
- Dev start: `TYPEDHOUSE_URL=… TYPEDHOUSE_USER=… TYPEDHOUSE_PASSWORD=… TYPEDHOUSE_DATABASE=… pnpm --filter @typedhouse/studio dev` → `http://127.0.0.1:5480`. No prior build is needed: tsx follows the root `tsconfig.json` `paths` to `packages/*/src` (verified in S2+S3 item 0).
- LLM flags (S2): `--model <provider>/<id>` > `TYPEDHOUSE_STUDIO_MODEL` > pi `settings.json`. `--pi-dir` > `TYPEDHOUSE_STUDIO_PI_DIR` > `PI_CODING_AGENT_DIR` > `~/.pi/agent`. `--data-dir` > `TYPEDHOUSE_STUDIO_DATA_DIR` > `~/.typedhouse/studio`. pi-durable stores its state in `<data-dir>/pi.sqlite`, imported lazily because `node:sqlite` warns on import.
- Models come from `builtinModels()` (`@earendil-works/pi-ai/providers/all`), so any provider configured in pi works, not only openai-codex. The cost is weight: pi-ai pulls in every provider SDK, and the `pnpm-lock.yaml` diff grew to +998/−44 with the pi stack (pi-ai, pi-durable, chord, pi-schema, proper-lockfile). Accepted for now. If install size matters, narrow it later to the configured provider's factory.
- Generation (S3): auto-run of a generated query is the orchestrator's call, consistent with "fastest from idea to data". It is kept, shown with a proposal notice, unless the user objects.
- **Model default (user decision, after F5):** Studio defaults to `openai-codex/gpt-5.6-sol` and ignores pi's `settings.json` default model. Credentials still come from pi's `auth.json`.
  - Precedence becomes `--model` > `TYPEDHOUSE_STUDIO_MODEL` > `openai-codex/gpt-5.6-sol`.
  - The `models-store.json` fallback stays for override ids missing from the pi-ai catalog.
  - A "Switch model…" action in the ⌘K palette (S6) changes the model for the running session only; it is not persisted.
- **F4b is prompt-only (orchestrator):** there is no formatter. Real model output is already multi-line, so one line in the system prompt asks for one chained call per line.
- **No success notice after a generation (user, S7):** the replaced editor content and the results speak for themselves. Only failures show a message, with "Load the last attempt".
- **Type errors don't block runs (orchestrator, S9):** ⌘↵ still evaluates and compiles when the editor has type errors; they are shown inline and in the badge. A generated query must have zero type errors *and* compile before it is accepted.

**Open risks.**
- pi-ai 1.5.0's static `openai-codex` catalog has no `gpt-5.5`. S2 filled it in from `models-store.json`, but the real smoke (F5) showed that Codex rejects it for ChatGPT accounts: "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account." **Resolved** by the user's model decision above: the default is `openai-codex/gpt-5.6-sol`, which is in the static catalog and passed F5.
- Settled in S1: the root `tsconfig.json` includes `packages/**/*.ts` with no DOM types. Studio's own `tsconfig.json` (DOM, jsx) covers `web/*.tsx` via `pnpm --filter @typedhouse/studio typecheck`; root `pnpm typecheck` does not check the `.tsx` files.

### S1 — Scaffold, server, schema, ⌘↵ run with Table/SQL tabs and auto-limit
- Refs: R3, R5, R7, R8, R10 (minimal parts of R6 and R9).
- Acceptance:
  - `pnpm --filter @typedhouse/studio dev` starts from a fresh `pnpm install` and prints `http://127.0.0.1:<port>`. The server binds 127.0.0.1 only. The connection comes from `--url/--user/--password/--database` or `TYPEDHOUSE_URL/USER/PASSWORD/DATABASE`. A `typedhouse-studio` bin exists and serves the built UI.
  - The sidebar lists the introspected tables with column counts, and they are in scope in the editor (e.g. `from(events)` with no import).
  - ⌘↵ / Ctrl+Enter runs the editor source. The Table tab shows decoded rows; bigint and Date survive through superjson. The SQL tab shows formatted SQL + params. The UI shows row count and elapsed time. Errors show their stage and message, not a stack.
  - Auto-limit is on by default (100 rows) and toggled only by ⌘/ (no button). The footer shows "Auto-limit 100 rows" / "Auto-limit off". ⌘1 / ⌘3 switch Table / SQL.
  - Rejected: non-core imports, dynamic import, `require`, and a runaway loop (vm timeout returns an error and the server stays up). Writes are refused by readonly=2.
  - Tests: unit tests for eval (good query, bad import, timeout, compile error, row type string) and auto-limit. A new `packages/studio/test/*.integration.ts` using the testcontainers pattern (24.8 + fixture `schema.sql`): `meta.get` lists fixture tables, `query.run` returns rows with limited/unlimited counts, and an INSERT/DDL attempt fails. Root `pnpm typecheck` and `pnpm test` stay green.
- Depends on: —
- Status: **done.** The one open criterion, a fresh-install dev start, was closed by item 0 of the S2+S3 slice.
  - The Tester moved `dist` aside for core, compiler, client and codegen. `pnpm --filter @typedhouse/studio dev` printed the URL and the page loaded with 0 browser errors.
  - The mechanism: tsx resolves `@typedhouse/*` through the root tsconfig `paths` to `src`. No dev script change was needed; the earlier PM finding missed that tsx honours `paths`.
- Evidence (Tester final round, round 3 of 3, plus PM verification):
  - Root `pnpm typecheck`: passed on 3 runs.
  - Root `pnpm test`: 116 files, 1487 passed, 1 skipped, 0 failed. This includes the studio unit tests via the root `packages/**/*.test.ts` glob.
  - Studio unit tests: 48/48, in `test/eval.test.ts` and `test/eval-escape.test.ts`. They cover evaluate, auto-limit and the keymap; `eval-escape` runs in child processes.
  - Studio integration tests: 36/36, in `test/studio.integration.ts` and `test/studio-tester.integration.ts`, against ClickHouse 24.8 via testcontainers.
    - Auto-limit is exact at 0/99/100/101 rows, and over user limits, offset, union and join.
    - superjson round-trips bigint, Date, Decimal, Map, Tuple, pre-1970 DateTime64(9) and `__proto__` columns (sent bracketed as `[__proto__]`).
    - readonly=2 refuses writes, DDL, SYSTEM, GRANT and SET.
    - The server survives runaway synchronous loops, async hangs and rejections.
  - Playwright UI run: 24 checks passed, covering Ctrl+Enter, Ctrl+/, Ctrl+1/3, Ctrl+L, error stages, and dragging/clamping the divider.
  - PM, 2026-11-03: `tsc -p packages/studio/tsconfig.json --noEmit` exits 0, covering `web/*.tsx`.
  - PM, code read:
    - The server binds `127.0.0.1` (`server.ts`). Flags and env vars are handled in `main.ts`. `bin` is `dist/main.js` with a shebang, serving `dist/web`.
    - Tables are in scope via `schemaScope`/`editorScope`.
    - Auto-limit is on by default, toggled by ⌘/ only; there is no toggle button, and the footer label switches.
    - Errors are reported by stage: parse, evaluate, compile or clickhouse.
    - `readonly: '2'` is set on both the driver and the client.
  - `pnpm-lock.yaml` diff: +191/−44, matching the accepted churn.
- Known limitations carried forward:
  - The editor scrolls horizontally on long lines (S7).
  - The prompt input does nothing yet (S3).
  - The Chart tab is a placeholder (S4).
  - Clicking a sidebar table does nothing (S6, which will insert `from(<table>)`).
  - The ⌘K button is a placeholder (S6).
  - Root `pnpm build` (`pnpm -r build`) now builds studio too: a Vite build plus a tsup build.

### Next Worker slice: S8 — final gates, bundle, README (selected 2026-11-03; the final slice)
This slice is kept small. Owners are marked; the full criteria are in the **S8** entry below.
- **Worker:** F12 lazy-loads sql-formatter, then `packages/studio/README.md`.
- **Tester:** F19 (fix the `/tmp` leak in its own `test/s7.test.ts`), then the final gates including `pnpm check:all`.
- **Orchestrator:** the final real-model smoke.

### Done slice: S9 — editor language intelligence (R12) (selected 2026-11-03, done 2026-11-03 in `3b1e6f8`)
The scope and acceptance criteria are in the **S9** entry below. Decision applied: type errors don't block ⌘↵, and a generated query must have zero type errors.

### Done slice: S7 — visual fidelity and polish (selected 2026-11-03, done 2026-11-03 in `c9b9444`)
Mockups (read-only) are in the session scratchpad, `studio/project/`: `Main.dc.html`, `Chart.dc.html`, `Palette.dc.html`. Tokens and fonts come from `apps/docs/src/styles/tokens.css`; syntax colors from `apps/docs/src/styles/code-themes.mjs`. After this slice: S8.
- **Fidelity: match the three mockups at 1440 px, plus the responsive rules under 1000 px and 760 px.**
  - Header:
    - Night background; logo, then "TypedHouse Studio".
    - Connection chip: `clickhouse · <db>` with a status dot.
    - Model chip: "pi durable <model>", or "LLM unavailable" with the reason as a tooltip.
    - The "Commands, tables, queries ⌘K" button.
  - Sidebar:
    - "Tables" with a count; each row has an icon, the name and "N cols", and a hover/selected state.
    - "Saved", then the shortcut hints at the bottom.
  - Left pane:
    - Prompt row: sparkle icon, input, "Generate ↵".
    - `query.ts` card on night, with line numbers, the inferred row type `→ { … }`, the "Compiles"/error badge, and a Run ⌘↵ button.
    - CodeMirror highlighting uses the `code-themes.mjs` token colors (kw/fn/val/num/punct/plain).
  - Results:
    - Tabs with kbd hints; status shows "N rows (limited) · M ms".
    - Table: index column; numeric columns right-aligned in mono; NULL muted.
    - SQL view with a parameters panel.
  - Footer: ready dot, the auto-limit state, and hints.
  - Chart tab per `Chart.dc.html`: chart prompt row, title area, brand palette.
  - Palette per `Palette.dc.html`: an "Ask" row at the top, then grouped results with kbd hints.
  - Light theme is the default. Dark via `prefers-color-scheme` is optional; if done, the editor and chart follow it.
- **Editor scrolling (S1 limitation).** Enable line wrapping, keeping indentation readable. After any programmatic replace (generate, load saved, insert table), scroll to the top-left.
- **F4a:** the kbd inside the generation notice renders inline, not as a full-width block. *Superseded 2026-11-03: the user removed the success notice; see the S7 entry.*
- **F7:** chart axis and legend titles default to the plain column name (`c.entityId`, not `c\.entityId`) when the model gave no `title`.
- **F11:** a generation keeps the current tab, unless the current tab is Chart with no spec; then it switches to Table.
- **Palette "Ask" row (per mockup):**
  - With typed text, the first row is "Ask: <text>". Enter on it closes the palette, puts the text in the prompt and generates.
  - It is shown only when the LLM is available. Otherwise the row says why and is inert.
- **F13: tables shadowing core exports.**
  - When a table binding collides with a `@typedhouse/core` export name, it gets a non-colliding binding (e.g. `from_table`; the scheme is the Worker's choice but must be deterministic), so core functions keep working.
  - `db.<name>` keeps the original name.
  - The sidebar, the palette's table insertion and the LLM schema section all use the same binding as the editor scope.
  - Test: a fixture table named `from` and one named `count`. `from(from_table)` runs, and `count()` still works.
- **F14:** loading a saved query without a chart also clears the persisted chart state, so a reload shows no stale chart.
- **F15:** `models.select` refuses a model whose provider has no credential (the same check as `models.list`), with a clear error.
- **F18:** `startServer`/`createRouter` no longer default `dataDir` to `~/.typedhouse/studio`. Make it required; `main.ts` resolves the default. Update the tests that start servers to pass a temp dir.
- **Optional, only if cheap:**
  - F8: escape object-form `repeat`.
  - F9: backslash in column names.
  - F10: a chart-only rename for `[__proto__]`.
  - If skipped, leave them as follow-ups.
- **Tests:**
  - Unit tests for F13 binding names, F15, and the F11 tab rule (a pure function is fine).
  - An F7 headless render test.
  - An integration case for F13 on the fixture, and an F18 temp dir everywhere.
  - Playwright:
    - wrapping: no horizontal scrollbar for a 200-character line;
    - after a replace, the editor shows line 1;
    - the F4a notice layout;
    - the palette Ask row generates;
    - F14 across a reload;
    - the tab rule.
- **Evidence:** screenshots at 1440 px and 900 px of the workspace (table and SQL), the chart tab and the palette, each next to its mockup, saved to the session scratchpad. List any intentional differences.
- **Gates:** root `pnpm typecheck` and `pnpm test`, studio `typecheck`, `test:integration` and `build`.
- **Out of scope:** F12, README and `check:all` (all S8), F16, F17, the landing page, and persisting the model choice.

### Done slice: S5+S6 — saved queries, ⌘K palette, full keymap, "Switch model…" (selected 2026-11-03, done 2026-11-03)
Merged because the palette lists saved queries, and both add shortcuts (⌘S, ⌘K) to the same `keymap.ts`/`main.tsx`. After this: S7 (visual fidelity, with F4a/F7/F11), then S8.
- **Saved store, `server/saved.ts`.**
  - File: `<data-dir>/saved.json`, shaped `{ version: 1, queries: [{ name, prompt, source, chart: spec | null, updatedAt }] }`.
  - Writes are atomic (temp + rename, mode 0600), and the data dir is created on first save.
  - Names are trimmed, 1–100 characters, and unique.
  - A corrupt or unreadable file gives a clear error from `saved.list`. It is never overwritten: saves are refused until the file is fixed or moved aside, and the message says so.
- **tRPC.**
  - `saved.list` returns the queries newest `updatedAt` first.
  - `saved.save({ name, prompt, source, chart?, overwrite? })` returns `{ ok: true }`, or `{ ok: false, exists: true }` when the name exists and `overwrite` isn't set.
  - `saved.delete({ name })`.
  - `models.list` returns the chat models of providers that have credentials, as `[{ provider, modelId, name }]`; empty with a reason if none.
  - `models.select({ provider, modelId })` changes the model for later generations in this server session only. Nothing is persisted, and a restart reverts to the flag/env/default. After it, `meta.get.model` reflects the choice.
- **UI, saved queries.**
  - ⌘S (new `save` action; prevent the browser save dialog) opens an inline name field, prefilled from the prompt or "Untitled".
  - An existing name asks for confirmation, then overwrites.
  - The sidebar "Saved" lists the entries. Clicking one loads its prompt, source and chart spec, if any, without running. Each entry has a delete control with confirmation.
  - The editor head shows the loaded name. Edits since loading mark it modified (a dot is enough).
- **UI, palette (`web/palette.tsx` + pure `web/palette-match.ts`).**
  - ⌘K, or the header button, opens a modal per `Palette.dc.html`: an input plus grouped results under Actions, Tables and Saved.
  - Ranking uses case-insensitive subsequence matching, with prefix and word-start bonuses.
  - Actions: Run, Toggle auto-limit, Show Table / Chart / SQL, Ask in English (focus prompt), Describe a chart (⌘G), Save query, Refresh schema, Switch model….
  - A table result inserts `from(<binding>)` at the editor cursor. A sidebar table click does the same, which fixes the S1 limitation.
  - A saved result loads the query.
  - "Switch model…" opens a second step listing `models.list`, with the current model marked. Choosing one calls `models.select`, and the header chip updates.
  - Keys: arrows move, Enter runs, Esc closes and restores the previous focus, and the mouse works too. Other shortcuts are inert while the palette is open, except Esc.
- **Keymap.** Add `palette` (⌘K) and `save` (⌘S) to `keymap.ts`. All shortcuts work while CodeMirror is focused and use ⌘ on macOS, Ctrl elsewhere. The sidebar hints and footer list ⌘K and ⌘S.
- **Tests (Worker's own files).**
  - Saved store unit tests:
    - create; list order;
    - overwrite refused, then accepted with `overwrite`;
    - delete; name validation;
    - a corrupt file gives an error and the file is untouched byte-for-byte;
    - no temp files are left behind.
  - `palette-match` ranking unit tests, and keymap tests for ⌘K/⌘S/Ctrl variants.
  - `models.select` with a faux provider holding two models: the next `generateQuery` uses the selected model, and `meta.get` reflects it.
  - One integration case: saved round trip over tRPC with a temp data dir.
  - Playwright:
    - ⌘K opens; typing filters; Enter runs Toggle auto-limit and the footer changes;
    - a table result inserts `from(...)`;
    - ⌘S saves, the entry appears in the sidebar, and a click loads it;
    - Switch model updates the chip; Esc closes and restores focus.
- **Gates:** root `pnpm typecheck` and `pnpm test`, studio `typecheck`, `test:integration` and `build`.
- **Out of scope:** S7 visuals, F7–F12, persisting the model choice, and rename/folders for saved queries.

### Done slice: S4 chart + F1 abort fallback + F4b/F6 prompt tweaks + model default (selected 2026-11-03, adjusted after F5, done 2026-11-03)
Selected because the chart is the last LLM feature in the brief (R4), and the other items are small changes in `server/llm.ts` and `server/pi.ts`. S5/S6 have no LLM work and can follow.
- **Model default (user decision).**
  - `setupModels` defaults to `openai-codex/gpt-5.6-sol` and no longer reads `settings.json` for the model. `--model` and `TYPEDHOUSE_STUDIO_MODEL` still override.
  - Update `--help` and the startup line.
  - The Worker updates only its own test, `test/pi.test.ts`: the default is used, an override wins, and `settings.json` doesn't affect the model.
  - **Flag for the Tester:** the Tester-owned `test/pi-tester.test.ts` now conflicts with the decision. These cases assume `settings.json` drives the model:
    - the precedence cases that write `settings.json` (around lines 36/44);
    - "missing or malformed settings.json gives a clear reason" and "an unknown provider from settings.json is reported" (around lines 112–121);
    - "resolves the user's real pi settings + models-store" (around line 131).
    The Tester rewrites them. The Worker must not edit that file.
- **F4b (prompt-only).** Add one GUIDE line asking for one chained call per line. No formatter, and no formatter test.
- **F6 (prompt-only).** Add one GUIDE line, plus a cheat-sheet example, saying that when combining tables with `unionAll`, each branch maps a literal label column: `source: val('<table>')`. Test: a faux-scripted `unionAll` with `val` labels passes `check_query`, which shows the guidance compiles.
- **S4 server: `ai.generateChart`.**
  - Input: `{ prompt, columns: [{name, type}], sample }`, with `sample` holding at most 20 rows that the client sends from the current result. The server stays stateless.
  - It reuses the S3 Harness: a fresh conversation, `maxTurns` 6, and one tool, `check_chart({ spec })`, that ends the run when it passes.
  - `check_chart` rejects:
    - specs that don't parse or aren't an object;
    - a model-supplied `data` (`values`, `url`, or a `name` other than the studio's);
    - any `field` reference (in encodings, sort, tooltip, or transform inputs) that isn't a result column or a name created earlier in the transform (`as`).
  - Return: `{ ok: true, spec, attempts }` or `{ ok: false, error, spec | null, attempts }`. Only a spec that the server check accepted can be `ok`, and the server re-checks it before returning, as `generateQuery` does.
  - Charts and queries share the busy guard, so only one generation runs at a time.
- **S4 web.**
  - The Chart tab (⌘2) gets a chart prompt; ⌘G switches to Chart and focuses it. Add `chartPrompt` to `keymap.ts`.
  - Render with vega-embed, loaded through dynamic `import()` so vega stays out of the initial bundle. The spec persists across reruns and redraws on new rows.
  - A pure `toChartData(rows, columns)` flattens column paths to names. It turns bigint into number, and numeric-typed strings (Decimal, quoted 64-bit) into numbers. Date stays Date. Map, Tuple and Array become JSON text.
  - A small Vega config using the brand tokens (lavender palette, Inter/JetBrains Mono). Full chart-mockup fidelity stays in S7.
  - A run never switches tabs by itself, and the initial view is Table.
- **F1 abort fallback.** In `generateQuery`/`generateChart`, the timeout path must not wait forever on `conversation.abort()`. Race it against a short grace timer of about 5 s, always clear the busy flag, and return a timeout error. Test: a stub provider that ignores the abort signal. The call returns within `timeoutMs` + grace, and the next generation is accepted, not refused as busy.
- **Tests and gates.**
  - Faux-provider tests in `test/chart.test.ts` (or similar):
    - a valid spec on the first try;
    - an unknown field, where the tool error goes back to the model and the second attempt passes, so `attempts === 2`;
    - an inlined `data.values` is refused;
    - the turn limit gives a clean error;
    - an injected prompt can't get a spec that fails the check returned as `ok`.
  - Unit tests for `toChartData`, covering bigint, Decimal, Date, null and nested paths.
  - One integration case: on the fixture, run a query, then faux `ai.generateChart`, and the spec's fields match the result columns.
  - Playwright: ⌘G focuses the chart prompt; the chart renders (an `svg`/`canvas` exists in the Chart tab); ⌘1 goes back to Table; rerunning keeps the chart; ⌘↵ still works while the LLM is unavailable.
  - Gates: root `pnpm typecheck` and `pnpm test`, studio `typecheck`, studio `test:integration`, and `pnpm --filter @typedhouse/studio build`. Check that vega is in a separate lazy chunk.
- Out of scope: S7 visuals, including F4a. Saved charts belong with S5.

### Done slice: S2+S3 together (selected 2026-11-03, done 2026-11-03)
Merged because S2 has no user-visible value on its own and both touch the same files (`main.ts` flags, `meta.get`, a new `server/llm.ts`). Target: type English, get a checked, editable query that runs.
- Item 0 (S1's open criterion): the dev start works on a checkout without `packages/*/dist`, by building the four workspace dependencies before starting, or resolving them from source. Evidence: delete `packages/{core,compiler,client,codegen}/dist`, run `pnpm --filter @typedhouse/studio dev`, and see the URL printed.
- Files, as a suggestion (the Worker may adjust):
  - `server/pi.ts`: the credential store and model resolution.
  - `server/llm.ts`: Harness, system prompt, the `check_query` tool, and `generateQuery`.
  - Changes to `server/main.ts`, `server/server.ts` and `web/main.tsx`.
  - Tests: `test/pi.test.ts`, `test/llm.test.ts`, plus one case added to the integration test.
- New flags and env vars: `--model <provider>/<id>` / `TYPEDHOUSE_STUDIO_MODEL`; `--pi-dir` / `TYPEDHOUSE_STUDIO_PI_DIR` (default `~/.pi/agent`); `--data-dir` / `TYPEDHOUSE_STUDIO_DATA_DIR` (default `~/.typedhouse/studio`).
- pi-durable: `Harness.open(openNodeSqliteStorage(<data-dir>/pi.sqlite), { models, registry })`, with tests on `MemoryStorage`. One conversation per generation, `maxTurns` 6. The system prompt section holds `renderSchema` output, the editor contract and a short builder cheat sheet.
- `createRouter` takes the LLM as an injected dependency, so tests pass a faux-backed one.
- See S2 and S3 below for the acceptance criteria. On top of those:
  - Only source that the server-side `check_query` accepted, compiled by the same `prepare()` used for runs, reaches the editor.
  - On success the UI replaces the editor content and runs it at once, with auto-limit as currently set. Mark this auto-run as a proposal for the user to confirm.
  - The UI shows a "Generating…" state; Esc or a second Enter does not start a duplicate request.
  - An unavailable LLM never blocks ⌘↵ runs.

### S2 — pi credentials and model selection
- Refs: R2.
- Acceptance:
  - `server/pi-auth.ts`: a `CredentialStore` over `~/.pi/agent/auth.json` (`--pi-dir` / `PI_CODING_AGENT_DIR`-style override). It covers `read`, `list` (no secrets), a serialized `modify` that writes the same JSON format atomically and keeps other providers and the 0600 mode, and `delete`.
  - The model comes from `settings.json` `defaultProvider/defaultModel`, overridable by `--model provider/id` / `TYPEDHOUSE_STUDIO_MODEL`. A model missing from the pi-ai catalog is filled in from `models-store.json` (see risks). The header model chip shows `provider · model`, or "LLM unavailable: <reason>" while the rest of the app keeps working.
  - Unit tests on a temp pi dir: read of an OAuth credential, `modify` round-trip byte-compatible with pi's shape, concurrent `modify` serialized, model resolution (settings, then flag override, then models-store fallback, then clear error). No network.
  - `meta.get.model` returns `{ available: true, provider, modelId }` or `{ available: false, reason }`, and the chip renders both.
- Depends on: S1
- Status: **done** (Tester OK, PM verified).
- Evidence:
  - `test/pi.test.ts` and `test/pi-tester.test.ts`: 20 cases by the PM's count of `it(` (the Tester reported 12), all on temporary pi dirs with no network.
    - Malformed or missing `auth.json`/`settings.json` are handled, and `list()` leaks no secrets.
    - Writes keep the file mode and other providers.
    - A cross-process `proper-lockfile` lock is honoured, and bad `--model` values are rejected.
    - Precedence was checked by real server starts. Copies of the real settings and models-store resolve to `openai-codex/gpt-5.5`.
  - The UI chip shows "LLM unavailable" while Ctrl+Enter still works (Playwright).
  - PM code read of `server/pi.ts`:
    - `piCredentialStore`: the lock, re-read inside the lock, a temp-file rename, and the existing mode kept.
    - `chooseModel`/`parseModelRef`, and `setupModels` with the models-store fallback.
    - `checkAuth` only checks that a credential exists, with no network.
    - The `~/.pi` directory was never written in tests.

### S3 — Text → query with compile-and-fix loop
- Refs: R1, R2, R6 (⌘L).
- Acceptance:
  - ⌘L focuses the prompt. Enter calls `ai.generateQuery`, which runs a pi-durable Harness conversation. The system prompt holds the rendered schema plus builder guidance and examples. The `check_query` tool returns compile errors or `{sql, rowType}`, and `maxTurns` is bounded (around 6).
  - The returned source has passed `check_query` server-side before it reaches the editor. It replaces the editor content as editable code, and the prompt is kept. A final failure shows the last error and the model's best source, not marked as passing.
  - Tests with `fauxProvider`: (a) a happy path in one attempt; (b) the first source fails to compile, the tool error goes back to the model, the second attempt succeeds, and `attempts === 2`; (c) the model never produces valid code and the turn limit gives a clean error. No network.
  - Integration: on the fixture schema, a faux-scripted `ai.generateQuery` returns source that `query.run` then executes, returning rows.
  - Root `pnpm typecheck` and `pnpm test`, studio `typecheck`, and studio `test:integration` all stay green.
- Depends on: S1, S2
- Status: **done** (Tester OK, PM verified). Real-model smoke F5 passed with `gpt-5.6-sol`: 3 of 3 prompts.
- Evidence:
  - Gates: root `pnpm typecheck` passes. Root `pnpm test`: 120 files, 1527 passed, 1 skipped (2 runs). Studio `test`: 6 files, 88/88. Studio `test:integration`: 37/37.
  - `test/llm.test.ts` and `test/llm-tester.test.ts`: 17 cases by the PM's count of `it(` (the Tester reported 13), all with the faux provider.
    - Only checked source is returned as `ok`, and code written in prose is ignored.
    - Malformed tool arguments are survived, and prompt-injected import/require/async is always refused.
    - Stalls that honour the abort signal time out.
    - A provider error keeps the last source, marked as not passing.
    - 200 KB prompts are handled, runaway loops fail the check, and concurrent generation is refused.
  - Integration: a generated query then runs against the fixture.
  - Playwright harness, `test/ui-harness.ts` (faux LLM), 16 checks passed:
    - Ctrl+L, and a Generating state with `aria-busy`.
    - Triple Enter gives a single request.
    - The editor is replaced and auto-runs: "100 rows (limited)".
    - The proposal notice shows, and the prompt is kept.
    - A failure shows "Load the last attempt".
  - PM code read of `server/llm.ts`:
    - One Harness, a fresh ownerless conversation per generation, `maxTurns` 6.
    - `check_query` calls the same `prepare()` as a run (`conn.check`), with `terminate` when it passes.
    - `readOutcome` takes the last `check_query` result, and the server re-checks it before returning `ok`.
    - The SQLite storage is in the data dir.
  - The real LLM was never called.
- Follow-ups (non-blocking):
  - **F1:** a provider that ignores the abort signal hangs `generateQuery` forever. The timeout path awaits `conversation.abort()`, and the busy flag stays set. Fix with a plain grace timer (in the next slice).
  - **F2:** two `check_query` calls in one turn, pass then fail, report failure. This is safe; it only costs a retry.
  - **F3:** `read()`/`list()` of `auth.json` take no lock, and pi writes in place. A rare torn read shows as "LLM unavailable"; fix with a retry on JSON parse failure or a read under the lock.
  - **F4a (S7):** in the "Generated in N attempts" notice, the `Ctrl+↵` kbd renders as a full-width block.
  - **F4b:** generated source may arrive on one long line. Now prompt-only in the next slice: one GUIDE line, no formatter. Real output in F5 was already multi-line.
  - **F5 — done 2026-11-03.** Orchestrator smoke on the fixture ClickHouse with the real pi credential:
    - The default `openai-codex/gpt-5.5` was rejected by Codex ("not supported when using Codex with a ChatGPT account"). The error surfaced cleanly in about 1 s, which shows the plumbing and auth work.
    - `openai-codex/gpt-5.6-sol` succeeded on 3 of 3 prompts:
      - "how many components are in each state": 1 attempt, 6.7 s.
      - "for each metric group table, which one has the most rows": 3 attempts, 12.5 s, using `unionAll` over 4 tables. There is no label column for the source table, so "which one" can't be read from the output (F6).
      - "components updated in the last 30 days with more than 2 parts, newest first, with their state": 1 attempt, 3.9 s.
    - All output was already well-formatted and multi-line.
    - `auth.json` was not modified; no refresh was needed.
  - **F6:** when combining tables with `unionAll`, the model should add a literal label column for each source. The builder supports this with `val()`, e.g. `from(t).map(r => ({ source: val('t'), ... }))`; `val` is exported from `@typedhouse/core` and binds a parameter. Handled as a prompt tweak in the next slice.

### S4 — Prompt → Vega-Lite chart
- Refs: R4, R6 (⌘2, ⌘G).
- Acceptance:
  - The Chart tab (⌘2) has a chart prompt (⌘G focuses it). `ai.generateChart` sends the column names and types plus a few sample rows, and gets back a Vega-Lite spec. The server validates the spec: it parses, `data` is not inlined by the model, and fields reference existing columns. The spec is rendered with vega-embed over the current rows; bigint is converted to number for the chart only.
  - The Table stays the default view after each run. The chart re-renders on re-run with the same spec.
  - Tests: faux-provider unit test (valid spec accepted; unknown field rejected or repaired via a retry), plus a renderer smoke test of the spec→data binding function.
- Depends on: S1, S2
- Status: **done** (Tester OK after 2 rounds, PM verified), together with F1, F4b, F6 and the model default.
- Evidence:
  - Gates: root `pnpm typecheck` passes. Root `pnpm test`: 122 files, 1592 passed, 1 skipped, 0 failed (2 runs). Studio `test`: 8 files, 153/153. Studio `test:integration`: 38/38.
  - Build: vega is in a lazy chunk. PM checked `dist/web/assets`: `embed-*.js` (851 KB) holds vega, and `index-*.js` (861 KB) has no vega and no server code (`transpileModule`, `@earendil` absent).
  - Round 1, found and fixed:
    - Dotted column fields drew empty charts; the server now escapes field refs (`e\.name`).
    - URL data inside a `lookup` transform was not refused; data/datasets are now refused at any depth, layer-level data included.
    - An empty `TYPEDHOUSE_STUDIO_MODEL=` now falls back to the default.
    - `close()` is bounded after a timeout.
  - Round 2:
    - 8 headless vega render tests: dotted, already-escaped, bracketed, sort/tooltip objects, `calculate datum['e.name']`, groupby, repeat array, filter.
    - In the browser, a dotted join chart draws 3 bars.
    - Playwright, 15 checks: Ctrl+G, render, Ctrl+1/2, rerun keeps the chart, failure message, 20k rows in about 0.5 s.
  - `test/pi-tester.test.ts` was rewritten by the Tester to the user's model decision: 13/13, with precedence re-verified by real server starts.
  - F1 holds for both query and chart generation with a provider that ignores the abort; the busy guard is shared.
  - PM, counting `it(`: `chart.test.ts` 12, `chart-tester.test.ts` 18, `pi.test.ts` 8, `pi-tester.test.ts` 13.
  - PM code read:
    - `server/chart.ts` `checkChartSpec`:
      - JSON object only;
      - data/datasets refused at any depth, except a top-level `{name:'table'}`;
      - field refs checked against the columns plus transform `as` names, in transform order;
      - column fields with `.`/`[`/`]` escaped;
      - the top-level `data` is set to `{name:'table'}`.
    - `web/chart-data.ts` `toChartData`: bigint and numeric strings become numbers, Date is kept, Map/Tuple/Array become JSON, and the output uses a null-prototype object.
    - `web/chart.tsx`: dynamic `import('vega-embed')`, brand config, light/dark by `prefers-color-scheme`.
    - `server/pi.ts`: `DEFAULT_MODEL = 'openai-codex/gpt-5.6-sol'`; `settings.json` is no longer read for the model.
    - `server/llm.ts`: the GUIDE has the one-call-per-line line (F4b) and the `unionAll` + `val('<table>')` line with an example (F6). `ABORT_GRACE_MS` is 5 s on abort, on reading the transcript, and on close.
  - `pnpm-lock.yaml` diff is now +1616/−44 (vega, vega-lite, vega-embed added).
- Follow-ups (non-blocking):
  - **F7 (S7):** axis/legend titles show the escaped name (`c\.entityId`). Default the title to the plain column name.
  - **F8:** object-form `repeat` (`{ row, column, layer }`) is not escaped.
  - **F9:** a column name containing a backslash renders as undefined in the chart.
  - **F10:** a `[__proto__]` column throws inside Vega and shows as a chart error. That is acceptable, but a chart-only rename would be nicer.
  - **F11:** generating a query switches to the Table tab. This is consistent with "Table is the default view", so decide in S7 whether to keep the current tab.
  - **F12 (S8):** the main web bundle is 861 KB (React, CodeMirror, sql-formatter, superjson). Consider lazy-loading sql-formatter for the SQL tab if startup feels slow. Not blocking for localhost.

### S5 — Saved queries
- Refs: R11.
- Acceptance:
  - Save stores the current prompt+source under a name in `<data-dir>/saved.json` (atomic write; the same name overwrites after confirming). The list shows in the sidebar's "Saved" section; clicking loads the prompt and source without running. Delete is available.
  - Unit tests for the store (create, list order, overwrite, delete, corrupt-file message).
- Depends on: S1
- Status: **done** (Tester OK on the first round, PM verified). Committed and pushed by the orchestrator on branch `studio`: `e36f68b` (S1–S6 WIP), then `967cf4f` (S5+S6 adversarial tests).
- Evidence (shared with S6):
  - Gates: root `pnpm typecheck` passes. Root `pnpm test`: 124 files, 1624 passed, 1 skipped, 0 failed (2 runs). Studio `test`: 10 files, 185/185. Studio `test:integration`: 39/39. Studio `build` passes.
  - `test/s56-tester.test.ts` (Tester-owned):
    - Name rules:
      - Empty or whitespace names are refused; 101 characters is refused and 100 accepted.
      - Unicode and path characters round-trip as data only, and names are trimmed.
    - 5 corrupt-file variants plus an unreadable file: the file stays untouched and no temp files are left.
    - Concurrency: 50 parallel saves and 20 overwrites.
    - A 2 MB source and a chart-spec round-trip.
    - Palette ranking order, and 2,000 items ranked in under 200 ms.
    - `models.select` refuses bad ids, and a switch during a generation applies to the next one.
  - `test/saved.test.ts` (Worker), and one integration case: the saved round trip over tRPC with a temp `dataDir`.
  - Playwright, 31 checks:
    - The palette opens; other shortcuts are inert while it is open; it doesn't stack.
    - Ranking, Enter, and Esc with focus restored.
    - A table result replaces the selection with `from(...)`. Odd, dotted, keyword and digit-leading table bindings all run.
    - Save, overwrite confirmation, delete confirmation, and the modified ● marker.
    - Loading restores without running, and the saved chart renders.
    - Switch model is used by the next generation.
    - Browser defaults are prevented for Ctrl+K/S/L/G/1/Enter inside CodeMirror.
    - 0 page errors.
  - PM code read:
    - `server/saved.ts`:
      - `{version:1, queries}`, trimmed names of 1–100 characters.
      - In-process serialized writes, temp file + rename at 0600, data dir created at 0700.
      - A corrupt or unreadable file is reported and never overwritten.
      - `updatedAt` is strictly increasing, so "newest first" is exact.
    - `server/server.ts`: `saved.list/save/delete`, and `models.list` (`models.getAvailable()`, no network) and `models.select`, held in memory for the session.
    - `web/keymap.ts` adds `palette` (k) and `save` (s).
    - `web/palette-match.ts` is the pure ranking module.
- Follow-ups (non-blocking):
  - **F13 (S7):** a table whose binding equals a core export (`from`, `count`, `sum`, `join`, `val`, …) shadows that function in the editor scope and breaks every query. Rename the table binding (e.g. `from_table`) and keep `db.<name>` working.
  - **F14 (S7):** loading a saved query without a chart clears the chart in the page but not its localStorage copy, so a reload redraws a stale chart.
  - **F15 (S7):** `models.select` accepts a model whose provider has no credential, though only via the API (the palette lists only `getAvailable()`). Refuse it.
  - **F16 (accepted):** saved names are case-sensitive, so `Foo` and `foo` are separate entries.
  - **F17 (accepted):** no cross-process lock on `saved.json`. Acceptable for a single user; writes are serialized in-process.
  - **F18 (S7, PM):** `createRouter`/`startServer` default the saved store to the real `~/.typedhouse/studio` when `dataDir` is omitted. Four integration servers (`studio.integration.ts` lines 35/117/150, `studio-tester.integration.ts` line 37) omit it. They don't call `saved.*` today, so nothing is written, but a future test could touch the user's real data. Make `dataDir` required for `startServer`; only `main.ts` resolves the home default.

### S6 — Command palette and complete keyboard map
- Refs: R6.
- Acceptance:
  - ⌘K opens a palette (per `Palette.dc.html`) with fuzzy search over actions (run, toggle limit, switch tab, focus prompt, chart prompt, save, refresh schema, and "Switch model…": pick a provider/model for this session only, not persisted, with the header chip updating), tables (inserts the name or `from(<table>)` into the editor), and saved queries (load). It is fully keyboard-driven: arrows, Enter, Esc.
  - All shortcuts work with ⌘ on macOS and Ctrl elsewhere, including while CodeMirror has focus (⌘↵, ⌘/, ⌘L, ⌘1–3, ⌘G, ⌘K), and don't fire the browser defaults. Footer hints match.
  - Test: a unit test of the keymap/dispatch table, plus one browser-level smoke test (or a documented manual checklist with a screenshot if no browser runner is available).
- Depends on: S1 (S3–S5 add their entries)
- Status: **done** (Tester OK on the first round, PM verified). "Switch model…" is included.
- Evidence: see S5, which holds the shared S5+S6 evidence.

### S7 — Visual fidelity pass
- Refs: R9.
- Acceptance:
  - The workspace matches `Main.dc.html`:
    - Night header with logo, connection chip, model chip and ⌘K button.
    - Tables/Saved sidebar.
    - Two panes with a draggable, keyboard-adjustable divider (clamped 28–68%, double-click resets).
    - Prompt + `query.ts` editor with the inferred row type and a Run button.
    - Results pane with Table/Chart/SQL tabs, row count and elapsed time; footer with the auto-limit state and shortcut hints.
  - Chart tab per `Chart.dc.html`. Tokens and fonts come from `apps/docs/src/styles/tokens.css`; syntax colors from `code-themes.mjs` (CodeMirror highlight style).
  - Light theme by default; dark via `prefers-color-scheme` is optional.
  - Carried in: F4a, F7, F11, F13, F14, F15, F18, the S1 editor-scroll limitation, the palette "Ask" row, and optionally F8–F10. The exact scope is under "Next Worker slice".
  - Evidence: side-by-side screenshots against the mockups at 1440px and under 1000px.
  - **Added 2026-11-03 (user decision; goes to the Worker after the current Tester round): remove the success notice.**
    - A successful generation shows no notice at all; the notice is the box "Generated in N attempts and ran with auto-limit on. It is a proposal: edit it and press ⌘↵ to rerun."
    - The replaced editor content and the auto-run results speak for themselves.
    - The failure display stays: the error message plus "Load the last attempt".
    - This makes F4a (the kbd layout in that notice) moot; drop it and its Playwright check.
    - Test: Playwright, a faux success leaves no `role="status"` notice in the left pane, and a faux failure still shows the error and the load button.
- Depends on: S1, S3, S4, S6
- Status: **done** (Tester OK after 2 rounds). Committed and pushed by the orchestrator as `c9b9444` on `studio`. It includes the success-notice removal.
- Evidence:
  - Gates: root `pnpm typecheck` passes. Root `pnpm test`: 125 files, 1634 passed, 1 skipped, 0 failed (2 runs). Studio `test`: 195. Studio `test:integration`: 40. Studio `build` passes.
  - `~/.typedhouse` was unchanged across all suites.
  - Round 1, found and fixed: tables named after hidden or blocked globals were unusable or broke the schema. The reserved set (`TAKEN` in `server/eval.ts`) now covers core exports, `db`, `query`, the shadowed and async-guarded globals and common globals, all handled by the `<name>_table[N]` rename.
  - Round 2, on ClickHouse with tables `process`, `process_table`, `Promise`, `Object`, `Array`, `from` and `JSON`:
    - The bindings are `process_table2`, `process_table`, `Promise_table`, `Object_table`, `Array_table`, `from_table` and `JSON_table`.
    - The sidebar, palette, LLM schema and run all agree, and `db.*` keeps the original names.
    - `Object`, `JSON` and `Math` still work in editor code.
    - A unit sweep of 54 names passes (`test/s7.test.ts`).
  - Browser:
    - A successful generation shows no notice; the failure display and "Load the last attempt" work.
    - Wrapping, the F11 tab rule, scroll reset, the palette Ask row and F14 across a reload all pass.
    - 24 screenshots in light and dark at 1440, 900 and 700 px show no overflow and readable contrast.
  - F15 is verified. The PM code read of `server/llm.ts` `selectModel` shows it requires `getAvailable(provider)` to contain the model, otherwise "No credentials for …".
  - F18 is verified, with a different fix than scoped:
    - `startServer`'s `dataDir` is still optional.
    - When omitted, `createRouter` now uses `defaultSavedStore()`: a per-process temp dir (`typedhouse-studio-<pid>-<random>`), created lazily on the first save and removed on process exit. It never uses `~/.typedhouse`.
    - Accepted: same safety, fewer call-site changes.
    - The exit-hook cleanup has the same limitation under vitest workers as F19; directories only appear if a test saves without a `dataDir`.
- Follow-ups:
  - **F19 (Tester territory):** `test/s7.test.ts` leaves one `/tmp` dir per run, because its `process.on('exit')` cleanup does not run under vitest workers. Fix it in the test, with `afterAll` plus `rm`.
  - **F20 (accepted):** tables named after non-reserved globals (`parseInt`, `URL`, `console`, `Reflect`) shadow those globals inside editor code. This is rare and visible in the sidebar binding name.
  - **Correction (orchestrator, 2026-11-03):** F8 (object-form `repeat` escaping) and F9 (backslash in column names) were **done** in S7 round 1 and verified with headless render tests. The PM confirmed the test `test/s7.test.ts` "escapes object-form repeat and raw backslash names". Still open: F10 (`[__proto__]` column in charts; accepted as a visible chart error) and F12 (bundle size, in S8). F16 and F17 are accepted.

### S9 — Editor language intelligence (R12)
- Refs: R12 (added by the user 2026-11-03), R1/R2 (generation must type-check), R6.
- Gap analysis (PM, 2026-11-03):
  - **Editor today.** `web/editor.tsx` is CodeMirror 6 with `basicSetup` and `javascript({ typescript: true })`: syntax highlighting only. There is no lint source, no completion source and no hover tooltip. The badge says "Compiles" only after a run.
  - **Server today.** `server/eval.ts` evaluates with `ts.transpileModule`, which never type-checks. Tables and core exports are injected as runtime parameters (`editorScope` = core exports + table bindings + `db`), so the editor source has no imports for a type checker to follow.
  - `editorSchema(schema)` returns the `renderSchema` source with collision-safe bindings (F13) plus a `bindings` map. Codegen's `renderSchema` declares `const <binding> = table(...)` *without* `export` (only the `Row$…` types and `db` are exported). As a type source it needs `export const` on each binding, or ambient declarations; a one-line transform of the `editorSchema` output is enough.
  - **Core types.** `@typedhouse/core` builds to one bundled, dependency-free `packages/core/dist/index.d.ts` (168 KB) with tsup `--dts`. That file exists only after `pnpm build`. The dev server runs from `src` through the root tsconfig `paths` (S1 item 0), so a dev checkout may have no `dist`. Source mode costs about 27% more instantiations than built mode (bench `5.8.3/source` 2.71 M vs `5.8.3/built` 2.13 M), and the type surface is heavy. A query editor file is far smaller than the bench corpus (`chain25`, `join10`, …).
  - **Measured on this machine** (AMD Ryzen 7 255, 16 threads; TypeScript 5.8.3 in-process `LanguageService`, `dist/index.d.ts` plus the fixture schema snapshot with exported bindings; a PM probe run inline with `node -e`, nothing committed):
    - First completion request (cold, includes lib + core load): 228 ms.
    - Member completions after `c.` in a `where` callback, after an edit: 20–32 ms. They list the table's 8 columns (`category, countOfParts, entityId, …`).
    - Column completions inside a `groupBy` callback: 85 ms.
    - Semantic diagnostics after an edit: 131–189 ms. A wrong operand gives "Argument of type '1' is not assignable to parameter of type 'Operand<string | null, "row">'".
    - Hover on `.groupBy`: 10 ms.
    - Process RSS: about 340 MB.
  - **Caveat:** completion details and hovers print the full `Expr<…> & { readonly ir: ExprNode & … }` intersection, and type errors on result types are very long. Both need trimming for display (see the acceptance criteria).
- **Design options.**
  1. **Server-side `ts.LanguageService` over tRPC (recommended).**
     - TypeScript is already a server dependency (eval uses it).
     - The schema and core types are on disk next to the server.
     - `check_query` can reuse the same service for R12's generation requirement.
     - The browser stays small: no TS bundle, no lib files shipped.
     - Single user on localhost, so the network latency is about 1 ms.
     - The cost: one resident service, about 340 MB RSS, which is fine.
  2. **In-browser TS worker** (`@typescript/vfs` or a hand-rolled worker): this ships TypeScript (several MB) plus the lib `.d.ts` files and core's `.d.ts` to the browser. It needs a new transport for the schema types, and a second checker on the server anyway for `check_query`. More moving parts, so not chosen.
- **Recommended shape (the Worker may refine it).**
  - `server/types.ts` holds one `LanguageService` per server, with virtual files:
    - `/core.d.ts`: core's types. Use the package's built `types` file when it exists, else `packages/core/src/index.ts` through `paths` (dev). Record which one is used in the startup log.
    - `/schema.ts`: `editorSchema` output with exported bindings. It is replaced on `schema.refresh`.
    - `/scope.d.ts`: `declare global { const from: typeof import('@typedhouse/core').from; …; const <binding>: typeof import('./schema').<binding>; const db: … }`. It is generated from core's export names and `bindings`, so the editor contract "no imports needed" type-checks.
    - `/query.ts`: the editor text. `moduleDetection: 'force'`, so a user `import { from } from '@typedhouse/core'` or a local redeclaration shadows the globals instead of clashing.
    - The compiler options mirror the repo's (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ES2022 lib, `skipLibCheck`).
  - Warm the service at startup (one diagnostics call) so the first keystroke never pays the cold cost.
  - tRPC `types.diagnostics({ source })`, `types.completions({ source, pos })`, `types.hover({ source, pos })`. The full text is sent per call; it is small, so no incremental sync is needed.
  - Web: CodeMirror `linter` (debounced about 300 ms), `autocompletion` with an override source, and `hoverTooltip`, all calling those procedures. Map TS ranges to CodeMirror offsets one-to-one (same text).
  - **Runs are not blocked by type errors** (decided by the orchestrator 2026-11-03). ⌘↵ still evaluates and compiles, as now. Type errors are shown inline and in the badge. Generation (below) requires zero type errors.
- Acceptance:
  - **Diagnostics.**
    - Type and syntax errors show as squiggles with the TS message on hover, inline in the editor.
    - Messages are trimmed for display: first line, at most about 300 characters, with the full text in the tooltip's details.
    - The editor badge shows "Typechecks" when there are 0 errors, or "N type errors". The run status ("Compiles"/stage error) is shown separately.
    - Diagnostics clear when fixed.
    - The "no imports needed" contract type-checks: `from(<table>)` with no import gives 0 errors on the fixture schema. A user `import { from } from '@typedhouse/core'` also gives 0 errors.
  - **Completions.**
    - At the top level: table bindings (the F13 names), `db`, and core exports (`from`, `count`, `sum`, `val`, `join`, …).
    - After `.` on a query: builder methods (`where`, `map`, `groupBy`, `orderBy`, `limit`, …).
    - Inside a callback (`e => e.`): the table's columns.
    - Each column item shows its ClickHouse type, e.g. `String`, `Nullable(String)`, `DateTime64(3)`, taken from the schema rather than the raw `Expr<…>` intersection, plus its TS value type when short.
  - **Hover:** shows a readable type for identifiers, columns and builder methods, trimmed like the diagnostics.
  - **Latency on a warm service, measured on this machine and recorded as evidence:**
    - completions p95 < 150 ms server time (R12's ceiling is 300 ms end-to-end);
    - diagnostics p95 < 300 ms after an edit;
    - hover p95 < 100 ms;
    - the first request after startup < 1 s because of the warm-up.
    Measure over at least 20 edits on the fixture schema, in both the core `dist` and `src` modes.
  - **Generation (R12 and S3).**
    - `check_query` runs type diagnostics on the candidate source, using the same service and the same globals, in addition to `prepare()`.
    - Type errors are returned to the model in the tool result (trimmed, with line:col). A source passes only with 0 type errors *and* a successful compile.
    - The GUIDE says that type errors must be fixed.
  - **Schema refresh** updates `/schema.ts` and `/scope.d.ts`, and completions reflect new tables without a restart.
  - **Tests.**
    - Unit (`test/types.test.ts`, faux-free):
      - no-import contract → 0 errors;
      - wrong operand type → 1 error at the right range;
      - an unknown column → an error;
      - member completions after `c.` list the fixture columns with CH types;
      - top-level completions include the table bindings and `from`/`count`;
      - hover on a column shows its type;
      - an F13-colliding table binding (`from_table`) type-checks;
      - a latency smoke test asserting warm completions < 300 ms (generous, to avoid CI flakes).
    - LLM (faux):
      - a source that compiles at runtime but has a type error is refused by `check_query`, the model gets the type error back, and the fixed second attempt passes (`attempts === 2`);
      - a type-correct source passes in one attempt.
    - Integration: on the fixture ClickHouse, `types.diagnostics` for a generated or saved query is 0, and after `schema.refresh` a new table appears in completions.
    - Playwright:
      - typing `from(` offers the table bindings;
      - `.where(c => c.` lists the columns, and accepting one inserts it;
      - an introduced type error shows a squiggle and the badge "1 type error", and fixing it shows "Typechecks";
      - hover shows a type;
      - typing stays responsive, with no dropped keystrokes in a 40-character burst.
  - **Gates:**
    - root `pnpm typecheck` and `pnpm test`;
    - studio `typecheck`, `test:integration` and `build`;
    - `node scripts/check-type-performance.mjs` unchanged, since S9 must not touch core types or the bench inputs.
- Depends on: S3 (`check_query`), S7 (editor and badge layout; done in `c9b9444`). Runs after S7 and before S8.
- Status: **done** (Tester OK after 2 rounds). Committed and pushed by the orchestrator as `3b1e6f8` on `studio`. There is one open item: the latency target for heavy queries (F21, needs a user decision).
- Note for the Worker (applied): build `/scope.d.ts` from the same `TAKEN`/`editorSchema` bindings that S7 introduced (`process_table2`, `from_table`, …), so the type checker and the runtime scope can never disagree.
- Evidence:
  - Gates (round 2):
    - Root `pnpm typecheck` passes.
    - Root `pnpm test`: 128 files, 1703 passed, 2 skipped (2 runs).
    - Studio `test`: 264 passed, 1 skipped (F22).
    - Studio `test:integration`: 41/41.
    - Studio `build` produces `dist/main.js` (74 KB) and `dist/types-worker.js` (21 KB).
    - `check-type-performance` is unchanged.
  - Round 1, found and fixed:
    - Inserting odd column names gave the invalid `c.["x"]`; completions now use TypeScript's replacement span.
    - Completions appeared inside strings; they are now filtered there.
    - "Typechecks" showed for code that doesn't run. A new `check()` adds a type-only runnable-query assertion plus the eval guard's diagnostics (imports, async, …).
    - The GUIDE cheat sheet is now generated and tested (`test/cheatsheet.test.ts`: each example passes the same check as `check_query`).
    - The LanguageService moved to a worker thread (`server/types-worker.ts`, `types-client.ts`).
  - Round 2 checks:
    - 11 legitimate shapes raise no false positives, and 4 contract cases each report an error.
    - Worker burst of 200 requests: 198 superseded, the last one real. `check_query` requests are never dropped.
    - Killing the worker rejects in-flight requests, and the worker restarts.
    - Memory went from 836 to 951 MB over 500 edits. No squiggle flicker was observed.
    - The built bin uses the worker bundle.
  - **Run latency while typing** (the event loop is free): p50 13–16 ms, max 28 ms. Before the worker it was 0.8–2.6 s.
  - **Editor latency** (Worker's p50/p95):
    - Light queries: completions 76/109 ms, diagnostics 80/119 ms. Within the 150/300 ms targets.
    - Heavy aggregate queries: completions 263/289 ms, diagnostics 265/282 ms; the Tester measured about 295 ms per heavy edit.
    - **The heavy-query completions miss the 150 ms p95 target.** They stay under R12's 300 ms end-to-end ceiling only marginally. Cause: core's aggregate overload types, which are out of S9 scope (F21).
  - PM code read:
    - `server/types.ts` (340 lines) provides `check`, `checkExact`, completions and hover. tRPC exposes `types.diagnostics/completions/hover`.
    - `clickhouse.ts` `checkAsync` runs the type check in the worker for `check_query`.
    - The GUIDE says type errors (line:col) must be fixed.
- Follow-ups:
  - **F21 (needs a user decision; the orchestrator is raising it):** heavy-query type-check latency of about 265–295 ms comes from core's aggregate overloads. Options: accept it, or open core type-performance work, which lies outside the studio and is subject to the `test/types/bench` budget rules.
  - **F22:** `export { q as default }` gives a false "No query found". It is rare; recorded as a skipped test in `test/types-tester.test.ts`.
  - **F23:** columns named `ir`, `_rowType` or with a `__` prefix are hidden from completions (they collide with `Expr` internals).
  - **F24:** no completions inside an element access string (`e['…`).
  - **F19:** still open; see S8.

### S8 — Gates and manual smoke
- Refs: all.
- Acceptance:
  - **F12 bundle size (Worker).**
    - sql-formatter loads via dynamic `import()` when the SQL tab is first shown, like vega. While it loads, or if it fails, the raw SQL is shown.
    - Record the main `dist/web/assets/index-*.js` size before and after. The baseline at `3b1e6f8` is 878 KB (it grew from 861 KB through S7 and S9).
    - Acceptance: sql-formatter is in its own chunk, and the main chunk shrinks by that chunk's size, give or take a few KB.
    - Playwright: the SQL tab still shows formatted SQL.
  - **`packages/studio/README.md` (Worker), short (about 1 screen), covering:**
    - what it is;
    - the start commands: `pnpm --filter @typedhouse/studio dev` from the repo, and the `typedhouse-studio` bin after `pnpm build`;
    - connection flags and env (`--url/--user/--password/--database`, `TYPEDHOUSE_*`), plus `--port`, `--data-dir` and `--pi-dir`;
    - pi credentials (read from `~/.pi/agent/auth.json`, shared with `pi`, never copied);
    - the default model `openai-codex/gpt-5.6-sol`, `--model`/`TYPEDHOUSE_STUDIO_MODEL`, ⌘K "Switch model…", and the "LLM unavailable" behaviour;
    - the keyboard shortcuts table: ⌘↵ ⌘/ ⌘L ⌘G ⌘1–3 ⌘K ⌘S;
    - auto-limit 100, and where saved queries live (`<data-dir>/saved.json`);
    - limitations: single local user, queries run in-process (not a sandbox), readonly=2 connection, heavy-query type-check latency (F21).
    - No other docs changes; the docs site is out of scope.
  - **F19 (Tester):** `test/s7.test.ts` leaves no temp dir behind. Use `afterAll` + `rm`, not `process.on('exit')`. Evidence: the count of `/tmp` entries is the same before and after `pnpm --filter @typedhouse/studio test`.
  - **Final gates (Tester), on the final tree:**
    - root `pnpm typecheck` and `pnpm test`;
    - studio `typecheck`, `test`, `test:integration` and `build`;
    - **`pnpm check:all`**, with its duration recorded;
    - `~/.typedhouse` and `~/.pi` unchanged across all of them.
  - **Decision recorded here: studio integration tests stay out of `check:all` for now.** The studio is private and unpublished, and its suite needs Docker plus about 1 minute extra. It is run via `pnpm --filter @typedhouse/studio test:integration`. Revisit if the studio is ever published or CI-gated. The orchestrator may override.
  - **Real-model smoke (orchestrator)** against the fixture ClickHouse with the real pi credential and `openai-codex/gpt-5.6-sol`. Do the following, and record the attempts, latency, and any auth refresh or `auth.json` change:
    - Generate one query.
    - Confirm that its type check reports "Typechecks", and that it runs.
    - Generate one chart over its result.
    - Save it.
    - Reload the page and load it again.
  - Nothing committed under `apps/playground/`.
- Depends on: S1–S7, S9 (order: S7 → S9 → S8)
- Status: in progress (the final slice; Worker: F12 + README; Tester: F19 + gates; orchestrator: smoke)
- Evidence:

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
