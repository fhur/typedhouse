# chql docs

Static Astro 5 + Starlight app. This is a modest foundation / vertical slice, **not completion of docs.spec.md**. Plain Markdown is the source of truth for HTML, agent exports, search and blog content.

## Develop and validate

Run from the repository root after the workspace install:

```sh
pnpm --filter @chql/docs dev
pnpm --filter @chql/docs check
pnpm --filter @chql/docs build
pnpm --filter @chql/docs preview
pnpm --filter @chql/docs test:playground
pnpm --filter @chql/docs exec playwright install chromium
pnpm --filter @chql/docs test:browser
# All docs checks, including built-site link validation:
pnpm docs:verify
```

Dev and build regenerate the sandbox worker first. Its bundler aliases workspace packages to source; no separate dependency build is required. Generated worker, `.astro`, `dist`, reports, and node_modules are ignored.

## Authoring and canonical routes

- `src/content/docs/docs/getting-started.md` → `/docs/getting-started/` and `/docs/getting-started.md`.
- Other docs live beneath that `docs/` content directory. Starlight's collection IDs deliberately include the `docs/` prefix.
- `src/content/blog/<slug>.md` → `/blog/<slug>/` and `/blog/<slug>.md`.
- Blog frontmatter requires title, description, date, author, tags, and supports updated/draft. Draft posts are excluded from pages, feeds, tag pages and exports.
- Use root-relative internal links ending in `/`. Agent export rewrites documentation and blog links to absolute `.md` destinations; static hosting serves real generated files, not content negotiation.
- `/llms.txt` indexes all published pages; `/llms-full.txt` deterministically combines them. Both preserve full technical content. Unsupported MDX import/export or component syntax fails export: keep source plain Markdown rather than relying on component serialization.
- Blog pages explicitly mark `data-pagefind-body` and a title; Starlight runs Pagefind at build time. Search lives in the documentation header. Raw Markdown and duplicate list pages are not indexed.
- The custom homepage and playground use the same React island. Documentation pages do not import editor assets. Documentation and custom pages share black/white/neutral-gray design tokens, tiny blue accents, and a persisted system/light/dark preference. Code keeps syntax coloring. The dedicated playground fills the viewport without a hero, outer card, or footer; it provides a keyboard- and pointer-resizable desktop split, stacked mobile panes, and collapsible parameters/help.

## TypeScript example formatting

All TypeScript fences in `src/content/**/*.md` use a 60-column formatting target. This does not reformat SQL, JSON, prose, or shell examples. Prose comments are wrapped too; indivisible literals and tooling directives remain intact.

- `pnpm --filter @chql/docs format:examples` formats the TypeScript examples.
- `pnpm --filter @chql/docs test:example-format` checks formatter behavior and prevents formatting drift; it is included in `pnpm docs:verify`.

## Function examples

The Functions section lives in `src/content/docs/docs/functions/`, with one page per supported scalar or aggregate call form and an expression-helper guide. Code examples use the same execution and typechecking harness as the query builder and compiler pages.

- `pnpm --filter @chql/docs examples:functions` refreshes final SQL and parameters and typechecks examples.
- `pnpm --filter @chql/docs test:function-examples` checks for stale SQL and typechecks examples.

`pnpm docs:verify` includes guide, compiler, query-builder, and function example checks. Each generated-SQL marker closes an independent executable example: its preceding TypeScript blocks (including collapsed setup) are compiled together. Pages can include multiple examples, each with its own imports, default export, and SQL marker.

## Query Builder examples

The top-level Query Builder section lives in `src/content/docs/docs/query-builder/`, with one concept per page and standalone examples followed by generated final SQL and parameters. It uses the same Markdown-based execution and typechecking harness as the compiler pages.

- `pnpm --filter @chql/docs examples:query-builder` refreshes SQL and typechecks the examples.
- `pnpm --filter @chql/docs test:query-builder-examples` checks for stale SQL and typechecks the examples.

## Compiler examples

The top-level Simplifying Compiler section lives in `src/content/docs/docs/compiler/`. Each optimization page contains one standalone TypeScript example exporting `compile(query.ir)`, followed by generated final SQL and parameters. Markdown remains the source of truth; edit the example, not its generated SQL block.

