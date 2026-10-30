# typedhouse documentation site specification

Status: Proposed

## 1. Goal

Build a modern, fast documentation site whose primary audience is LLMs and coding
agents using typedhouse to generate and modify application queries. Optimize documentation
for agents to discover the right API, understand its constraints, produce valid
code, and verify the resulting SQL.

Human developers are the secondary audience: they evaluate typedhouse, guide agents,
review generated code, and explore examples. The human-facing site's defining
interaction is editing typed typedhouse code and seeing generated ClickHouse SQL
alongside it. Agent-readable documentation is a core product surface, not an
optional export.

The site must be deployable on free static hosting without a database, paid search
service, or application server. Free-tier limits remain subject to the hosting
provider's terms.

This document specifies the documentation experience, not new typedhouse language
features. `spec.md` remains the language implementation contract. Published examples
must reflect implemented behavior, including limitations, rather than presenting
planned features as available.

## 2. Stack

| Concern | Choice |
| --- | --- |
| Site framework | Astro with static output |
| Documentation framework | Starlight |
| Content | Markdown and MDX |
| Blog | Astro content collections and custom layouts |
| Search | Pagefind, through Starlight's integration |
| Interactive UI | React islands |
| Editor | CodeMirror 6 |
| Editor languages | `@codemirror/lang-javascript` with TypeScript enabled; SQL language support where needed |
| Compilation | Browser-compatible typedhouse core/compiler adapter in a Web Worker |
| TypeScript transpilation | Lazy-loaded TypeScript transpiler in the execution environment |
| Hosting | Cloudflare Pages static hosting |
| Agent access | Generated Markdown endpoints, `llms.txt`, and optional `llms-full.txt` |

Use CodeMirror directly or a thin React wrapper such as
`@uiw/react-codemirror`. Do not include Monaco, an in-browser IDE framework, or a
TypeScript language server in the initial release.

Choose stable, compatible dependency versions at implementation time and pin them
through the workspace lockfile.

## 2.1. Positioning and messaging

### Core positioning

Lead with composition; support it with safer query construction, ClickHouse-native
semantics, and type safety. The primary documentation audience is LLMs and coding
agents working in TypeScript applications backed by ClickHouse. Human adopters are
TypeScript teams building analytical applications, especially teams maintaining
dynamic filters, dashboards, reports, and shared query logic.

When documentation design involves a trade-off, prioritize machine-discoverable,
explicit, verifiable API guidance over marketing brevity or visual presentation.
Preserve a polished human experience without making it the only way to understand
or use typedhouse.

**Homepage headline:**

> Type-safe and composable. SQL's missing features.

**Homepage subheading:**

> Build reusable ClickHouse queries in TypeScript—without stitching SQL strings
> together. Keep values parameterized, catch schema mismatches earlier, and inspect
> the SQL you ship.

**Overall story:**

> SQL is great at describing queries. Application code needs a safe way to compose
> them. typedhouse brings typed composition to ClickHouse—without hiding the SQL.

Describe the category as a **typed, composable query builder for ClickHouse**.
Reserve “typed ClickHouse query algebra” for deeper technical explanations. The
headline is intentionally provocative: technical content must acknowledge SQL's
CTEs and subqueries and explain that the gap is application-level composition of
reusable query logic, not a complete absence of composition in SQL.

### Four selling points

1. **Compose queries, not strings.** Build reusable query fragments and extend,
   combine, and adapt them without duplicating SQL or assembling strings. Demonstrate
   one base query reused for a dashboard, report, and drill-down.
2. **Safer queries—for humans and agents.** Separate query structure from values to
   reduce opportunities for SQL injection through concatenation. Demonstrate
   untrusted input becoming a bound parameter rather than SQL syntax. Position this
   as guardrails for developers and generated code, not a guarantee that agents
   cannot introduce errors. Parameterization does not enforce authorization or
   prevent incorrect query logic.
