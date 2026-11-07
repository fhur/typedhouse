## Studio: review fixes for the exploration tools (2026-11-06)

Fixes the 10 review findings on `bfaf90a`, plus the defects independent testing found in those fixes (Worker and Tester rounds). `columns_describe` aliases no longer collide with column names. Exploration tools honour Stop through `currentRunSignal()`, and `@typedhouse/client` `stream` gains an optional `{ signal }` (new exported type `RunOptions`; existing callers unchanged). An apply beside a non-apply tool is refused. Surrogate-safe `cut` moved to `server/text.ts` and is used for model-visible text. Column metadata has its own limit, reported as `columnsTruncated`; long SQL as `sqlTruncated`. Reads: one `AbortController` and a 12 s timeout per `chat.get`, `no-store`, no batching, no superseding by a poll tick, and a reply ends `generating` regardless of its re-read. `openChat` restores the browser copy at once, so a failing read can't overwrite a hand edit. Startup reads retry. Tab into the thread takes one stop again.

**Evidence, final tree, load 12-43:** root `pnpm typecheck` passes; root `pnpm test` twice, 2229 passed, 2 skipped; studio `test` 786 passed, 1 skipped; `test:integration` 92; `build` passes; `test:browser` 306 passed, 21.0 min, no retries; `test:compiler-integration` 375. Not run on this tree: `check:all`, type-perf budget. Test expectation changed in `agent-capabilities.test.ts` (21 columns are no longer truncated).

**Known, left open:**
- A chat with no browser copy and failing reads shows the previous chat's query, and typing saves it as this chat's copy. Pinned in a test.
- `query_apply(good)` + `query_apply(bad)` in one round, then giving up, is an error turn offering the bad source. Pinned by existing tests.
- Each full browser run under load surfaced a different low-rate timing failure until the last; `chat.spec.ts:661` failed once and was never explained.
- `compile` looks exponential in chained `.where` (n=20 took 13.9 s, 500 ran over 6 minutes) and is synchronous in `query_run`, so model-written source could freeze the server beyond Stop. Cause not yet confirmed.
- A saved query with no chart gets the chat's chart back if a read was out (also at `bfaf90a`). `?` drops the selection.

## Studio working indicator

- Removed the top-level disclosure arrow so only the live spinner remains; native keyboard/click expansion is preserved. Added a moving text sheen to live labels, disabled with a readable static fallback for reduced motion. Studio typecheck/build and both activity browser tests passed, including hidden marker and reduced-motion sheen checks.

- Added a compact brand-colored rotating ring beside live activity labels (including Working and Stopping). It disappears when generation ends and remains static under `prefers-reduced-motion`.
- Verified Studio typecheck/build and 2 activity browser tests, including animation, reduced-motion behavior and removal after stop.

## Studio tool-call grouping

- Each tool call is now one expandable item containing Inputs and Result, matched by user turn and tool-call ID (not tool name). Four calls with four results render as four items. Pending calls keep their identity when results arrive; errors and truncated outputs remain explicit.
- Verified: Studio typecheck/build, 5 activity unit tests (including reversed result order and reused IDs across turns), and 2 activity browser tests passed.

## Studio compact activity status

- Replace the default per-event activity feed with a single compact status per user message: initial “Working…”, then the latest tool's human-readable label, with `+n tool calls` counting earlier calls.
- Preserve the complete chronological public log behind an accessible disclosure; tool arguments/results remain individually collapsed. Completed activity remains inspectable without an endless working indicator. Activity and counts stay scoped to their own user turn.
- Verified: root and Studio typechecks, build, 3 activity-summary unit tests and 2 browser activity tests passed. Browser coverage checks initial/live/latest labels, N−1 counts, pending-turn isolation, collapsed details, reopening, escaping and retained prior activity while editing a later turn. Empty completed activity creates no extra row. Visually checked existing `pi_tracer` conversation in the running dev app: tools now occupy one collapsed summary per turn.

## Studio transparent agent conversation

- Expose public assistant messages and tool call arguments/results in the chat log, including live progress, success/error/interrupted status and explicit display truncation. Do not expose private reasoning or system instructions; suppress duplicate final assistant text.
- Keep activity separate from editor/version turns and anchor it to its user message. Use explicit new-chat creation before sending so the browser can follow a running conversation immediately, without guessing its identity from the sidebar.
- Render expandable escaped-text tool details, preserve activity on reopen, and hide edited-away branches. Polling is observational and must not apply the same editor reply twice.
- Verification: final Studio/root typechecks, build and diff check passed; 51 ClickHouse integration tests passed; 52 focused tool/restart tests passed; 8 final browser activity/chat-switch/stop/reload tests passed. Studio unit suite: 683 passed, 1 skipped, only the previously observed real model-cache `gpt-5.5` failure remains.
- Browser sweep found and fixed polling-cleanup invalidation of newly opened chat reads and stale first-send sidebar titles. A broader 48-test browser selection hit the 240-second runner timeout; a focused rerun still showed four macOS shortcut-sensitive legacy tests (Control+A/Z/M assumptions). The shared editor select-all helper now uses ControlOrMeta; the whole browser suite is not claimed green.
- Review additionally covered tool-call ID reuse after an interrupted run: frozen activity/result matching is scoped to its user turn, preventing a later reused call ID from losing its result.

## Studio agent exploration tools

- Added object-first tools: `query_validate`, `query_run`, `query_results_get`, `query_apply`, `chart_validate`, `chart_apply`, `tables_list`, `table_describe`, `columns_describe`, `docs_search`, `docs_read`.
- Validation/exploration are nonterminal and do not produce editor versions. Apply remains validated and terminal; existing persisted legacy tool history stays readable. Default turn budget is 16.
- Agent execution is read-only with mandatory server scan/time/memory/result budgets; bounded, expiring conversation-owned snapshots supply opaque-cursor result pages. Column statistics explicitly disclose bounded storage-order sampling. Local docs include function/API pages and are bundled for builds; schema/docs pages are bounded and cursor-paginated.
- Root `pnpm studio` starts development mode. README documents tools, exploration data sent to the model, and trusted-local-code limitations.
- Verification: root and Studio typechecks passed; Studio build passed; root unit suite: 2,118 passed, 2 skipped, one pre-existing `pi-tester.test.ts` failure caused by missing `gpt-5.5` in the local real model cache (also failed before implementation). Final ClickHouse integration suite: 51 passed; new tool/capability unit suites: 16 passed. Final Studio typecheck, build, and `git diff --check` passed. Browser suite/full Docker gate not rerun.
- Read-only smoke against local `pi_tracer.tool_calls`: 11 columns described, 25 result rows paged as 20 + 5, one column profiled, `argMax` docs search returned 4 matches. No writes to the database.

## Studio (@typedhouse/studio) — done, R1–R13 (2026-11-04)

Brief: requirements R1–R13 in the session's `studio-brief.md` (it's the source of truth; R12 was added 2026-11-03, R13 on 2026-11-04). Single user on localhost, so keep it simple: few files, few dependencies, no auth.

### Completion check (PM, 2026-11-04): R13 complete
All slices S10–S14 are verified. The final tree is on branch `studio`, pushed by the user's request and not merged to master. The user hasn't had their last look.

