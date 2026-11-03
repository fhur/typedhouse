# @typedhouse/studio

A local workspace for going from an idea to data. Describe what you want in English. Studio writes a
TypedHouse query, type-checks and compiles it, runs it against your ClickHouse, and shows the rows. From
there you can see the generated SQL, describe a chart, or save the query. It runs on your machine, in your
browser, for one user. The package is private: it is not published.

## Start

```sh
# From the repo root. Dev mode needs no prior build.
TYPEDHOUSE_URL=http://localhost:8123 TYPEDHOUSE_USER=default TYPEDHOUSE_PASSWORD= TYPEDHOUSE_DATABASE=default \
  pnpm --filter @typedhouse/studio dev            # prints http://127.0.0.1:5480

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
  `TYPEDHOUSE_STUDIO_MODEL`, or for the running session with ⌘K → "Switch model…" (not persisted).
- Without credentials, or with an unknown model, the header shows "LLM unavailable" with the reason as a
  tooltip. Everything else still works: write queries by hand and run them.
- A generated query is accepted only when it type-checks and compiles. The model gets the errors back
  and fixes them, for up to 6 turns. Generation history lives in `<data-dir>/pi.sqlite`.

## Using it

| Keys (⌘ on macOS, Ctrl elsewhere) | Action |
|---|---|
| ⌘↵ | Run the query |
| ⌘L | Focus the English prompt (Enter generates) |
| ⌘/ | Toggle the 100-row auto-limit |
| ⌘1 · ⌘2 · ⌘3 | Table · Chart · SQL |
| ⌘G | Describe a chart (Vega-Lite) |
| ⌘S | Save the query |
| ⌘K | Command palette: actions, tables, saved queries, "Ask: …", "Switch model…" |

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
- Saved queries (prompt, source and chart) live in `~/.typedhouse/studio/saved.json` (`<data-dir>/saved.json`).

## Limitations

- One local user. There is no auth: the server listens on 127.0.0.1 only.
- Query code runs in the server process with a timeout and a guard against async code and non-core
  imports. It is not a sandbox: only run code you trust.
- The ClickHouse connection is read-only (`readonly=2`): no writes or DDL.
- Type checks of aggregate queries (`sum`, `max`, … over columns) take about 300 ms, which is the cost of
  core's aggregate types. They run in a worker thread, so runs never wait on them.
- The integration tests run separately and need Docker:
  `pnpm --filter @typedhouse/studio test:integration`.