3. **Built for ClickHouse.** Make ClickHouse types, analytical operations, and native
   semantics central to the story, with implemented examples and explicit caveats.
   Prefer “Built for ClickHouse” over “Optimized for ClickHouse” until performance
   claims are supported by reproducible evidence.
4. **Catch schema drift before deployment.** Show regenerated schema descriptors
   causing affected application queries to fail typecheck after an incompatible
   column change. State the prerequisite: schema definitions must be refreshed and
   checked, ideally in CI. Stale generated types cannot detect live database drift,
   and type checking does not catch every semantic schema change.

### Homepage narrative and evidence

Present the pillars in this order:

1. An editable composition example demonstrating reuse, not merely another spelling
   of `SELECT`.
2. A parameterization example showing safe separation of input and SQL syntax.
3. ClickHouse-native capabilities supported by the current implementation.
4. A schema-change example showing descriptor regeneration and typecheck failures.

Use **Try the playground** as the primary CTA and **Build your first query** as the
secondary CTA. Each selling point must have concrete evidence rather than only a
feature card. Show the schema-drift demonstration as a CI/typecheck walkthrough or
verified static example; the lightweight playground does not provide full
TypeScript type checking.

Make agent-assisted development explicit in the product story. The agent-facing
promise is **Explicit APIs. Typed constraints. Inspectable SQL.** Supporting copy:

> Give coding agents documented query-building primitives, compiler validation,
> and generated SQL you can review.

Composition remains the core capability; agents are the primary documentation
consumers. Do not claim that LLMs inherently understand typedhouse better or automatically
produce correct queries without evaluation evidence.

### Messaging guardrails

- Do not position typedhouse as an ORM or promise to replace all handwritten SQL.
- Do not claim faster queries without benchmarks or complete ClickHouse coverage.
- Do not equate parameterization with general security or agent correctness.
- Do not imply automatic protection from schema drift without regeneration and
  typechecking.
- Tie published capabilities and maturity claims to tested implementation behavior.
- Make incremental adoption clear: users should be able to try one query without
  rewriting their application.

## 2.2. Tone, copy, and agent-first content contracts

### Voice

Use confident, concise positioning for human readers and precise, explicit contracts
for agents. Be opinionated on the homepage, exact in technical claims, and friendly
in tutorials. Precision takes precedence over personality in instructional content.

- Lead with the benefit, then explain the mechanism.
- Use short, concrete sentences and consistent API terminology.
- Respect SQL and the reader: fragile string assembly is the problem, not SQL itself.
- Follow strong claims with examples and inspectable output.
- State what a guarantee covers, when it applies, and what it does not cover.
- Avoid hype such as “revolutionary,” “seamless,” “bulletproof,” and unsupported
  “blazing-fast” claims.
- Keep wit out of errors, security guidance, and normative API rules.
- Use “you” for guidance, “typedhouse” for behavior, and “we” primarily in blog posts.
- Use “must,” “must not,” and “only” for actual constraints. Explain conditions rather
  than relying on ambiguous qualifiers such as “usually works.”

### Two layers, one source of truth

Human-facing headlines can be memorable:

> Compose queries. Stop stitching strings.

The explanation underneath must be concrete:

> Build queries using typedhouse expressions and relational operators. Pass input values
> through the parameter API rather than interpolating them into SQL strings.
> Compilation produces SQL and separate parameters.

Publish both layers from the same content source. Do not maintain a separate,
abridged agent manual that can drift from the human documentation. Essential rules
must remain available as text, without requiring screenshots, interactive widgets,
visual layout, or browser execution.

### Required reference structure

Each documented operation must provide:

1. When to use it, including relevant alternatives.
2. Its signature and accepted inputs.
3. A complete example with imports and table definitions, or an explicit link to a
   canonical fixture containing those definitions.
4. Expected SQL and parameters, where applicable.
5. Output shape and relevant type behavior.
6. Constraints, supported behavior, and unsupported cases.
7. Common errors, their causes, and valid corrections.
8. Applicable API/version context and links to related operations.