**Final gates on that tree (Tester, `scratchpad/s14final/out.txt`), at load 13–26:**
- root `pnpm typecheck` exit 0; root `pnpm test`, 2 runs: 139 files, 2103 passed, 2 skipped;
- studio `typecheck` exit 0; studio `test`: 25 files, 664 passed, 1 skipped (F22's `it.skip`); `test:integration`: 4 files, 47 passed; `build` exit 0;
- `test:browser`: 215 passed, 10.7 min;
- `check-type-performance.mjs` passed: the budget is unchanged, and the wall time is advisory on this host class;
- **`pnpm check:all` exit 0;**
- no `test.fail` or `it.fails` remains in studio tests.

**PM, independent:**
- The log shows each exit code. No file under `packages/studio`, `package.json` or `pnpm-lock.yaml` is newer than the start of the gates; the newest test edit is 21:21 and the gates began at 21:26. Only `TODO.md` has changed since.
- Studio `typecheck` exits 0 and studio `test` gives the same 25 files, 664 passed, 1 skipped; root `pnpm typecheck` exits 0.
- `auth.json`, `settings.json` and `~/.typedhouse/studio/pi.sqlite` have the same md5 as when first recorded at S10.
- Not repeated by the PM: root `pnpm test`, integration, build, `test:browser`, type-perf, `check:all`, the smoke.

**Requirements → evidence:**

| Req | Status | Evidence |
|---|---|---|
| R13.1 Layout | done; **the user's last look is open** | S12. Chat above `query.ts`, `split-h` drags, clamps 30–75 %, moves with ↑/↓; Chats above Tables and Saved. `layout.spec.ts` measures overflow at 1440/1000/900/700 in both schemes. 32 shots viewed against the prototype's markup; not pixel-compared, because `support.js` is missing from the export. |
| R13.2 Conversation state | done | S10, S11, S12. One conversation per chat, in `pi.sqlite`. Separate OS processes after SIGTERM and SIGKILL (`chat-restart.test.ts`), against ClickHouse (`chat.integration.ts`), in the browser (`a real server kill and restart…`), and with the real model. New chat; list and reopen from the sidebar and ⌘K. |
| R13.3 Editor source with each message | done | S10, S11 (F32). Hand edit and emptied editor in the raw faux request; real smoke kept a hand edit and rebuilt from an emptied editor. |
| R13.4 Numbered versions | done | S10–S12. Number, summary, changed lines, attempts, elapsed; "in editor" derived; only checked source reaches the editor; failure is an error turn with the editor unchanged. Real smoke: 8 version or chart turns, each 1 attempt, 2.4–4.2 s. |
| R13.5 Text replies | done | S10. A normal turn with no version. Real smoke: text replies with the editor unchanged. |
| R13.6 Charts in chat | done | S11, S12. `checkChartSpec` against the source's columns, Chart tab, query unchanged; prompt box and ⌘G gone. Real smoke: chart drew, 3 marks, 0 spec errors. A chart that also changes the query is proven by faux and integration only; the real model didn't offer one. |
| R13.7 Auto-run | done | S12. `queuedRun` never drops a reply's run; `readonly=2` stays. |
| R13.8 Keyboard | done | S13, S14. `keyboard.spec.ts`, one row per key per zone, keyboard-only by its own source check, and the no-mouse walkthrough; `keymap.test.ts` for the tables and Mac labels. **Limits:** Chromium on Linux only; held keys and IME simulated; Mac labels unit-tested, never run on a Mac. |
| R13.9 Edit and stop | done | S11, S13. Sentinel proof on the raw faux request, on the next turn and after a real restart; separate `sessionId`. Stop in six situations, including a provider that ignores the abort, each followed by a working send. **Limit:** with the real model the drop is indirect: `ZEBRAQUARTZ` is gone from the thread and the model answered "none", but the bin doesn't log requests. |
| R13.10 Existing features | done | S12–S14. Saved queries, Switch model, squiggles, badge, hover, completions and auto-limit in the browser suite. Saved-query choice recorded and in the README. |
| R2 (real model) | done for R13 | S14 smoke below. |

**Superseded by R13:** the prompt box in R1, the chart prompt in R4, and ⌘G in R6. Their rows in the 2026-11-03 check below are history.

**For the user to choose from, none blocking (F55–F62).**
- **F60, the PM's first pick:** a send killed mid-generation appears as a recorded turn with the "Interrupted" note, and its words also return to the box, so typing appends to them. This produced a doubled prompt in the smoke's message 13. The earlier decision accepted words appearing twice, but this one reached the model unnoticed. It only happens when the server dies with the page open.
- **F58:** at 700 px, the two-line footer overlaps Run in the box zone until you scroll.
- **F59:** a chart-only reply leaves the previous version's added-line tint in the editor.
- **F56:** the `?` dialog's Ctrl+M key box stretches to two lines on a wrapped row.
- **F57:** ⌘↵ within milliseconds of opening a chat runs the previous text. It's a machine-speed race.
- **F61:** the columns hint can go stale after a schema refresh. It's only a hint, and the reply is rechecked.
- **F62:** whether listed columns save rounds isn't proven; no comparison was run.
- **F55, watch item:** the unexplained dev-page load. A retried load now prints a `[F55]` line, and a test pins that. **No `[F55]` line appears in any `s14final` log**, the browser run included, so no retry happened on the final run. The cause is still unknown.

**Still accepted, recorded above and in the README where the user would meet them:** F25–F27, F31, F40–F49, F50–F53.

### Chat redesign (R13) — done (plan and record, 2026-11-04)
R13 supersedes the single prompt box in R1 and the separate chart prompt and ⌘G in R4/R6. The prototype is `Chat.dc.html`: its look and key map are the spec, its scripted replies are mock only. Order: S10 → S11 → S12 → S13 → S14, all done. **No next slice.**

**Starting point.**
- `main.ts` already passes SQLite (`<data-dir>/pi.sqlite`). `createLlm` falls back to `MemoryStorage`, and `test/ui-harness.ts` and every faux test use that fallback, so no test exercises SQLite yet.
- `converse()` creates a new ownerless conversation per request and never reuses it. Existing `pi.sqlite` files hold one such conversation per past generation.
- pi-durable facts below come from its README, types and dist source. S10 item 0 ran the terminate, write, custom-entry and fork facts; S11 item 1 ran the stuck-run fork and abort behaviour. How a real provider handles these contexts is still only confirmable in the S14 real smoke.

**Design decisions (PM; the Worker may refine the shapes, not the behaviour).**
- **Chat ≠ conversation.** A chat has a stable id and points at its current conversation; edit-and-resend moves the pointer to a fork. The index `{ id, title, conversationId, updatedAt }[]` is one session-scoped pi-durable document (`defineDoc({ scope: 'session' })`) in `pi.sqlite`. Nothing goes in a separate file. `scanConversations` can't be the list: it has no metadata, and it would also return every old one-shot generation and every fork. Those old conversations stay in the file, unlisted, with no migration.
- **Turns are transcript entries.** A user turn is an input with `entry: { kind: 'studio.user', data: { text, source } }` and `content` = text + editor source (the model sees `content`; the thread shows `text`). Replies and notes are `{ type: 'write', entry: { kind: 'studio.reply' | 'studio.note', data } }`, which the model doesn't see. The thread is read from the fork-aware `conversation.entries()`, not `context()`, so compaction can't hide turns and a fork brings the right prefix.
- **Version numbers** are derived by counting version replies in the visible history, so numbers are reused after edit-and-resend, as in the prototype. The "in editor" mark is derived: the newest version whose source equals the editor text. A hand edit therefore marks none.
- **Tools.** New extension `typedhouse-chat` with `check_query({ source, summary? })` and `check_chart({ spec, source?, summary? })`. `summary` is optional because a terminating check has no later assistant text to read it from; a missing one falls back to a fixed line. `check_chart` with `source` is the "chart needs a query change" case: one atomic call, the source is checked first and the spec is validated against that source's columns, so no ordering between two tools is needed. The guide says that text replies are allowed. Stored agent choices are names, so these names must not be renamed later.
- **Reply kinds** come from the *current run only*: one passing check with a changed source or a chart → version; a passing check whose source equals the sent source and no chart → text turn, no version, no run; no check call → text turn; failure → error turn with the last attempt. Chart replies are numbered versions, as in the prototype (v4).
- **Model.** `configure({ model })` on the chat's conversation before every send, because the agent is stored per conversation and a fork inherits it.
- **One mutation for send, retry and edit-and-resend:** `chat.send({ chatId | null, text, source, sample?, replaceFrom? })`, where `replaceFrom` names the first user turn to drop. It forks at the entry just before that turn, or creates a fresh conversation when it is the first turn (nothing precedes it to fork at). In the UI, `e` hides the later turns locally until the send, as in the prototype, so a reload or chat switch before sending brings them back and nothing is lost by a stray key (superseded for an edit with typed words: see the S12 decisions). Also `chat.list`, `chat.get({ id })` (turns + `generating`), `chat.stop({ id })`, `chat.note({ id, text })`.
- **One generation at a time, across all chats** (the existing busy guard). Inputs use `whenBusy: 'reject'`, so nothing queues.
- **Small product choices (record, don't ask).** A chat exists from its first send, so no empty chats are stored, and its title is the first message cut to one line, with no model call. New chat keeps the editor and results as they are. Reopening a chat restores the editor from a per-chat browser draft, else its newest version, and doesn't auto-run. No chat rename or delete. Saved queries (R13.10): save stores prompt (the last user message, or the box text), source and chart; loading one changes the editor and chart only and doesn't touch the open chat.

**New findings.**
- **F25, accepted limitation:** two Studio processes on one data dir are unprotected (pi-durable: "one process owns a storage at a time; there is no cross-process locking"). The default port collision prevents it in normal use; different `--port`s don't. Record in the README.
- **F26, accepted limitation:** edit-and-resend keeps the dropped branch on disk in `pi.sqlite`; pi-durable has no delete. The model can't see it (S11 proves that), but the file only grows.
- **F27, accepted limitation:** without credentials `main.ts` opens no Harness, so the chat list is empty and the message box says why. History comes back with credentials; `pi.sqlite` is untouched.

**Findings from S10 (PM triage, 2026-11-04).** F28–F31 and F33 are the Tester's non-blocking observations; F34 and F35 come from the PM's code read.
- **F28, fix in S11:** a re-check that never returns hangs `chat.send` and holds the busy guard indefinitely. The timeout covers only the run, and `checkAsync` goes through a worker call with no timeout. Marked `it.fails`.
- **F29, fix in S11:** `titleOf` cuts at 80 UTF-16 units and can split an emoji. `oneLine` has the same flaw at 200 for summaries (PM read), so fix both. Marked `it.fails` for the title.
- **F30, fix in S11:** `diffLines` allocates a full table, so 32,000 × 32,000 one-character lines (allowed by the 64,000-character limit) can run the server out of memory, and the out-of-memory death isn't catchable. A model source has no limit at all. A model source over 64,000 characters would also reach the editor and then be refused as the source of the next send (PM read, not run).
- **F31, accepted limitation:** a hand-edited corrupt chat index gives rough results. No kill can produce it, the app still starts, and `main.ts` falls back to "LLM unavailable" if open throws.
- **F32, fix in S11; keeps S10 open:** on an empty editor `withEditorSource` adds nothing, so the model can't tell the user emptied it and may build on the previous version. That misses R13.3 and S10's "each user message carries the current editor source". The Tester's test records this behaviour.
- **F33, fix in S11 with F30:** changed lines list additions before removals. It's cosmetic, but the same function changes anyway and tests use `arrayContaining`, so none pins the order.
- **F34, fix in S11:** `chat.send` clears `generating` in `finally`, before the reply commit. A `chat.get` in that gap sees no generation and no reply, which would mislead the S12 reload path.
- **F35, Tester, in S12:** `chat-tester.test.ts` › `the committed one-shot test files are unchanged` runs `git status` over `chart.test.ts` and `s7.test.ts`, among others, so it fails as soon as the approved edits below are made. It has to go before they are.

**Disposition after S11:** F28, F29, F30, F32, F33 and F34 are fixed; F31 stays accepted; F35 is open for S12 step A.

**Findings from S11 (2026-11-04).**
- **F36, fixed in S11; security; the CSP must stay:** a chart spec could send row data to any host. The hole predates the chat: it is in the shared `checkChartSpec`, and `web/chart.tsx` rendered with vega-embed's default loader. It is fixed with three layers:
  - the validator in `server/chart.ts`;
  - a blocking loader, Vega's expression interpreter (`ast: true`) and `mode: 'vega-lite'` in `web/chart.tsx`;
  - a Content-Security-Policy on every response, from `contentSecurityPolicy` in `server/server.ts`.
  Orchestrator's decisions:
  - Plain address text in expressions and titles is allowed, because URL columns are common and text can't fetch anything.
  - Literal refusals are only `url(` and `javascript:`.
  - Also refused: the keys `url`, `href`, `*:href`, `usermeta`, `embedOptions` and `loader`; image marks; a non-Vega-Lite `$schema`; inlined data.
  - **The CSP is the only barrier for row-built paint addresses, which the validator can't see, and it must stay.** Any change to its `img-src`, `connect-src`, `default-src` or `script-src` directives, or to the `ast` option, is a security change that needs the browser spec in S12 to stay green.
- **F37, fixed in S11:** a spec's `bind.element` could wipe any element of the page, because Vega empties the element a selector finds. It is fixed by the validator and by `withoutPageTargets` at render time, which also drops `usermeta`, so a hand-edited saved query is covered too.
- **F38, fixed in S11:** a malformed path on the static server hung the request; it now gets a 400.
- **F39, fixed in S11:** both one-off restart test failures were traced to test timing and fixed in the tests. No product change.
- **F40, accepted:** the dev server hangs on a raw `GET http://[bad/`. Vite throws, browsers don't send it, and the static server answers 400 (F38).
- **F41, accepted, on one condition:** the CSS escape `\75 rl(` passes the validator's literal check. The CSP blocks what it would fetch, so this is F36's "only barrier" case. The condition is that S12's browser spec includes it, because today's proof is only in scratch scripts.
- **F42, accepted:** in a mixed round the model is told OK for the half that gets discarded. The last result still decides, so nothing unchecked is accepted; at worst it costs a retry. Same family as F2.
- **F43, accepted:** a timed-out run whose last result passed still gives a version. That source passed the check and the re-check, so R13.4 holds, and throwing it away would waste a valid result after the user's long wait. A stop still wins over it.

**Decisions from S12 (orchestrator, 2026-11-04).**
- **Edit state:** an edit with typed words stays open across a reload or chat switch, with later turns still hidden. This supersedes S12's "a reload or chat switch before sending brings them back". An untouched edit goes back in place.
- **The message being edited stays visible and dimmed; only later turns hide.** This differs from the prototype on purpose: the original stays readable while rewriting.
- **v1 over the untouched starter shows no changed lines.** Hand-written text keeps its diff.
- **Another chat generating:** one line by the box, `Waiting`, a sidebar dot and a route to stop it. `chat.list` reports `generating`, polled every 1 s.
- **A send with no answer from the server puts the words back in the box; a resend keeps its edit state.** If the server had stored the turn, the words appear twice, which is accepted.
- **Sample rows:** up to 20 rows go with every chat message once a current result exists, and stay in `pi.sqlite`. The user was told and hasn't objected. S14's README must document this.

**Findings from S12, accepted as non-blocking (PM agrees, 2026-11-04).**
- **F44:** at 1000 px and below, an auto-run's results land below the fold with nothing scrolling to them. The panes stack below that width, the results are one scroll away, and Tab reaches them.
- **F45:** ⌘↵ during a run is dropped, and a saved query loaded mid-run shows older rows until re-run. A manual run was already refused during a run before the chat, and a reply's auto-run is never dropped.
- **F46:** a retry with no answer becomes a new turn when resent. The words are safe, which is what matters when the server was lost.
- **F47:** a hand edit within 500 ms of a reply shares its undo step. `isolateHistory` would fix it if this ever bites.
- **F48:** a cut-off turn isn't shown until the next send or reload. Nothing is lost.
- **F49:** an edit left in a chat you never reopen stays in localStorage. It's small, and single user.

**Decisions from S13 (orchestrator, 2026-11-04).**
- **Tab in the editor:** Tab keeps indenting. Ctrl+M (⇧⌥M on Mac) toggles Tab to move focus, shown in the editor header and the `?` dialog. The palette's "Resize panes" and "Resize chat and editor" focus each divider.
- **One rule for held keys:** a repeat is swallowed once focus has moved since that key went down, recorded per key. Esc never repeats. Run, ⌘/, new chat, palette and save ignore repeats.
- **`r` isn't offered while another chat generates.**
- **Esc on a typed rewrite in the box drops it with no undo:** the PM's own call, told to the user, no objection so far.

**Findings from S13 (2026-11-04).**
- **F50, accepted:** the Ctrl+M state isn't remembered across a reload. The header says when it's on, and a test pins that a reload turns it off with the header.
- **F51, accepted:** a repeat before focus moves can still act on a route nobody has found. Every known route has a held-key test.
- **F52, accepted:** `focusSoon` has timing limits at machine speed, which human typing doesn't reach. It defers focus by one tick and yields to a focus that moved on purpose.
- **F53, accepted; the two reports reconcile:** tabbing into a non-empty thread does select the last turn (`onFocusThread`, on focus of the thread itself), so the Worker is right about Tab, and the highlight is the focus indicator, since `.thread:focus` has no outline. From the code, a thread focused with *no* selection comes from other routes: clicking a selected turn again, which toggles it off, or focus landing on a button inside the thread. Then only the footer label shows the zone, or the button's own ring; ↑ selects the last turn and ↓ goes to the box, so the keys still work. No test asserts the Tab case, so S14 adds one.
- **F54, fixed:** one-off failure of `chat-s11` › `while check_query never returns…` was test timing; the budget was raised to 1,500 ms.
- **F55, open watch item; cause unknown:** one-off failure of `[dev] chart-offline` › `a CSS-escaped url( (F41)` (`.cm-content` never appeared). Not reproduced, no evidence of a product problem, dev server only. Hardening: one retry of the load only; hits cleared only at test start, so anything sent during the first try still fails; a test that a page which never loads fails rather than passes; attack tests wait for `.results-table`. **A second-try load leaves no trace, so it could recur unnoticed.** S14 makes a retry visible in the output.

**Decision from S14 (Worker and Tester, accepted by the PM):** when the source compiles, a chat message also lists its result columns with their ClickHouse types, reusing an accepted version's check, and a check that doesn't return in the grace period just leaves them out. The ported assertion "the model sees the result columns" needs this, because chat messages otherwise had no columns. See F61 and F62.

**User decisions (2026-11-04, brief's "R13 test-expectation approvals"). The Tester makes these test changes; the Worker doesn't.**
- Remove `chart.test.ts` › `⌘G › maps to the chart prompt with ⌘ or Ctrl` (S12).
- Query replies always switch to the Table tab, as in the prototype. The user left this to the orchestrator, who chose it. Update `s7.test.ts` › `F11 and the chart heading › a generation keeps the current tab, except an empty Chart tab goes to Table` to match (S12). This supersedes F11.
- Retire the one-shot `ai.generateQuery`/`ai.generateChart` path in S14 and port its 38 tests to the chat path with the same assertions. The only reversal: a model answering without a query is a normal text turn in chat (R13.5), not an error.

### S10 — Chat server: conversations that persist and continue (selected as the first Worker slice)
- Refs: R13.2, R13.3, R13.4, R13.5, R2/R12 check-and-fix loop.
- Acceptance:
  - **Item 0, probes that stay as tests (faux provider, real SQLite file in a temp dir).** Any surprise is reported to the PM before building on it:
    - (a) a run ended by `terminate` can be continued by the next input, and the next request's messages contain the earlier turn;
    - (b) a `{ kind, data }` write isn't in the model's messages;
    - (c) an input with a custom `entry` shows the model `content` only;
    - (d) a fork at entry X yields a context without anything after X.
  - `chat.send` / `chat.list` / `chat.get` work over tRPC. A first send creates the chat. A second send continues the *same* conversation id: the faux request's `ctx.messages` contains the first prompt and the first accepted source.
  - Each user message carries the current editor source. A hand-edited source sent on turn 2 appears in that request's last user message, while the thread's user turn shows only the text.
  - A version turn has `n`, `summary`, `source`, `sql`, `rowType`, changed lines (small pure line diff, no new dependency, unit-tested: added, removed, unchanged, empty), `attempts`, `elapsedMs`.
  - **The outcome is scoped to the current run.** Today `readOutcome` scans the whole transcript, which on a continued conversation would report the previous run's check. Tests: v1 then a text reply gives no v2 and `attempts` 0; v1 (2 attempts) then v2 (1 attempt) reports 1 for v2; a failing turn after v1 reports its own error, not v1.
  - Text reply → text turn, `ok`-shaped, no version (the opposite of today's "answered without a query" error, on the chat path only). Unchanged source → no version (design above).
  - Check-and-fix still holds on this path: feedback to the model, the turn limit, a failure turn with the last attempt unmarked, a re-check before acceptance, a type error refused, and the prompt-injection case from `llm-tester`. `maxTurns` applies per run: 6 runs of 2 attempts each all succeed.
  - **Switch model:** a send after `selectModel` uses the new model on an existing chat (assert the model id in the faux request), and after a restart the running session's model is used, not the stored one.
  - **Persistence across a real restart (the required proof).** A test spawns a child process running the same storage path as `main.ts` (export `openStorage` so `main.ts`, the child and `ui-harness.ts` share it; `ui-harness.ts` uses SQLite when `HARNESS_DATA_DIR` is set). The child sends 2 turns and is then killed, once with SIGTERM and once with SIGKILL after the reply returned. A *new* process on the same data dir must give:
    - `chat.list` returns the chat, and `chat.get` the same turns and version numbers;
    - the next send continues it: the new process's faux request contains both earlier prompts and sources;
    - the next version is v3.
    An in-process close and reopen doesn't count. Also pass it once through the real server against ClickHouse in `studio.integration.ts` or `studio-tester.integration.ts`.
  - **A run cut off by a kill.** pi-durable resumes unfinished work on the next `submit`, in any conversation, with no one waiting for it. On open, Studio must end leftover live runs (`harness.inspect`, then abort; old one-shot conversations included) and add an "Interrupted" note to the affected chat. Test: SIGKILL mid-generation, restart: `generating` is false, the note is present, no model request happens at open or for the old input, and the next send works.
  - New chat: a null `chatId` gives a new conversation whose first request has none of the other chat's text. Two chats don't cross; reopening the older one continues its own history.
  - Old data: a `pi.sqlite` with old one-shot conversations lists none of them.
  - The one-shot `generateQuery`/`generateChart` paths are untouched in this slice: no existing test changes.
  - Root `pnpm typecheck` and `pnpm test` stay green, as do studio typecheck and tests. `~/.typedhouse` and `~/.pi` unchanged (temp dirs only; no real model).
- Depends on: —
- Status: **done (2026-11-04).** F32 was fixed in S11. Uncommitted.
- Evidence:
  - F32, PM code read: `chatMessage` in `server/chat.ts` says "The editor currently contains nothing." for an empty or whitespace-only source, on every chat turn; `withEditorSource` and the one-shot message are unchanged. Tests: `chat-s11.test.ts` › `F32: an emptied editor is said out loud, on every turn, and whitespace counts as empty` and `F32: the one-shot message shape stays as it was`. Gates: see S11.
  - The evidence below was recorded before the F32 fix:
  - Tester, returned OK:
    - root `pnpm typecheck` passes; studio `typecheck` passes;
    - root `pnpm test`, 2 runs: 133 files, 1840 passed, 2 expected fail, 2 skipped, no flakes;
    - studio `test`: 19 files, 401 passed, 2 expected fail, 1 skipped;
    - studio `test:integration`: 3 files, 43/43;
    - restart tests under load (16 busy loops): 36/36 on 2 runs;
    - `auth.json`, `settings.json` and `~/.typedhouse/studio/pi.sqlite` md5 unchanged;
    - new Tester tests: `test/chat-tester.test.ts` (64), `test/chat-tester-restart.test.ts` (26), `test/chat-tester-child.ts`;
    - not run: `check:all`, type-perf budget (both S14 gates).
  - PM, independent, 2026-11-04:
    - studio `typecheck` exits 0, and studio `test` gives the same 19 files, 401 passed, 2 expected fail, 1 skipped;
    - the three md5s are the same before and after that run;
    - integration, root runs and the load runs were not repeated by the PM.
  - PM code read, criterion by criterion:
    - Probes (a)–(d): `test/chat-probes.test.ts`.
    - Same conversation, editor source, version fields, run scoping, text and unchanged replies, check-and-fix, `maxTurns`, chats not crossing, old data: `server/chat.ts`, `test/chat.test.ts`.
    - Restart: `test/chat-restart.test.ts` spawns separate OS processes through the same `openStorage` as `main.ts`, under `describe.each` for SIGTERM and SIGKILL. It asserts identical `chat.list` and `chat.get`, the earlier prompts and sources in the new process's request, and v3. `test/chat.integration.ts` repeats this against ClickHouse 24.8, in its own file rather than the two named in the criterion.
    - Cut-off runs: `endLeftoverRuns`, covered by note, no-request and one-note-only assertions.
    - No existing test file changed (`git status`); `test/ui-harness.ts`, a helper, gained the SQLite option the criterion asked for.
  - Design refinement by the Worker, accepted: the index also holds a `running` flag, set in the commit that admits a user turn and cleared in the commit that records its reply. It catches a kill after the run but before the reply was written.

### S11 — Chat server: stuck-run fork, edit-and-resend, stop, charts, S10 findings (confirmed as the next Worker slice, 2026-11-04)
- Refs: R13.3 (closes S10), R13.6, R13.9, R4 validation; F28, F29, F30, F32, F33, F34.
- Order of work: item 1 first, and report it to the PM before building on it, because everything about stop and timeouts rests on it. Then edit-and-resend, stop, charts, findings. New router procedures: `chat.stop`, `chat.note`; `chat.send` gains `replaceFrom` and `sample`.
- Test handoff: these four tests must change once the fixes land, and they go red until then. The Worker leaves them alone and names them in its report; the Tester converts them. None is a committed expectation, so no user approval is needed.
  - `chat-tester.test.ts` › `a re-check that never returns does not hang the send forever` (`it.fails`, F28);
  - `chat-tester.test.ts` › `a title cut at the limit does not split an emoji` (`it.fails`, F29);
  - `chat-tester.test.ts` › `an empty editor on a later turn tells the model nothing about the editor (recorded behaviour, see the Tester report)` (F32);
  - `chat.test.ts` › `a provider that ignores the abort does not hang the send; the next send in that chat reports busy (S11 forks past it)` (item 1).
- Acceptance:
  - **Item 1, the stuck-run fork, proven first (faux provider that ignores the abort, real SQLite).** On a stop or timeout whose abort doesn't settle within the grace period, the chat moves to a fork **at the stopped `studio.user` entry**, and the note or error turn is written there. This replaces the earlier plan of forking before the turn and re-appending it: the turn comes along by itself, the model sees the prompt as it does after a normal stop, and a first turn needs no special case. It must show:
    - the next send in the same chat succeeds without `ConversationBusy` or a wait, and its request has the earlier turns and the stopped prompt;
    - the stuck run's late answer never reaches the fork, the thread or the editor;
    - five stuck runs in a row don't starve the scheduler: the sixth send still answers within its normal time, and other chats keep working;
    - `llm.close()` stays within its bound with stuck runs alive;
    - after a real SIGTERM and a SIGKILL with an abandoned parent still live, a new process makes no model request at open, adds no note for the abandoned parent (the chat points at the fork), and the chat continues.
    If any of these fails, stop and report: the fallback is a fresh conversation, which loses history and would need a decision.
  - **Chart turn:** `check_chart` is validated by `checkChartSpec` against the columns of the sent source (from `check`, so no prior run is needed; `sample` from the client when a result exists). A valid spec gives a version turn with `chart` and the query unchanged. A chart with `source` is checked in both parts, and a fault in either one is fed back. The `check_chart` bypass cases (inlined data, unknown fields, a JSON string spec) stay refused on this path. Failure gives an error turn. A chart request and a query request share one conversation: a chart turn after v1 sees v1; a query turn after a chart sees the chart turn.
  - **Edit-and-resend hides later turns from the model (the required proof).** Three turns with sentinel words in prompts and sources (`ALPHA`, `BRAVO`, `CHARLIE`). Resend from turn 2 with `DELTA`, and capture the raw faux `ctx.messages` and `systemPrompt`:
    - the request contains `ALPHA` and `DELTA`, and no `BRAVO` or `CHARLIE` anywhere, tool calls and tool results included;
    - the following turn in that chat is equally clean;
    - it is still clean after a real process restart (same harness as S10);
    - `chat.get` shows the dropped turns gone and numbering continuing from the fork (v2 again);
    - the fork's provider session id differs from the parent's (pi-durable gives a fresh one; assert it, so no provider-side state links the branches).
  - **First-turn edge:** resending turn 1 gives a fresh conversation and no earlier text. Retry is the same mutation with the same text.
  - **Stop leaves the conversation usable (the required proof).** Run each case, each followed by a next send *in the same chat* that succeeds and has the earlier turns in its request:
    - stop while the model is streaming;
    - stop while `check_query` is executing (the next request's messages must be valid: every tool call has a result);
    - stop with a provider that ignores the abort (item 1). The timeout path takes the same fork;
    - stop during the re-check (F28's path);
    - stop during a retry.
    In all cases: no version, a persisted "Stopped" note, and the reply says stopped even if the check passed in the same moment (stop wins). Stop when idle and a double stop are no-ops. `chat.stop` returns within the grace period.
  - `chat.get` reports `generating: true` while a send runs, including to a second client, and until the reply is recorded (F34): any read that sees `generating: false` also sees the reply. The run isn't tied to the sender's HTTP connection: the reply is recorded if the client goes away (needed for reload in S12).
  - **F28:** the re-check is bounded by the same timeout. A re-check that never returns gives an error turn, no version, and frees the busy guard, so the next send works.
  - **F29:** titles and summaries never contain a lone surrogate at the cut, with the limits unchanged.
  - **F30:** `diffLines` trims the common prefix and suffix, and above a fixed cell limit falls back to "all removed, all added". The result is still a true diff (the Tester's replay test stays green) and 32,000 × 32,000 lines finish quickly with bounded memory, tested on a child process with a small `--max-old-space-size`. A model source over 64,000 characters is a failed check fed back to the model, so it never reaches the editor.
  - **F32 (closes S10):** on the chat path, an empty or whitespace-only source sends an explicit line, such as "The editor currently contains nothing.", on every turn. The one-shot message shape stays unchanged. Test: emptied on turn 2, the raw request says so.
  - **F33:** a changed line lists its removal before its addition; `addedLines` stays right.
  - The one-shot path and its committed tests stay unchanged in this slice. Root `pnpm typecheck` and `pnpm test` and the studio gates pass after the Tester's conversions; `~/.typedhouse` and `~/.pi` unchanged.
- Depends on: S10
- Status: **done (2026-11-04), Tester OK after 4 rounds.** Uncommitted.
- Evidence:
  - Tester, final gates after the last test edit:
    - root `pnpm typecheck` passes; root `pnpm test`: 2070 passed, 2 skipped;
    - studio `typecheck` passes; studio `test`: 25 files, 631 passed, 1 skipped; studio `test:integration`: 47/47; studio `build` passes;
    - `~/.pi` and `~/.typedhouse` dates unchanged;
    - not run: `check:all`, type-perf budget (both S14 gates).
  - Tester, browser evidence for F36 and F37. **It comes from scratch scripts, not in the repo, and Chromium only;** S12 brings a repo version:
    - 50 attack specs with no row data reaching the sink with the CSP on;
    - 18 forced `bind.element` variants plus `usermeta.embedOptions.bind` left the Workspace intact, with live controls.
  - PM, independent, 2026-11-04:
    - studio `typecheck` exits 0, and studio `test` gives the same 25 files, 631 passed, 1 skipped;
    - `auth.json`, `settings.json` and `~/.typedhouse/studio/pi.sqlite` md5 are the same before and after that run;
    - no `it.fails` remains, so the four handoff tests are converted; `chat.test.ts`'s stuck-provider test now expects the fork;
    - the root runs, integration, build and browser scripts were not repeated by the PM.
  - PM code read, criterion by criterion:
    - **Item 1:** `waitForRun` reports `stuck` when the abort doesn't settle in time, and `send` forks at the stopped user entry. Tests: `chat-stuck-fork.test.ts`, which runs on pi-durable directly, `chat-s11.test.ts` › `item 1`, `chat-s11-restart.test.ts` for SIGTERM and SIGKILL, and `chat-tester-s11.test.ts`, which adds late answers at each stage and 25 stuck runs in a row.
    - **Edit-and-resend:** `branch` forks before the replaced turn, or starts fresh for the first. `chat-s11.test.ts` asserts the sentinels are absent from the whole request and on the following turn, with a different `sessionId`. `chat-s11-restart.test.ts` repeats it after a real restart.
    - **Stop:** a `chat-s11.test.ts` test for each case (streaming, check executing, check never returning, provider ignoring the abort, re-check, retry), plus stop wins, no-ops, and the next send's well-formed request.
    - **Charts:** both tools in `chatExtension`; columns come from the check of the sent or given source; `SentDoc` carries the sent source to the tool. Real columns against ClickHouse in `chat-s11.integration.ts`.
    - **F28:** `recheck`. **F29:** `cut`. **F30:** trimmed `diffLines`, `DIFF_CELL_LIMIT`, `tooLong`. **F33:** removal first. **F34:** `active` is cleared only after the reply commit, and `get` reads it first. Each has its tests in `chat-s11.test.ts`.
    - **F36, F37:** `server/chart.ts`, `web/chart.tsx`, `withoutPageTargets`, `contentSecurityPolicy` set before routing on every response. Tests: `chart-offline.test.ts`, `chart-guards.test.ts`.
  - The one-shot paths gained the shared chart guards (F36 is in `checkChartSpec`), but their committed tests are unchanged.

### S12 — Web: chat layout, thread, auto-run; the prompt box and chart prompt go (confirmed as the next slice, 2026-11-04)
- Refs: R13.1, R13.2 (UI), R13.4, R13.5, R13.6 (UI), R13.7, R13.10; F35, F36, F41 (browser proof). Basic keys only (↵, ⇧↵, esc to stop); the rest is S13.
- **Order, so the Worker and Tester don't collide:**
  - **Step A, Tester, before the Worker starts (test files only), in this order:**
    1. Remove `chat-tester.test.ts` › `the committed one-shot test files are unchanged` (F35). It must go first, because it fails on any uncommitted edit of `chart.test.ts` or `s7.test.ts`.
    2. Remove `chart.test.ts` › `⌘G › maps to the chart prompt with ⌘ or Ctrl`.
    3. Rewrite `s7.test.ts` › `F11 and the chart heading › a generation keeps the current tab, except an empty Chart tab goes to Table` against this contract in `web/rules.ts`: `viewAfterReply(view, reply: 'query' | 'chart' | 'other')` gives `table`, `chart`, and `view` respectively, so `query` is `table` from every tab. This replaces `viewAfterGeneration`.
    4. Update `test/ui-harness.ts` for the chat (moved here from S14): keywords read from the user's text only, not the editor source the message also carries; text, chart and stuck-provider replies; a flag to serve the built UI.
  - **Step A leaves one expected red:** the rewritten F11 test fails, and root `pnpm typecheck` fails on the missing `viewAfterReply`, until step B. Nothing else may be red.
  - **Step B, Worker (product code only, no test files):** everything under Acceptance, including `viewAfterReply`, and removing `viewAfterGeneration`, the `g` binding and the `chartPrompt` action. The `focusPrompt` action keeps its name. Report any other test that goes red; don't edit it.
  - **Step C, Tester:** the browser spec below, adversarial testing, gates.
- Acceptance (Playwright over `test/ui-harness.ts` with SQLite, plus screenshots against `Chat.dc.html` at 1440/900/700 px, light and dark):
  - Left pane is chat (thread + message box) above `query.ts`, with a horizontal divider that drags, clamps 30–75 %, and moves with ↑/↓ when focused. Right pane unchanged. Sidebar: Chats list (current highlighted) above Tables and Saved. ⌘K gets a Chats group and Ask goes through the chat. The empty state and the per-turn look match the prototype.
  - A send shows the user turn at once and a generating state with `esc stop`. The reply renders per kind (version: name, summary, changed lines, attempts, elapsed, "in editor"; chart: mark summary; text; note; error). Sending while generating does nothing and keeps the draft.
  - Version reply: the editor is replaced (undoable) and the query runs by itself (R13.7), and that auto-run is never dropped because a manual run is in flight. Query turn → always the Table tab (`viewAfterReply`). Chart turn → Chart tab and no re-run if the source is unchanged and a result exists; with no result, it runs so the chart can render.
  - Text reply: editor and results unchanged. Error reply: editor unchanged, the error is in the thread, and "load last attempt" stays available (keyboard in S13).
  - **An error turn's last attempt is unfiltered, so it must be guarded (Tester's warning).** The turn stores what the model sent, and a 64,001-character source was measured stored there.
    - "Load last attempt" is offered only for a string `source` of at most 64,000 characters (`MAX_SOURCE`). A longer one would make every next send fail validation, so the thread says it's too long to load instead. Loading never auto-runs.
    - An error turn's `spec` is a refused chart spec. It is never rendered, never put in chart state, and has no load action. Only a version turn's `chart` reaches `<Chart>`.
    - Tests: both cases by Playwright, with the 64,001-character source and a refused spec with an attack in it.
  - **Changed lines:** rendered in the order the server gives, with a removal before its addition (`-` then `+`, F33), never re-sorted. A long list is capped with "+N more", because the F30 fallback can list every line. `addedLines` highlight the editor as in the prototype, until the next edit. A chart turn with an unchanged query shows the mark summary instead.
  - **Model text is plain text:** summaries, text replies and errors render as text, with no HTML or Markdown interpretation.
  - **Sample rows:** `chat.send` carries `sample` (at most 20, via `chartSample`) only when the last successful run's source equals the source being sent, so the model never gets rows from an older query as if they were current.
  - **Removed:** the prompt input, the chart prompt box and ⌘G, with their localStorage keys, the palette entries and the hints. The Chart tab's empty state points at the chat.
  - **Survive reload and server restart (browser-level proof):** reload keeps the thread, chat, draft, editor and spec. Reload mid-generation shows generating, then the reply, and the version applies. Kill and restart the server process and reload: the thread is back and a next message continues it.
  - Reopen from the sidebar and from ⌘K restores the thread and editor (design above); a new chat is empty. Editing a query by hand, then switching chats and back, keeps the hand edit.
  - During a generation, completions, diagnostics, ⌘↵ and `chat.stop` still respond: `chat.send` must not share an HTTP batch with them (`httpBatchLink` holds a batch until its slowest call ends).
  - R13.10 still works, by Playwright: saved queries (save, load with chart, delete, overwrite) with the behaviour in the design above; Switch model (next send uses it, in the same chat); squiggles, badge, completions, hover; auto-limit.
  - **Browser proof of the CSP and the exfiltration block, in the repo (owner: the Tester, step C; today's proof exists only in scratch).**
    - **Files:** `packages/studio/test/browser/chart-offline.spec.ts` and `packages/studio/playwright.config.ts`, a `test:browser` script in studio's `package.json`, and `@playwright/test` as a studio dev dependency at the version `apps/docs` uses (`^1.64.1`), with the lockfile updated. The Tester may touch these config files for this item only.
    - **How it stays out of root `pnpm test`:** the `.spec.ts` name under `test/browser/`. Root vitest collects only `packages/**/*.test.ts` and `test/**/*.test.ts`, and the integration config only `test/*.integration.ts`, so neither picks it up. Root `pnpm typecheck` does cover it (`packages/**/*.ts`), so the dev dependency is required. Verify with root `pnpm test` and `pnpm typecheck` after adding it.
    - **How it runs:** `pnpm --filter @typedhouse/studio test:browser`, needing Docker and Chromium (`playwright install chromium`), the same standing as `test:integration`: separate, not in `check:all`, run at the S14 gate. Temp data dirs only.
    - **Attack route:** a hand-edited `saved.json` in the temp data dir, since the validator would refuse these specs through the chat. Load, run, render, with a local sink server. A row sentinel must not reach the sink for: a row-built paint address, `\75 rl(` (F41), an image mark, `href`, a `loader` option, and `usermeta.embedOptions`. A `bind.element` variant must leave the Workspace intact.
    - **It must not pass vacuously:** a control run strips the CSP header with `page.route` (no product flag) and must see the row-built paint address reach the sink. If it doesn't, the spec fails.
    - **Both UIs:** the dev UI and the built `dist/web`, because the bin serves the built one. The CSP header is asserted on a page and on an API response.
    - Chromium only, recorded as a limitation.
- Depends on: S10, S11.
- Status: **done (2026-11-04).** Uncommitted, on top of `3a371e5`.
  - **Closed in S13, Open 1, R13.10 "by Playwright":** `test/browser/editor.spec.ts` covers squiggles and the badge, hover types and completions with column types, and ⌘/ auto-limit including across a reload.
  - **Closed in S14, Open 2, as far as it can be:** all 32 shots were viewed on the final tree against the prototype's markup, with no pixel comparison, and the user gets the last look. At S13 the PM judged it not yet satisfied: The prototype can't be rendered: it needs `./support.js`, which isn't in the exported project, so a pixel comparison isn't available and comparing against its markup and key tables is a fair substitute for the *comparison*. But the Tester viewed only 4 of 32 shots, and the criterion is about how the result looks. `layout.spec.ts` now measures overflow at 1440, 1000, 900 and 700 px in both schemes, which covers breakage, not fidelity. S14 closes this on the final tree: the Tester views all the shots, and the user, who approved the design, gets the last look.
- Evidence:
  - Tester, final gates after the last test edit:
    - root `pnpm typecheck` passes; root `pnpm test`: 2068 passed, 2 skipped;
    - studio `typecheck` passes; studio `test`: 25 files, 629 passed, 1 skipped; `test:integration`: 47/47;
    - `test:browser` (includes build): 124 passed, no expected failures, 5.7 min. Chromium only; chat flows on the built UI only; chart-offline on built and dev;
    - `~/.pi` and `~/.typedhouse` dates unchanged;
    - not run: `check:all`, type-perf budget (both S14 gates).
  - PM, independent, 2026-11-04:
    - studio `typecheck` exits 0, and studio `test` gives the same 25 files, 629 passed, 1 skipped. That's S11's 631 minus the two removed tests (F35's guard and ⌘G);
    - `auth.json`, `settings.json` and `~/.typedhouse/studio/pi.sqlite` md5 are the same before and after that run;
    - the root runs, integration and `test:browser` were not repeated by the PM.
  - PM code and test read, criterion by criterion (`web/main.tsx`, `web/thread.tsx`, `web/rules.ts`, `test/browser/*`):
    - **Layout:** chat above the editor; `split-h` clamps 30–75 % and moves with ↑/↓; Chats above Tables and Saved; a Chats group in ⌘K, and Ask goes through `send`. Tests: `layout.spec.ts`.
    - **Turns and auto-run:** rendered per kind in `thread.tsx`, all as plain text (no `dangerouslySetInnerHTML`; the only `innerHTML` is a static `<summary>` in `editor.tsx`). `queuedRun` keeps a reply's run from being dropped. `viewAfterReply` sends query turns to Table.
    - **Guards:** `canLoadAttempt` at 64,000 characters; `applyReply` acts only on a version, so an error turn's `spec` never reaches `<Chart>`; tests with the 64,001-character source and a refused spec with an attack in it. Changed lines are in server order and capped by `cappedChanges`; `addedLines` highlight the editor. `sample` goes only when `ranSource` equals the sent source.
    - **Removed:** prompt input, chart box, ⌘G, their keys (`store.remove`), palette entries and hints.
    - **Reload and restart:** real kill and restart, and reload mid-generation, in `chat.spec.ts` › `the main flows`. Reopen, hand edit across a switch, and new chat are covered too.
    - **Batching:** `splitLink` keeps `chat.send` and `query.run` out of batches, with a test.
    - **R13.10:** saved queries, Switch model and completions by Playwright; the rest is Open 1.
    - **CSP spec:** `chart-offline.spec.ts` covers the row-built paint address, `\75 rl(`, image mark, `href`, loader, `usermeta.embedOptions`, and `bind.element`; a control strips the CSP with `page.route` and requires the sink hit for the first two; built and dev projects; the header is asserted on a page and on API responses. `.spec.ts` under `test/browser/` stays out of vitest's include.
    - **Test changes:** F35's guard and the ⌘G test are gone; `s7.test.ts` tests `viewAfterReply`; `@playwright/test` is a studio dev dependency.

### S13 — Full keyboard map and zones (confirmed as the next Worker slice, 2026-11-04)
- Refs: R13.8, R13.9 (UI), R13.10 ("every action reachable with no mouse"); S12's two open items.
- **Order, so the Worker and Tester don't collide:**
  - **Step A, Tester, before the Worker starts (test files only):**
    1. In `test/browser/chat.spec.ts`, change the `+ new` lookups to match a name ending in `new`, which stays green before and after the label change.
    2. Rewrite `chat.spec.ts` › `retry on the dimmed message resends the original, as a retry does` to the decision below. It stays red until step B; nothing else may be red.
  - **Step B, Worker (product code only, no test files):** everything under Acceptance. Report any test that goes red; don't edit it. Unit tests for the pure key tables are the Tester's in step C.
  - **Step C, Tester:** `test/browser/keyboard.spec.ts`, unit tests for the tables, S12's two open items, gates.
- **Structure.** Bind what exists instead of a second table: `actionsFor` in `web/main.tsx` is the table for a selected turn (each action has a `key` and `run`), and a key does exactly what the selected turn's hint shows, and nothing otherwise, so hints can't drift from behaviour. Global shortcuts stay in `keymap.ts`, pure and DOM-free. The `?` dialog and footers read from one table of labels with `MOD`.
- **Decisions (PM).**
  - **Esc order in the message box, first match wins:**
    1. The open chat is generating → stop it. Focus stays, and the draft is kept. A generation in *another* chat doesn't count; it has its own stop route.
    2. An edit is open → cancel it (restores what was put aside, drops the rewrite), as the visible `esc cancel` line says. Focus stays. A typed rewrite has no undo, which is accepted because the line says so and ↑ reaches the thread without cancelling.
    3. The thread has turns → move to the thread, selecting the last visible turn.
    4. Otherwise nothing.
    So three escs from a generating edit-free chat go: stop, thread, box. Esc during IME composition does nothing here.
  - **Esc elsewhere:**
    - Dialogs first: the `?` dialog, palette and save field close themselves and take nothing else.
    - In the thread: generating → stop and stay; otherwise → box. An open edit stays open.
    - In the editor: CodeMirror first, by a low-precedence CodeMirror keymap binding rather than the window capture handler, so it closes completions, the search panel or the lint panel and stays. Then generating → stop and stay; otherwise → box. An open edit stays open: only the box's esc cancels.
    - With focus on a button, a divider or nowhere: the same as the thread.
  - **The dimmed edited turn doesn't offer retry.** `r` would resend the original and silently discard the rewrite. Its hints are `↵ back to message` and `y copy`; `e` and `r` do nothing on it. While any edit is open, `r` isn't offered on other turns either, because it would discard the rewrite the same way; esc first. `e` and `↵` on an earlier user turn keep re-targeting the edit, as tested today. Restoring a version during an edit stays as it is.
  - **During a generation in the open chat** a selected turn offers only `y`. `↵`, `e` and `r` aren't shown and do nothing (`chat.note` is refused then, and a reply would overwrite a restore).
  - **Turn kinds:** a note has no hints and its keys do nothing, though it can be selected. On a text turn `↵` does nothing. On an error turn, `↵` is "load last attempt" when `canLoadAttempt` allows it, and `y` copies the last attempt if there is one, else the error.
  - **Sidebar:** the prototype's `⌘⇧L new`, using `MOD`.
- Acceptance. Tested with Ctrl on Linux Chromium; Meta in a sample, since `matchShortcut` accepts either; ⌘ labels by unit test of `isMac`.
  - **Message box:**
    - ↵ sends; ⇧↵ makes a new line.
    - Esc follows the order above.
    - ↑ moves to the last visible turn when the box is empty, or the caret is collapsed at offset 0, with no modifier. Elsewhere it moves the caret; Shift+↑ selects. During an edit it lands on the dimmed turn without cancelling.
    - On an empty thread ↑ does nothing.
  - **Thread:**
    - Real focus, and an active-turn ARIA state.
    - ↑ and `k` move up and stop at the first turn. ↓ and `j` move down, and moving down past the last turn returns to the message box.
    - On a version, `↵` restores it to the editor and runs it, restoring its chart if any, with the "Restored vN" note; the selection moves to the note, as in the prototype.
    - On a user turn, `↵` and `e` edit and focus the box, and sending resends.
    - On a reply, `e` edits its user turn.
    - `r` retries and returns focus to the box.
    - `y` copies the query on a version and the text on a message or text reply. Brief visible feedback ("Copied v2", "Copied message"), and a refused clipboard says so.
    - Esc follows the order above; `i` always returns to the box.
    - The selected turn shows its own key hints, as in the prototype.
    - Single letters and arrows fire only in the thread, never with a modifier, and never in an input.
    - With the thread focused, a new reply doesn't scroll the selection away.
    - A selected turn that disappears falls back to the last visible one.
  - **Anywhere, from the box, the thread and CodeMirror alike, with `preventDefault`:**
    - ⌘L message box. ⌘⇧L new chat, and focus on the box.
    - ⌘E editor.
    - ⌘↵ run. ⌘1, ⌘2, ⌘3 tabs. ⌘/ auto-limit. ⌘S save. ⌘K palette.
    - `matchShortcut` must tell ⌘⇧L from ⌘L, and letters otherwise need no Shift, so ⌘⇧K and ⌘⇧S are left to the browser. ⌘/ still works where `/` needs Shift. `key('L')` in `eval.test.ts` stays valid, as does the `focusPrompt` name.
    - The palette open blocks all of these except its own keys, and the `?` dialog does the same.
  - **`?`** opens the shortcuts dialog, grouped as in the prototype, from the thread, a button or nowhere. It **doesn't fire in a text input**: it types normally in the message box, CodeMirror, the save field and the palette. Esc or `?` closes it, and focus returns to where it was. It lists every key above.
  - **Footer hints change with the focused zone:**
    - box: ↵ send, ⇧↵ new line, ↑ earlier turns, ⌘E editor, ⌘↵ run;
    - thread: ↑↓ move, esc back to message, ? all shortcuts;
    - editor: ⌘↵ run, esc back to chat. It omits `?`, which can't work there, unlike the prototype's editor footer;
    - while generating, `esc stop` is shown; during an edit in the box, `esc cancel`.
  - **Palette:** `kbd` hints for New chat (⌘⇧L) and new entries for Editor (⌘E) and "Keyboard shortcuts" (?).
  - **Every action is reachable with no mouse.** Actions with no key of their own stay Tab-reachable, with a visible focus: sidebar rows, delete saved, both dividers, "Open it to stop it", "Load last attempt".
- **Browser suite (owner: the Tester, step C): `test/browser/keyboard.spec.ts`, built project.**
  - **One row per key above,** with focus in the zones that apply, including: j, k, `i`, y, e, r; ↑ at the start of the box versus mid-text; moving down past the last turn; each esc step in order; CodeMirror needing esc first, with an open completion list, then a second esc moving to the box; `?` typing in all four text inputs and opening elsewhere; ⌘⇧L not acting as ⌘L; `defaultPrevented` on Ctrl+E, Ctrl+Shift+L and the rest inside CodeMirror.
  - **The no-mouse walkthrough:** new chat → ask → refine → chart → restore v1 → edit and resend → stop → retry → save → reopen an older chat via ⌘K → both dividers, ending in the right state, with the model's request checked after the edit.
  - **It must really be keyboard-only:** a test in the file reads its own source and fails on `.click(`, `.hover(`, `.dblclick(`, `.tap(`, `.check(` or `.mouse.` (its own needles excepted).
  - **Runs** under `pnpm --filter @typedhouse/studio test:browser`, so no config change is needed.
- **S12's open items, also Tester step C:**
  - Add Playwright checks of squiggles, the type-check badge, hover types and ⌘/ auto-limit.
  - Take screenshots at 1440, 900 and 700 px, light and dark, of a thread with a selected turn, in the message box, thread and editor zones and the `?` dialog; compare them side by side with `Chat.dc.html`, and report differences beyond the recorded decisions. Add 900 px to `layout.spec.ts`.
- Gates: root `pnpm typecheck` and `pnpm test`, studio typecheck, test, integration and `test:browser`; `~/.typedhouse` and `~/.pi` unchanged. Not required here: `check:all`, type-perf budget (S14).
- Depends on: S12's product code.
- Status: **done (2026-11-04).** Uncommitted, on top of `3a371e5`.
  - **Closed in S14, the unit tests of the key tables:** `test/keymap.test.ts` covers `isMac`, `globalKeys` including `⇧⌥M`, `keyGroups`, `zoneHints`, `IGNORES_REPEAT` and ⌘⇧L versus ⌘L. At S13 no test imported them, so the Mac labels were untested rather than "unit-tested only" as reported.
- Evidence:
  - Tester, final gates on the current tree:
    - root `pnpm typecheck` passes; root `pnpm test`, 2 runs: 2068 passed, 2 skipped;
    - studio `typecheck` passes; studio `test`: 25 files, 629 passed, 1 skipped; `test:integration`: 47/47;
    - `test:browser` (includes build): exit 0, 214 passed, no expected failures, 11.0 min, at load 13–21;
    - `~/.pi` and `~/.typedhouse` dates unchanged;
    - limits: Chromium on Linux only; held keys and IME simulated;
    - not run: `check:all`, type-perf budget (both S14 gates).
  - PM, independent, 2026-11-04:
    - studio `typecheck` exits 0, and studio `test` gives the same 25 files, 629 passed, 1 skipped;
    - `auth.json`, `settings.json` and `~/.typedhouse/studio/pi.sqlite` md5 are the same before and after that run;
    - the root runs, integration and `test:browser` were not repeated by the PM.
  - PM code and test read, against this slice's list (`web/keymap.ts`, `web/main.tsx`, `web/thread.tsx`, `web/editor.tsx`, `test/browser/keyboard.spec.ts`):
    - **Structure:** selected-turn keys run `actionsFor`, so hints and behaviour share one table; `keyGroups`, `zoneHints` and `globalKeys` feed the dialog, footers, palette and sidebar.
    - **Message box:** ↵, ⇧↵, ↑ only at the very start or when empty, ⇧↑ selecting, the esc order, IME, and held keys all have tests.
    - **Thread:** ↑ ↓ j k, moving down past the last turn, `i`, `↵` per turn kind, e, r, y with feedback and a refused clipboard, generating, edit, modifier, disappearing-selection and scroll cases all have tests.
    - **Dimmed turn and decisions:** `actionsFor` gives the edited turn only `↵ back to message` and `y`; `r` is withheld during an edit or another chat's generation.
    - **Anywhere:** Control and Meta from all three zones with default prevented; `matchShortcut` tells ⌘⇧L from ⌘L and leaves other ⌘⇧letters alone.
    - **Editor esc:** `Prec.lowest` binding; completions, search and lint panels close first, separately and combined.
    - **`?`:** the dialog blocks everything behind it, and focus returns; letters and `?` type in all four text inputs. Footer and palette entries are tested. Tab reach is tested in both directions.
    - **Walkthrough:** `the no-mouse walkthrough` covers the full route including both dividers, with the model's request checked after the edit. `this file really is keyboard-only` reads the file's own source.

### S14 — Retire the one-shot path, docs, real smoke, gates (confirmed as the final slice, 2026-11-04)
- Refs: R13.10, R2 (real model), and closes R13; S12 Open 2, S13's open item, F53, F55.
- **Order, so the Worker and Tester don't collide. The tree stays green at the end of each step:**
  - **Step A, Tester, before the Worker (test files only):**
    1. Port the one-shot path's 38 tests to the chat path with the same assertions, in new or existing chat test files, while both paths still exist. The only reversal: a model answering without a query is a normal text turn (user-approved; already in chat tests). Record a table of old test → twin in the evidence. A twin that fails reveals a gap in the chat path: report it to the Worker, who fixes it first.
    2. Only when a twin is green, delete its original. The 38 are in `llm.test.ts`, `llm-tester.test.ts`, `chart.test.ts`, `chart-tester.test.ts`, `types.test.ts`, `saved.test.ts`, `s56-tester.test.ts` and `studio.integration.ts`.
    3. Rewrite the later tests that call the one-shot API (`chat.test.ts`, `chat-tester.test.ts`, `chat-s11.test.ts`, `chat-restart.test.ts`, `chat-tester-restart.test.ts`). Those about **old data** keep their point: old one-shot conversations in a file are not listed, cause no request, and a cut-off one ends at open. They create that data with a raw pi-durable `Harness` and a test-local extension under the old names, then reopen without it. Tests that only pin the one-shot path's own shape (`the one-shot path is unchanged`, `F32: the one-shot message shape stays as it was`) go with the path.
    4. Add `test/keymap.test.ts`: `isMac`, `⌘` and `Ctrl+` labels including `⇧⌥M`, `zoneHints` per zone and state, `keyGroups` listing every key, `IGNORES_REPEAT`, ⌘⇧L versus ⌘L. This closes S13's open item.
    5. Add a browser check that Tab into a non-empty thread selects the last turn (F53), and make a retried load in `chart-offline.spec.ts` print a visible line (F55).
  - **Step B, Worker (product code and README only, no test files):**
    - Remove `ai.generateQuery`, `ai.generateChart`, `Llm.generateQuery`, `Llm.generateChart`, the `typedhouse-query` and `typedhouse-chart` extensions, `converse`, and what only they use (`readOutcome`, `generateInput`, `chartInput`, the old guide variant). Keep the busy guard, `CHART_GUIDE` if the chat uses it, and the cheat sheet.
    - Opening a data dir with old one-shot conversations must keep working with those extensions gone.
    - Write the README, below. Report anything that goes red.
  - **Step C, Tester:** the screenshot item, then the real-model smoke, then the final gates. Any product fix goes through the Worker. After a fix, rerun the smoke cases it touches. **The gates run last, on the final tree;** a product change after them means running them again.
  - **Step D, PM:** completion table R13.1–R13.10 → evidence; R1, R4 and R6 rows noted as superseded where R13 replaced them; heading back to done. The orchestrator commits.
- Acceptance:
  - **Retirement:** no `generateQuery` or `generateChart` left in `packages/studio` outside the evidence's mapping; the tRPC router has no `ai`; every safety assertion of the 38 survives, reviewed one by one by the Tester.
  - **README (`packages/studio/README.md`) says:**
    - the chat: conversation, versions, text replies, charts in chat, edit and resend, stop, auto-run for reads, restore, one generation at a time across chats, past chats in the sidebar and ⌘K; ⌘G and the prompt box are gone;
    - every key by zone, including Ctrl+M (⇧⌥M on Mac) for Tab, and the esc order, including that esc on a typed rewrite drops it with no undo;
    - **sample rows:** up to 20 rows go to the model with every chat message once a current result exists, and stay in `pi.sqlite`;
    - **charts:** a chart can't load or link to anything, and **the CSP is the barrier for row-built paint addresses, so it must stay** (F36);
    - **the data dir:** `pi.sqlite` holds chats, transcripts and sample rows, and dropped branches stay on disk (F26); `saved.json` (saved queries; loading one changes the editor and chart, not the chat); drafts and open edits are in the browser's localStorage (F49);
    - **no lock across processes:** don't run two Studios on one data dir (F25);
    - without credentials the chat is off and past chats aren't listed until you log in (F27); a damaged chat index is not repaired (F31);
    - **tests:** `test:browser` needs Docker and Chromium, includes a build, takes about 11 minutes, and stays out of `check:all`, as `test:integration` does; browser coverage is Chromium on Linux only;
    - below about 1000 px the panes stack and results are one scroll down (F44).
    The "Generation history" sentence and the old key table are replaced, not left beside the new ones.
  - **S12 Open 2:** on the final tree, the Tester views all the shots from `SHOTS_DIR`, not a sample, at 1440, 900 and 700 px in both schemes, against the prototype's markup and key tables, and lists differences beyond the recorded decisions. A real pixel comparison isn't possible without `support.js`; that limit is recorded, and the user gets the last look.
  - **Real-model smoke, run by the Tester as independent evidence; requested by the orchestrator, as the brief requires:**
    - **Setup:** the built bin with the user's real pi credential, read-only use, default model `openai-codex/gpt-5.6-sol`; a throwaway testcontainers ClickHouse 24.8 with the repo fixture, never the user's data; `--data-dir` in a temp dir, never `~/.typedhouse/studio`. Keep it to about 15 messages. Through the real UI with keyboard events for at least the main route; tRPC is fine for the kill cases.
    - **Cases, at least:**
      1. A multi-turn chat with at least 3 follow-ups that build on each other, including one after a hand edit and one with the editor emptied.
      2. A text reply: a question about the data or schema gives no version and no editor change.
      3. A chart turn: the real spec passes the validator and draws on the Chart tab; a chart that needs a query change, if the model offers one.
      4. Edit and resend: the reply is a new version, and asking the model what was said before finds no trace of a dropped sentinel word.
      5. Stop mid-generation: a "Stopped" note, the editor unchanged, and the next message in the same chat succeeds.
      6. **The context after an aborted turn, the top open risk:** the next message after a stop, after a SIGKILL mid-generation (with the "Interrupted" note), and if it can be timed after a stop during a tool call. Any provider complaint, such as about consecutive user messages or an unanswered tool call, is recorded verbatim.
      7. A restart mid-chat, with SIGTERM and with SIGKILL: the thread is back, and the next message continues with the history.
      8. Old data: a **copy** of the real `~/.typedhouse/studio/pi.sqlite` in a temp dir, never the original, opened by the final build: no chats listed, no model request at open, then one send works. The copy is deleted afterwards.
    - **The credential:** record the md5 and the `openai-codex` expiry of `auth.json` before and after, and never print a token, in logs or in evidence. It may change only by a token refresh: same providers, other entries byte-identical, same file mode, valid JSON in pi's format, and a further model request succeeds afterwards. `settings.json` and `~/.typedhouse/studio` are unchanged.
    - **A failure here is reported, not worked around.** It goes back to the Worker.
  - **Final gates, on the final tree:** root `pnpm typecheck`; root `pnpm test`; studio `typecheck`, `test`, `test:integration`, `build`, `test:browser`; `node scripts/check-type-performance.mjs`; **`pnpm check:all`**. `test:browser` (about 11 minutes) stays out of `check:all`, by the same reasoning as the user's decision on integration tests, so it's run separately here. `~/.typedhouse` and `~/.pi` unchanged, apart from a token refresh as above.
- Depends on: S13's product code.
- Status: **done (2026-11-04).** Uncommitted, on top of `3a371e5`.
- Evidence (gates in the completion check at the top):
  - **Retirement, PM read:** `grep -r generateQuery|generateChart` over `server`, `web`, `test` and the README finds nothing; the router has no `ai`; `registry.install` installs only the chat extension. The old names survive only in `test/old-data.ts`, a test-local extension that makes old data. `llm.test.ts` and `llm-tester.test.ts` are deleted.
  - **The 38 ported tests, old → twin, PM count:**

    | Old file | Tests | Twin |
    |---|---|---|
    | `llm.test.ts` | 10 | `chat-ported.test.ts` › `queries in chat`, with old names in comments |
    | `llm-tester.test.ts` | 10 | `chat-ported.test.ts` › `the check-and-fix loop in chat` |
    | `chart.test.ts` | 6 | `chat-ported.test.ts` › `charts in chat` (7 tests: "columns and sample rows" split in two) |
    | `chart-tester.test.ts` | 6 | `chat-ported.test.ts` › `providers that ignore abort, and only a checked spec` |
    | `types.test.ts`, `saved.test.ts`, `s56-tester.test.ts`, `studio.integration.ts` | 2, 1, 1, 2 | Changed in place to the chat path |

    The one reversal is present and marked: a model answering without a query is a text turn. "Columns are taken from the request" became "from the sent source", which is the design.
  - **Assertion review:** the PM compared (c) the turn limit, prompt injection and the two-calls-in-a-round tests with their originals, and they are the same or stricter. **That's a spot check.** The criterion's one-by-one review belongs to the Tester, and the PM holds no record of it beyond its OK.
  - **README, PM read:** everything on the list is there: the chat, keys by zone, the esc order and the dropped rewrite, Ctrl+M, sample rows, the CSP as the barrier, the data dir, no lock across processes, no credentials, the damaged index, the stacked layout, `test:browser` and Chromium only. The old "Generation history" sentence and key table are gone.
  - **F53, F55, S13's open item:** `keyboard.spec.ts` › `Tab into a non-empty thread selects the last turn…`; a `[F55]` line and a test for it in `chart-offline.spec.ts`; `test/keymap.test.ts`.
  - **Real-model smoke, Tester (`scratchpad/s14smoke/smoke.jsonl`, read by the PM):** `openai-codex/gpt-5.6-sol`, built bin, throwaway ClickHouse fixture, temp data dir, 15 messages, 0 page errors, no complaints in the server log.
    - 8 version or chart turns (messages 1–4, 6–8, 13), each 1 attempt, 2.4–4.2 s; 5 text replies with the editor unchanged.
    - Hand edit kept (`keptLimit`); the emptied editor rebuilt from scratch; chart drawn.
    - Edit and resend with `ZEBRAQUARTZ`: gone from the thread, moved to a fork (conversation 2 → 65), numbered v6 again, and the model answered "none". **Indirect:** the bin doesn't log requests, so this isn't verified on the wire; the faux tests verify the request.
    - **The context after an aborted turn, the top open risk:** the next message worked after a stop, after a SIGKILL mid-generation with the "Interrupted" note, and after a SIGTERM, with no provider complaint and history intact.
    - **Not exercised with the real model,** both conditional in the criterion: a stop during a tool call, and a chart that needs a query change. Both are proven by faux tests.
    - **Message 13's prompt was doubled** by F60. The reply still made sense.
    - **Old data:** a copy of the real `pi.sqlite` with 5 conversations, 23 entries, 0 live tasks was unchanged after opening, with 0 chats listed; the first send worked; the copy was deleted.
    - **Credential:** `creds-before.json` and `creds-after.json` match on `auth.json` md5, mode, mtime, providers, expiry and other entries, and on `settings.json` and `pi.sqlite`. No refresh happened. No token in the records.
  - **Screenshots:** 32 viewed against the prototype's markup, not pixel-compared.

### Completion check (PM, 2026-11-03): requested scope COMPLETE (R1–R12)
All slices S1–S9 are done. The final tree is `cb3bfd6` on `studio`, pushed by the orchestrator. Final gates on that tree (Tester):
- root `pnpm typecheck` passes;
- root `pnpm test`: 128 files, 1703 passed, 2 skipped;
- studio: typecheck passes; test 264 passed, 1 skipped; integration 41/41; build passes;
- type-perf budget unchanged;
- **`pnpm check:all` exits 0 in 486 s**;
- `~/.typedhouse` and `~/.pi` unchanged (mtime + md5).

**Requirements → evidence:**

| Req | Status | Evidence |
|---|---|---|
| R1 Text → query in an editable editor | done | S3. Faux tests: first try, fix on the second attempt, turn limit. Real smoke: 3/3 in F5, and 3/3 in S8 (1 attempt in 4.4 s; 1 in 3.6 s; 2 in 12.0 s for a `val()`-labelled union), all run. |
| R2 pi durable + pi credentials, checked and fixed before shown | done | S2/S3/S9. `piCredentialStore` over `~/.pi/agent/auth.json` (pi's lock, atomic, format kept); pi-durable Harness with `check_query`, which compiles *and* type-checks. `auth.json` unchanged in both real smokes. The model default `openai-codex/gpt-5.6-sol` replaces pi's `settings.json` default (user decision). |
| R3 ⌘↵ run, Table + SQL tab with params | done | S1. Integration (exact auto-limit, superjson types, readonly=2); Playwright Ctrl+Enter, tabs. |
| R4 Prompt → Vega-Lite, Table default | done | S4. `checkChartSpec` (no model data, fields checked, escaping); 8 headless vega render tests; 15 Playwright chart checks; real smoke 1/1 chart on the first attempt in 3.2 s. |
| R5 Auto-limit 100, ⌘/ toggle, no button | done | S1. `.limit(100)` shown, 101 executed so "limited" is exact; boundaries 0/99/100/101 in integration. |
| R6 Keyboard navigation (⌘↵ ⌘L ⌘1–3 ⌘G ⌘K) | done | S1/S4/S6. Plus ⌘S and the palette (actions, tables, saved, Switch model, Ask row). Playwright preventDefault checks for Ctrl+K/S/L/G/1/Enter inside CodeMirror. |
| R7 Node localhost, React, tRPC v11 + superjson, Vite | done | S1. No SSE was needed: generation is a single mutation. |
| R8 ClickHouse via flags/env, codegen introspection, readonly client | done | S1/S7. `introspect` + `editorSchema` (collision-safe bindings); readonly=2 refuses writes/DDL/SYSTEM/GRANT/SET (integration). |
| R9 Approved design | done | S7. 24 screenshots, light and dark, at 1440/900/700 px; no overflow, readable contrast. The landing page is out of scope. |
| R10 One start command, prints the URL, 127.0.0.1 | done | S1, item 0 of S2+S3, and S8. `pnpm --filter @typedhouse/studio dev` (no prior build) and the `typedhouse-studio` bin, both run by the Tester per the README. |
| R11 Saved queries in local JSON | done | S5. `<data-dir>/saved.json`, atomic, corrupt-safe; sidebar and palette; real smoke save + list round-trip with the chart. |
| R12 Editor language intelligence | done, with one deferred target | S9. Diagnostics, completions, hover, and type-checked generation. Light queries meet the latency targets; heavy aggregate queries are about 263–295 ms (within R12's 300 ms, missing the internal 150 ms p95 target). Deferred by the user (F21). |

**Follow-ups, final disposition:**
- **Deferred (user decision):** F21, heavy-query type-check latency caused by core's aggregate overload types. "Not now"; a future core type-performance task under the `test/types/bench` budget rules.
- **Accepted, known limitations (recorded in the README or here):**
  - F10: a `[__proto__]` column shows a chart error.
  - F16: case-sensitive saved names.
  - F17: no cross-process lock on `saved.json`.
  - F20: tables named after unreserved globals shadow them in editor code.
  - F22: `export { q as default }` gives "No query found" (skipped test).
  - F23: columns named `ir`, `_rowType` or starting with `__` are hidden from completions.
  - F24: no completions inside `e['…`.
  - F2: pass-then-fail `check_query` in one turn reports failure (safe).
  - F3: unlocked `auth.json` reads can rarely show "LLM unavailable" during a pi write.
  - The pi-ai all-providers dependency weight (lockfile).
- **Decided:** studio integration tests stay out of `check:all` (user). They run via `pnpm --filter @typedhouse/studio test:integration`.
- **Closed:**
  - F1: abort grace;
  - F4a: superseded by the notice removal;
  - F4b: prompt-only;
  - F5: real smoke;
  - F6: `val()` labels;
  - F7: plain chart titles;
  - F8, F9: escaping;
  - F11: tab rule;
  - F12: lazy sql-formatter;
  - F13: core-name collisions;
  - F14: stale chart;
  - F15: model credentials;
  - F18: temp data dir;
  - F19: test temp-dir cleanup.

**Not done by design (the brief's out-of-scope list):** landing page, npm publishing (the package stays `private: true`), auth, multiple users, Electron, docs site changes.

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

### Done slice: S8 — final gates, bundle, README (selected 2026-11-03, done 2026-11-03 in `cb3bfd6`; the final slice, no next slice)
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
- Status: **done** (Tester OK; committed and pushed by the orchestrator as `cb3bfd6` on `studio`).
- Evidence:
  - **F12 (Worker, Tester-checked):** sql-formatter is lazy (`import('sql-formatter')` in `web/main.tsx`). The main bundle went from 877,765 B to 788,645 B; the formatter chunk is 89,451 B and loads on the first SQL tab view. Vega stays lazy (851,238 B). The Tester checked:
    - no formatter request is made before the SQL tab opens;
    - opening the tab shows formatted SQL;
    - with the chunk blocked, the raw SQL and params still render, with 0 page errors.
  - **README (Worker, Tester-checked):** `packages/studio/README.md`, 73 lines; sections Start, The model, Using it, Limitations.
    - The Tester checked every claim against the code and `--help`, and ran the documented dev and bin start commands.
    - One inaccuracy, the table-renaming sentence, was fixed with the Tester's wording and accepted by the orchestrator.
  - **F19 (Tester):** `test/s7.test.ts` cleans up with `afterAll` + `rm`. The `/tmp` count is unchanged across studio and root runs, and no assertion was weakened.
  - **Final gates:** see "Completion check" at the top of this section. `pnpm check:all` exits 0 in 486 s.
  - **Browser end-to-end (Tester, faux model):**
    - run, tabs, auto-limit;
    - generate success and failure;
    - charts (15 checks);
    - save/load/overwrite/delete;
    - the palette with 85 items;
    - Switch model;
    - preventDefault for Ctrl+K/S/L/G/1/Enter;
    - editor intelligence in light and dark themes.
  - **Real-model smoke (orchestrator, `openai-codex/gpt-5.6-sol`, fixture):**
    - 3/3 queries generated (1 attempt in 4.4 s; 1 in 3.6 s; 2 in 12.0 s for a union labelled with `val()`), and all three ran;
    - 1/1 chart on the first attempt in 3.2 s, a valid spec;
    - save + list round-tripped with the chart;
    - `auth.json` unchanged.
  - **User decisions:** F21 deferred ("not now"); studio integration tests stay out of `check:all`.
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
