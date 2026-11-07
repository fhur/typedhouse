# @typedhouse/studio

A local workspace for going from an idea to data. Talk to it in English. Studio writes a TypedHouse query,
type-checks and compiles it, runs it against your ClickHouse, and shows the rows. Then keep talking to refine
it, ask for a chart, or edit the query yourself. It runs on your machine, in your browser, for one user. The
package is private: it is not published.

## Start

```sh
# From the repo root. Dev mode needs no prior build.
TYPEDHOUSE_URL=http://localhost:8123 TYPEDHOUSE_USER=default TYPEDHOUSE_PASSWORD= TYPEDHOUSE_DATABASE=default \
  pnpm studio                                  # prints http://127.0.0.1:5480

# The built bin: run `pnpm build` once, then
node packages/studio/dist/main.js --url http://localhost:8123 --database default   # bin name: typedhouse-studio
```

| Flag | Env | Default |
|---|---|---|
| `--url` | `TYPEDHOUSE_URL` | `http://localhost:8123` |
| `--user` / `--password` | `TYPEDHOUSE_USER` / `TYPEDHOUSE_PASSWORD` | `default` / empty |
| `--database` | `TYPEDHOUSE_DATABASE` | `default` |
| `--port` (0 picks one; binds 127.0.0.1 only) | `TYPEDHOUSE_STUDIO_PORT` | `5480` |
| `--model provider/id` | `TYPEDHOUSE_STUDIO_MODEL` | `openai-codex/gpt-5.6-sol` |
| `--pi-dir` | `TYPEDHOUSE_STUDIO_PI_DIR`, then `PI_CODING_AGENT_DIR` | `~/.pi/agent` |
| `--data-dir` | `TYPEDHOUSE_STUDIO_DATA_DIR` | `~/.typedhouse/studio` |

## The model