Prefer self-contained examples. Clearly distinguish runnable code, illustrative
pseudocode, and planned APIs. Examples must not silently depend on omitted setup.
Use stable URLs and descriptive headings so agents can retrieve a specific operation
without reading the entire site.

### Agent success criteria

Evaluate documentation by whether an agent can find the relevant API, construct a
valid query, recognize unsupported requests, and correct documented errors. Markdown
availability alone is not evidence of effective agent documentation.

Maintain representative documentation-driven tasks covering composition,
parameterization, ClickHouse-specific semantics, and schema regeneration/typechecking.
Validate resulting code and SQL with actual tooling. Record the documentation and
package versions, model, and task outcomes for repeatable evaluations; do not turn
unmeasured assumptions about agent performance into marketing claims.

## 3. Information architecture

- **Home:** concise value proposition, install command, editable example, and links
  to the quickstart and playground.
- **Getting started:** installation, table descriptors/code generation, first query,
  SQL compilation, and execution using the client outside the browser playground.
- **Tutorials:** progressive, task-oriented lessons with editable examples.
- **Concepts:** typed expressions, relational composition, parameters, result types,
  ClickHouse semantics, and compiler behavior.
- **Reference:** public APIs, supported operations, errors, and limitations.
- **Playground:** a dedicated full-size interactive environment.
- **Blog:** release notes, engineering articles, and practical query walkthroughs.

Suggested initial tutorials:

1. Build and compile a first query.
2. Filter, project, order, and limit results.
3. Group and aggregate data.
4. Join tables and understand nested results.
5. Use parameters and understand generated SQL.

Only publish a tutorial when its APIs and examples pass validation against the
bundled typedhouse version.

## 4. Visual and interaction design

Use Starlight for documentation navigation, accessibility foundations, typography,
and light/dark themes. Customize the homepage and playground rather than rebuilding
the entire documentation shell.

### Approved visual identity: minimalist futurism

The site must communicate modernity through typography, spacing, and polished
interactions, and trust through restraint, concrete evidence, and clear limitations.
The guiding principle is **a confident engineering product, not a flashy developer
startup**.

- **Homepage and blog:** editorial layouts, strong clean headings, generous spacing,
  narrow readable prose, and real examples rather than decorative illustrations.
- **Documentation:** quiet navigation, compact API signatures, clear hierarchy, and
  prominent constraints. Technical contracts remain complete in Markdown regardless
  of visual presentation.
- **Playground:** a full-viewport workbench with edge-to-edge source/output panes,
  a resizable desktop split, and syntax-highlighted TypeScript and SQL. No large
  hero, outer card, or footer on the dedicated playground route. Keep controls
  compact and parameters/usage notes collapsible; stack panes on mobile. Homepage
  embeds remain bounded components.
- **Palette:** black, white, and neutral grays. Use blue only for tiny accents such
  as the brand slash and keyboard focus indicators, not large fills, tinted panels,
  or navigation. Dark mode is black/neutral gray, not green-tinted. Both modes
  share semantic design tokens.
- **Syntax coloring is intentional:** preserve useful token colors in the editor,
  generated SQL, and code examples. The monochrome constraint applies to the
  surrounding interface, not code readability.
- **Typography:** clean, strong sans-serif headings, readable body text, and a
  deliberate monospace stack for code and technical labels. Do not declare fonts
  that are never loaded or require external font requests.
- **Surfaces:** minimal separators instead of nested bordered cards, sharp or nearly
  square corners, no decorative shadows, and no
  decorative gradients or glass effects. Use spacing and alignment for hierarchy.
- **Motion:** only to communicate interaction state; respect reduced-motion
  preferences. No decorative entrance animations or pulsing status indicators.
- **Visual motif:** reusable query fragments becoming inspectable SQL. Connected
  examples, aligned source/output, and small annotations should explain composition,
  not merely decorate the page.

Use a cohesive theme across custom pages, Starlight documentation, and the editor.
Offer system, light, and dark preferences without a light-theme flash when practical.
Keep keyboard focus, selectable code, error messages, and limitations visible.
Agent-first does not mean terminal-looking: humans use the interface to evaluate
typedhouse and inspect agent-generated work.