- `pnpm --filter @chql/docs examples:compiler` executes the examples against workspace source, refreshes their SQL blocks, and typechecks the snippets.
- `pnpm --filter @chql/docs test:compiler-examples` verifies the committed output still matches the compiler and typechecks the snippets.

SQL is formatted with the ClickHouse dialect; aliases and parameter values come from the compiler, not handwritten approximations.

## Guides

The sidebar teaches three progressively richer workflows: Getting started, Simple example, and Advanced example. Existing getting-started and composition URLs remain stable. Each runnable checkpoint has independent setup and generated SQL.

- `pnpm --filter @chql/docs examples:guides` regenerates all five checkpoints and typechecks their code.
- `pnpm --filter @chql/docs test:guide-examples` rejects stale SQL or type errors; Pages deployment runs this check too.
- A `ts typecheck-only` fence extends the page's first complete example for typechecking without executing it. This lets the server-client example stay checked without making database calls during builds.

## GitHub Pages

The public repository `fhur/chql` can host this static site for free at `https://fhur.github.io/chql/`. In repository **Settings → Pages**, select **GitHub Actions** as the source. `.github/workflows/docs.yml` builds and deploys on pushes to `master` or a manual workflow run. It derives the origin and base path from GitHub Pages configuration, including custom domains.

To validate the project-site build locally:

```sh
SITE_URL=https://fhur.github.io BASE_PATH=/chql pnpm docs:build
BASE_PATH=/chql pnpm --filter @chql/docs test:site
```

`BASE_PATH` defaults to `/` for local development and root-domain hosts. Navigation, Markdown links, agent indexes, RSS, search, and playground worker URLs honor it. GitHub Pages does not process `public/_headers`; its security headers, cache rules, and Markdown MIME overrides apply only on compatible hosts.

## Cloudflare Pages

Set root to the repository root, install with the workspace lockfile, and use `pnpm --filter @chql/docs build`. Output directory: `apps/docs/dist`. Set `SITE_URL` to the deployment's canonical HTTPS origin (default `https://chql.pages.dev` is a replaceable deployment placeholder). Starlight's sitemap, Pagefind search, RSS, Markdown and agent indexes are generated during the static build. No database or runtime secrets are needed. Branch previews can set their own SITE_URL.

`public/_headers` sets conservative security headers and immutable caching only for hashed Astro assets. It intentionally does **not** set a global CSP: the opaque-origin srcdoc playground has a separate restrictive policy and inline bootstrap. Do not add a blanket CSP that breaks this isolation. Sandbox assets are not assumed to have content-hashed names: `/sandbox/worker.js` explicitly uses `Cache-Control: no-cache` to revalidate the compiler after deployments.

For another static host, serve `dist` as files and translate `_headers` to that host's configuration. Verify direct nested routes and `.md` URLs (no SPA fallback), Markdown MIME types, canonical URLs and RSS on the actual host.

## Scope and release follow-ups

This slice includes getting started, one composition tutorial, bounded API references, a blog article/RSS/tags, full Markdown export and agent discovery. It does not claim the spec's three interactive tutorials, complete API coverage, full agent evaluations, bundle budgets, production hosting verification, comprehensive WCAG audits, or measured Core Web Vitals. The browser playground transpiles TypeScript; it is not a language server or full typechecker. Generated SQL is formatted inside the isolated worker with `sql-formatter`'s ClickHouse dialect; both display and Copy use that formatted text. Parameters and compiler emission are unchanged. If the formatter cannot handle an output, the playground shows the original SQL instead.

Prototype bundle measurements: the worker is approximately 3.6 MB raw / 1.04 MB gzip, largely from the TypeScript transpiler; editor plus React are approximately 244 KB gzip combined. These assets load lazily on interactive pages, but their size remains a performance limitation, not an accepted release budget. Reducing or replacing the transpiler is follow-up work; measure transfer and interaction cost on real devices.

`test:playground` typechecks maintained playground examples against actual core source as well as validating them at runtime. The maintained browser suite checks denied network/storage access, loop timeout, and explicit compilation of shared code. Browser workers still cannot enforce a portable hard memory cap. Review security and accessibility in each supported browser before public launch. Never paste credentials or sensitive data into drafts or shared fragments.