- Studio uses [pi](https://pi.dev)'s credentials in place: it reads `<pi-dir>/auth.json`, and never
  copies it. An OAuth token refresh writes back to that same file, under pi's own lock.
- The default model is `openai-codex/gpt-5.6-sol`. Override it at start with `--model` or
  `TYPEDHOUSE_STUDIO_MODEL`, or for the running session with ⌘K → "Switch model…" (not persisted). The next
  message uses it, in the same chat.
- Without credentials, or with an unknown model, the header shows "LLM unavailable" with the reason as a
  tooltip, the message box says why, and past chats aren't listed until you log in; they are still in the
  data dir. Everything else works: write queries by hand and run them.

## The chat

The left pane is the chat above the editor, with a divider between them that drags and moves with ↑/↓. The
results are on the right. There is no separate prompt box or chart prompt any more, and no ⌘G.

- **It's a conversation.** Each message goes with what the editor holds right now, including your hand edits
  and whether it's empty, so the model builds on what you see. When that source compiles, the message also
  lists its result columns with their ClickHouse types.
- **A reply that changes the query is a numbered version** (v1, v2, …), with a one-line summary, the changed
  lines, attempts and time. "in editor" marks the newest version that matches the editor, so a hand edit
  marks none. A reply replaces the editor in one undoable step.
- **Only checked source reaches the editor.** A query is accepted when it type-checks and compiles. The model
  gets the errors back and fixes them, for up to 16 rounds in a message. If it can't, or a run takes over 180 s,
  the thread shows an error turn and the editor stays as it was. "Load last attempt" puts a failed attempt in
  the editor by hand, without running it; one over 64,000 characters says it's too long to load.
- **A reply may be just text**, such as a question or an answer about the data. It's a normal turn: no version,
  and the editor and results stay.
- **Agent activity is compact.** A single live line starts with “Working…” and then shows the latest
  tool in plain language, such as “Searching docs…”. Later calls add a `+n tool calls` disclosure,
  counting earlier calls. Expand the line to inspect the chronological assistant/tool log, then expand
  individual tools for arguments and results. Details stay collapsed by default; errors, interruptions
  and display truncation remain explicit. Activity stays with its user message when you reopen a chat;
  edited-away branches stay hidden. Private model reasoning and system instructions are not shown.
- **Charts live in the chat.** "Bar chart of revenue" gives a version with a chart and moves to the Chart tab,
  leaving the query alone unless the chart needs it changed. A query reply moves to the Table tab.
- **Auto-run.** A reply that changes the query runs by itself. Studio can only run reads (`readonly=2`). A chart
  over rows already showing doesn't run again.
- **Restore** puts a version and its chart back in the editor, runs it and leaves a note in the thread. Your next
  message continues from there.
- **Edit and resend** drops the turns after that message, for the thread and for the model. Later turns hide while
  you edit, and the message stays dimmed. Esc in the box cancels. A reload or a switch of chat keeps an edit you
  typed something into, per chat, and puts back one you didn't. Retry resends a message as it was.
- **Stop** ends a generation within 5 seconds, even if the provider ignores it. The editor is unchanged, a "Stopped" note
  stays in the thread, and the chat stays usable. If the server is killed mid-generation, the turn gets an
  "Interrupted" note on the next start, and nothing resumes by itself.
- **One generation at a time, across all chats.** While another chat generates, a line by the box says so and
  offers the way there, its sidebar row has a dot, and your message waits in the box.
- **Past chats** are in the sidebar and ⌘K. Reopening one restores its thread, editor text and chart, and doesn't
  run anything, so results stay empty until you run. A new chat keeps the editor and results as they are. A chat's
  title is its first message; there is no rename or delete.

## Agent tools

The agent can explore before proposing changes:

| Tool | Purpose |
|---|---|
| `query_validate` | Type-check TypedHouse source and compile it to SQL. |
| `query_run` | Run a read-only query with mandatory resource and output limits. |
| `query_results_get` | Read another bounded page of a stored result, without rerunning the query. |
| `query_apply` | Validate and propose a query for the editor. |
| `chart_validate` | Validate a Vega-Lite chart against query result columns. |
| `chart_apply` | Validate and propose a chart, optionally with a query change. |
| `tables_list` | List or search tables in the connected database. |
| `table_describe` | Inspect table structure and metadata. |
| `columns_describe` | Inspect bounded samples and value statistics for selected columns. |
| `docs_search` | Search local TypedHouse documentation and API references. |
| `docs_read` | Read a bounded part of a documentation page. |

Validation and exploration do not change the editor. Only successful `query_apply` and `chart_apply`
produce version turns and end the agent's turn; an apply sent in one message with an exploration or
validation call is refused, and the model is told to send it again without them. Result snapshots expire and are conversation-scoped;
a restart or conversation fork may require rerunning a query. Truncated results and sampled column
statistics are explicitly identified rather than presented as complete database statistics.

## Keys

⌘ on macOS, Ctrl elsewhere. `?` shows all of this in the app, and the footer shows the keys for where focus is.

| Anywhere | |
|---|---|
| ⌘↵ | Run the query |
| ⌘L | Message box |
| ⌘⇧L | New chat |
| ⌘E | Editor |
| ⌘1 · ⌘2 · ⌘3 | Table · Chart · SQL |
| ⌘/ | Toggle the 100-row auto-limit |
| ⌘S | Save the query |
| ⌘K | Command palette: actions, chats, saved queries, tables, "Ask: …", "Switch model…" |
| `?` | All shortcuts, outside text fields. Esc or `?` closes |

| Message box | |
|---|---|
| ↵ | Send |
| ⇧↵ | New line |
| ↑ | To the last turn, when the box is empty or the caret is at the very start |
| Esc | See below |

| Thread, on a selected turn, which shows its own keys | |
|---|---|
| ↑ ↓ or `k` `j` | Move. Down past the last turn returns to the box |
| ↵ | On a version: restore and run. On a message: edit and resend. On a failed turn: load the last attempt |
| `e` | Edit the message and resend |
| `r` | Retry |
| `y` | Copy the query, or the text |
| Esc or `i` | Back to the box. Esc stops a generation first |

Tab from a selected turn reaches its activity. On an activity summary, ↵ and Space only open or close it, and the turn's keys do nothing.

During a generation only `y` is offered. During an edit `r` isn't, because it would discard your rewrite, and the
message being edited offers `↵` back to the box and `y`. Notes have no keys.

| Editor | |
|---|---|
| Esc | CodeMirror's first (completions, search, lint panel). Then stop a generation, else back to the box |
| Tab | Indents |
| Ctrl+M (⇧⌥M on Mac) | Toggles Tab between indenting and moving focus, CodeMirror's way out. The editor's header says when it's on |

**Esc in the message box, first match wins:**

1. This chat is generating: stop it. A generation in another chat doesn't count.
2. An edit is open: cancel it, which puts back what you had before. **A rewrite you typed is dropped, with no undo.**
3. The thread has turns: go to the last one.

Esc elsewhere doesn't cancel an edit: dialogs and the save field close first, and a thread or button stops a
generation or goes to the box. Holding a key acts once where a repeat makes no sense, and a held key never carries
over to wherever focus went.

Everything else can be reached with Tab: sidebar rows, deleting a saved query, both dividers (arrow keys move them;
⌘K also has "Resize panes" and "Resize chat and editor"), "Load last attempt" and "Open it to stop it". Tab stops at
the editor unless Ctrl+M is on.

## The editor

- The editor is `query.ts`. The introspected tables and every `@typedhouse/core` function are in scope
  with no imports. Finish with `export default <query>`, or define `const query = …`. A table whose name
  collides with a core function, a common JS global or the editor's own names gets a non-colliding
  binding (e.g. `from_table`, `col2`; the sidebar and completions show the exact name). `db.<name>`
  always works.
- The editor type-checks as you type: squiggles, a "Typechecks" / "N type errors" badge, autocomplete
  (tables, core functions, builder methods, and columns with their ClickHouse types), and hover types.
  Type errors don't block ⌘↵.
- Auto-limit is on by default: runs fetch at most 100 rows, the SQL tab shows the `LIMIT 100`, and the
  status line says when the result was cut off.

## What leaves your machine

**Sample rows.** Once a current result exists (the last successful run is of exactly the source being sent), up to 20
of its rows go to the model with **every** chat message, as JSON. They stay in `pi.sqlite` as part of the transcript.
Without a current result, no editor sample rows are sent. The agent can also request bounded query-result
pages and column statistics through its tools; these outputs go to the model and remain in the transcript.
Schema, query source, documentation excerpts and your messages go to the model too.

**Charts can't load or link to anything.** The server refuses specs with `url` or `href`, image marks, `usermeta`, raw
Vega, inlined data and `url(` literals, and feeds that back to the model. Chart rendering uses a loader that refuses
everything.

**The Content-Security-Policy is what stops a paint address built from a row at render time**, which no check of the spec
can see. In a browser with the policy removed, such a chart does send rows to another host. So the header in
`server/server.ts` has to stay, and the built files should only be served by Studio itself.

## The data dir

`<data-dir>`, by default `~/.typedhouse/studio`:

- **`pi.sqlite`** holds chats, their transcripts and sample rows. Edit and resend hides dropped branches from the model
  and the thread, but they **stay on disk**, because the store has no delete, so the file only grows. Conversations from
  earlier Studio versions stay in it, unlisted.
- **`saved.json`** holds saved queries: the last message (or the box text), the source and the chart. Loading one changes
  the editor and chart only, not the open chat, and doesn't run it.

Message drafts, the editor text per chat and edits in progress are **in the browser's `localStorage`**, not in the data
dir, so they don't follow you to another browser.

## Limitations

- One local user. There is no auth: the server listens on 127.0.0.1 only.
- **No lock across processes: don't run two Studios on one data dir.** The default port usually prevents it; different
  `--port`s don't.
- A damaged chat index is not repaired. Studio still starts, and if it can't open the store the header says
  "LLM unavailable" with the reason.
- Query code runs in the server process with a timeout and a guard against async code and non-core
  imports. It is not a sandbox: only run code you trust.
- The ClickHouse connection is read-only (`readonly=2`): no writes or DDL.
- Type checks of aggregate queries (`sum`, `max`, … over columns) take about 300 ms, which is the cost of
  core's aggregate types. They run in a worker thread, so runs never wait on them.
- Below about 1000 px the panes stack and the results are one scroll down.

## Tests

- `pnpm --filter @typedhouse/studio test:integration` needs Docker.
- `pnpm --filter @typedhouse/studio test:browser` needs Docker and Chromium (`playwright install chromium`), includes a
  build, and takes about 11 minutes.

Both run separately: neither is part of the root `pnpm test` or of `check:all`. Browser coverage is Chromium on Linux only.