Requirements:

- Responsive navigation, breadcrumbs, and page table of contents.
- Clear distinctions between tutorials, conceptual explanations, and API reference.
- Light, dark, and system theme preferences, including matching editor themes.
- Keyboard-accessible controls, visible focus indicators, sufficient contrast, and
  reduced-motion support.
- Useful documentation and static example output before JavaScript loads.
- No editor or compiler assets loaded on pages without interactive examples.

## 5. Search

Use Pagefind's build-time index and client-side search. No external search account
or credentials are required.

Search must:

- Cover documentation, tutorials, reference pages, and published blog posts.
- Support keyboard navigation and a visible search control.
- Show meaningful titles and excerpts with links to relevant sections.
- Exclude navigation chrome, drafts, generated raw Markdown, and duplicate content.
- Include API names and code text where useful.

Verify custom blog layouts participate in indexing; do not assume Starlight's
integration automatically indexes every custom route correctly.

## 6. Tutorials and blog

### Content authoring

Use Markdown by default and MDX only when a page needs interactive components.
Define validated frontmatter schemas for titles, descriptions, navigation order,
and other section-specific metadata.

Tutorials should state prerequisites, learning objectives, expected output, and a
clear next step. Explain important ClickHouse semantics rather than just listing
method calls.

### Blog

Blog entries require a title, description, publication date, author, tags, and draft
flag. Support optional updated dates, chronological listing, tag pages, RSS, and
social metadata. Exclude drafts from production pages, search, feeds, and agent
exports.

## 7. Live preview and playground

### Shared component

Use one underlying editor/preview implementation for the homepage, tutorial
examples, and full playground. Smaller embeds may hide advanced controls.

Desktop layout:

```text
┌──────────────────────────────────────────────────────────┐
│ Example selector                 Reset · Share · Compile  │
├──────────────────────────────┬───────────────────────────┤
│ typedhouse / TypeScript            │ Generated ClickHouse SQL  │
│                              │                           │
├──────────────────────────────┴───────────────────────────┤
│ Diagnostics · Parameters · Output descriptors             │
└──────────────────────────────────────────────────────────┘
```

On narrow screens, use stacked panes or accessible tabs. SQL is output, not an
editable second source of truth. Label the action **Compile**, not **Run query**.

### Initial capabilities

- Editable TypeScript input with highlighting, indentation, undo/redo, and bracket
  matching.
- Lightweight completions for supported typedhouse APIs and example table names.
- Read-only, copyable generated SQL.
- Automatic compilation after a short debounce, with manual compilation available.
- Example selector with documented fixture tables.
- Editable table definitions in the full playground using the same supported input
  format as examples; a separate schema-builder UI is not required.
- Diagnostics for input syntax, evaluation failures, and compiler validation errors.
- Parameter output separate from SQL, preserving parameterization semantics.
- Output descriptors only where the current compiler exposes them accurately; do
  not present them as complete TypeScript inference.
- Reset to the selected example and local draft persistence.
- Shareable examples encoded in a versioned, compressed URL fragment.

CodeMirror highlighting and transpilation are not TypeScript type checking. The
initial UI must not imply full type-aware IntelliSense or comprehensive type-error
detection. Validate maintained examples with TypeScript in CI.

### Input contract

Define and document a small virtual-module contract before implementation:

- Source may import allowlisted typedhouse exports and bundled fixture definitions.
- Source must expose one query through a documented export, such as
  `export default query`.
- Reject unsupported imports, dynamic imports, and external module resolution with
  actionable messages.
- No package installation, filesystem access, network data loading, or client
  credentials are supported.

Implement this contract with syntax-aware tooling rather than regular-expression
rewrites. Keep the adapter separate from public typedhouse APIs.

### Compilation pipeline

1. Capture an input revision and debounce edits.
2. Send source and selected fixture metadata to the isolated execution environment.
3. Transpile TypeScript and resolve only allowlisted virtual modules.
4. Evaluate the resulting program to obtain a query.
5. Invoke the actual typedhouse compiler; do not duplicate SQL generation in the site.
6. Return a serializable result containing SQL, parameters, available descriptors,
   diagnostics, and the input revision.
7. Render only the newest revision's result.

Audit `@typedhouse/core` and `@typedhouse/compiler` for browser compatibility before integrating.
Keep Node-only code and client execution dependencies out of the browser bundle.
Format diagnostic and parameter values safely, including bigint and other values
that cannot be passed through ordinary JSON serialization unchanged.

### Isolation and resource controls

User-authored code is arbitrary code. A Web Worker provides responsiveness and
termination but is not, by itself, a security boundary.

- Execute code outside the documentation page's trusted origin, using a sandboxed
  iframe with an opaque origin or a separately hosted, unprivileged execution
  origin, with a worker inside that environment.
- Prototype and verify the chosen iframe/worker/CSP combination in supported
  browsers before committing to it.
- Restrict network access through execution-context policy, not just import checks.
- Never expose cookies, tokens, application storage, credentials, or privileged
  browser APIs from the documentation origin to evaluated code.
- Validate messages, identify the expected sending window/channel, and validate
  payload shape and size. An opaque origin's `null` origin alone is not identity.
- Terminate and recreate workers on timeout; limit input size and output size and
  ignore stale messages. Browser workers do not provide a portable hard memory cap.
- Render source, SQL, and errors as text, never injected HTML.
- Shared URL code requires an explicit Compile action before its first evaluation.
  Trusted built-in examples may compile automatically.

Local drafts and URL fragments are not secret storage. Explain that users must not
paste credentials or sensitive data. Fragment sharing avoids a server-side snippet
store but still exposes content to anyone who receives the link.

### Persistence and sharing

Version the shared-state format, validate decoded values, and bound encoded and
decoded sizes. Show recoverable errors for corrupt links and unsupported versions.
Warn when a snippet is too large to share instead of silently truncating it.

Handle unavailable browser storage gracefully. Reset and example switching must
not silently discard an edited draft.

### Out of scope for v1

- Connecting to ClickHouse or executing generated SQL.
- Hosting a public database or accepting database credentials.
- Arbitrary npm dependencies or multi-file projects.
- Full TypeScript language services.
- User accounts, cloud snippet storage, or collaborative editing.

## 8. Markdown mode for agents

Agent-readable documentation is the primary documentation interface and a required
build output generated from the same content source as the human-facing site.
It must preserve the full technical contracts, examples, limitations, and correction
guidance, rather than serving as a reduced marketing summary.

Required routes:

```text
/docs/<slug>/        HTML documentation
/docs/<slug>.md      equivalent clean Markdown
/blog/<slug>/        HTML blog post
/blog/<slug>.md      equivalent clean Markdown
/llms.txt            curated index of canonical Markdown URLs
/llms-full.txt       optional combined documentation export
```

Configure actual section routes consistently with this scheme. The `.md` suffix
must work on static hosting without content negotiation or a server runtime.

Markdown exports must:

- Preserve headings, prose, tables, code fences, warnings, and meaningful links.
- Include title, canonical page URL, and applicable version information.
- Replace interactive examples with source, fixture context, expected SQL, and a
  playground link.
- Convert known presentation components into readable Markdown; fail validation
  for unsupported MDX components rather than silently dropping their content.
- Exclude site chrome, scripts, JSX, drafts, and duplicate navigation.
- Resolve relative links correctly and favor Markdown destinations for internal
  documentation links.

Provide **View Markdown** and **Copy as Markdown** controls on content pages.
`llms.txt` is a discovery convention, not a guarantee that every agent will consume
it. If provided, `llms-full.txt` must be deterministic and identify each page.

## 9. Repository layout

Add the site to the existing pnpm workspace:

```text
apps/docs/
  astro.config.mjs
  package.json
  src/
    content/docs/
      getting-started/
      tutorials/
      concepts/
      reference/
    content/blog/
    components/playground/
    playground/
      examples/
      fixtures/
      protocol.ts
      worker.ts
    pages/
      playground.astro
      blog/
    styles/
  scripts/
    # Markdown exports and example verification, if not Astro integrations
```

The precise generated-route and isolation assets layout depends on the technical
spikes. Use workspace dependencies for typedhouse packages and avoid copying compiler
source into the documentation app.

## 10. Hosting and delivery

Deploy static build artifacts to Cloudflare Pages with a custom domain when
available. Support preview deployments for branches or pull requests.

- No runtime environment secrets required for ordinary site operation.
- Build workspace dependencies before the site where necessary.
- Generate search indexes, Markdown exports, sitemap, and RSS during the build.
- Configure security headers, cache policies, and execution sandbox assets.
- Ensure direct navigation to nested routes and `.md` URLs works.
- Keep output portable to other static hosts; provider-specific configuration must
  not leak into content or query compilation.

## 11. Performance and accessibility

- Lazy-load editor, transpiler, and compiler assets for interactive pages/embeds.
- Reuse loaded modules rather than bundling a compiler for every example.
- Avoid spawning workers for offscreen tutorial examples.
- Render a static source/SQL fallback while interactive assets load or fail.
- Track compressed bundle sizes for the static site and playground separately in
  CI; establish explicit budgets after the first prototype.
- Target good Core Web Vitals: LCP ≤ 2.5 seconds, INP ≤ 200 ms, CLS ≤ 0.1, measured
  under documented conditions and with field data when available.
- Target WCAG 2.2 AA; test editor escape/focus behavior, search, tabs, resizing, and
  error announcements with keyboard and assistive technology.

## 12. Validation and acceptance criteria

The initial release is ready when:

- [ ] Static production output deploys on the free hosting tier without a backend.
- [ ] Documentation, tutorials, reference, and blog routes are usable on mobile.
- [ ] Search returns relevant API, tutorial, and blog results.
- [ ] The homepage and at least three tutorials use the shared interactive component.
- [ ] The playground compiles real typedhouse into SQL, without contacting ClickHouse.
- [ ] Maintained examples typecheck and their generated SQL is regression-tested.
- [ ] Invalid input, infinite loops, rapid edits, and stale responses are handled.
- [ ] Sandbox tests verify trusted-origin storage is inaccessible and disallowed
      network requests are blocked.
- [ ] Share links round-trip and malformed/oversized links fail safely.
- [ ] Untrusted shared source is not automatically evaluated on first load.
- [ ] Markdown routes and `llms.txt` are generated and contain complete technical
      contracts, usable examples, limitations, and error-correction guidance.
- [ ] Representative agent tasks are evaluated against the published Markdown;
      resulting code and SQL are checked with tooling and outcomes recorded.
- [ ] Internal links, canonical URLs, search indexing, and raw Markdown routes are
      tested against the built site.
- [ ] Keyboard, responsive layout, theme, and loading/error states pass browser tests.
- [ ] Non-interactive documentation pages do not load playground dependencies.

Use the workspace's TypeScript and Vitest tooling for unit and example tests, and
Playwright for browser acceptance tests. Keep existing package checks intact and
add documented site build/test commands to workspace validation.

## 13. Delivery sequence

1. **Technical spikes:** verify browser compilation, define the example contract,
   validate secure execution isolation, and measure a minimal CodeMirror prototype.
2. **Foundation:** create the Astro/Starlight workspace app, theme, navigation,
   initial content, search, and static preview deployment.
3. **Interactive experience:** implement the shared editor, worker protocol,
   compilation output, errors, fixtures, persistence, and sharing.
4. **Content and agent outputs:** ship tutorials, reference, blog/RSS, Markdown
   exports, and agent indexes.
5. **Launch validation:** complete accessibility, security, performance, link, and
   production hosting checks.

If secure free-hosted code evaluation cannot be demonstrated in the first phase,
resolve that architecture before shipping an executable playground. Do not fall
back to evaluating user code in the documentation page's trusted context.
