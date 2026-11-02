# testcontainers 12.2.1: Docker Desktop for Mac dynamic TCP ports

This is a pnpm-managed patch of the published JavaScript, not an ad-hoc
`node_modules` edit. The root dependency is pinned to **12.2.1**;
`pnpm-workspace.yaml` registers the patch and `pnpm-lock.yaml` records its hash.
`pnpm install --frozen-lockfile` installs the patched artifact without an upgrade.

## Evidence and scope

The optimizer startup failure on 2026-10-29 used `HostPort: "0"` for 8123.
Docker Desktop's host monitor recorded container `af027bce7ef69d93…` failing
`listen tcp 0.0.0.0:62874: bind: address already in use` twice. Testcontainers
resolves inspected ports **before** running HTTP readiness; increasing readiness
limits cannot fix that allocation failure. The historical inspect payload was
not retained, so the empty binding array remains inferred, not directly observed.

[Upstream PR #1602](https://github.com/testcontainers/testcontainers-node/pull/1602)
was open at review, head `764fda89f277db78e9ce6cae6678ff3176092b75`, and is
still open (same head, unmerged) when this patch was re-created for 12.2.1 on
2026-11-02. 12.2.1's `GenericContainer.withExposedPorts` still requests
`HostPort: "0"` for every dynamic port, so upstream has not fixed this.
Its full diff changes all host-side non-UDP allocations, using `/.dockerenv`
as its only environment guard. We deliberately do **not** adopt that broad scope.
The [Docker explanation](https://github.com/docker/for-mac/issues/5588#issuecomment-934600089)
is that an empty binding asks Desktop to select a host-available port rather
than forwarding a port selected in the Linux VM.

Our patch acts after runtime discovery, before creation (including Ryuk):

- Node must run on **darwin**, runtime `OperatingSystem` must equal
  **Docker Desktop**, resolved host must be localhost/127.0.0.1/::1, and
  `/.dockerenv` must be absent.
- Only numeric dynamic port declarations whose current binding is `"0"` become
  `""`. 12.x also accepts `"N"`/`"N/tcp"`/`"N/udp"` strings and
  `{ container, host?, protocol? }` objects and keys bindings as `"N/proto"`;
  numeric declarations mean TCP, and string/object declarations are untouched.
  The last declaration for each `"N/proto"` binding decides.
- Explicit bindings, including explicit `host: 0`, retain their exact behavior.
  Repeated declarations still use the last binding.
- Linux (including Linux Desktop and container execution), Windows, other
  runtimes, and non-loopback resolved hosts are unchanged. No UDP path changes.
- Ryuk remains enabled and uses its normal image, wait strategy, session labels,
  socket connection and cleanup. No port probing, startup retries, polling,
  timeout changes or assertion weakening were added.

This is intentionally a Mac-specific workaround, not universal platform
support. Runtime identity/host overrides or future Desktop identity changes can
leave the workaround inactive. It does not cure other startup failures or host
sleep. The published source map is unchanged; the executable JS is patched.
Reassess/remove the patch when upgrading testcontainers after reviewing the
upstream fix; do not silently move this patch to another version.

History: first written against 10.28.0. Re-created (same guards and placement,
before image pull, Ryuk and reuse) for 12.2.1 when upgrading to clear dev-only
`undici`/`@fastify/busboy`/`uuid` advisories. 12.x differences handled: bindings
are keyed `"N/tcp"`, `node:fs` was already imported, and the Ryuk image is read
lazily via `getReaperImage()` (was `REAPER_IMAGE`).

## Focused verification (not full matrix acceptance)

```sh
pnpm install --frozen-lockfile
node --test scripts/test-testcontainers-port-patch.mjs
# Mandatory in check:all on all hosts; starts fresh CH + Ryuk:
node scripts/smoke-testcontainers-port-patch.mjs
# Two consecutive subprocess smokes while a normal consumer holds its Ryuk:
node scripts/test-smoke-testcontainers-repeat.mjs
```

The 22 unit cases execute the **installed** GenericContainer implementation with
mocked runtime discovery and capture its actual create options. They cover Mac
Desktop loopback forms, Linux, Windows, non-Desktop/missing identity, remote
hosts, container markers, explicit bindings, overwrite order and 12.x
string/UDP declarations (never rewritten), for both ClickHouse and Ryuk images. They do not contact Docker.

The smoke runs in a fresh process. Until its own Ryuk is created, a process-local
list wrapper excludes only running, unlabelled-for-test Ryuks from no-argument
discovery, including concurrently arriving foreign Ryuks. Other containers and
explicit list arguments are untouched. A temporary Ryuk test label prevents
other consumers from discovering this smoke's Ryuk; the label alone would not
prevent this smoke from reusing theirs. Original methods and environment are
restored in finally; normal startup listing is restored immediately after Ryuk
creation. Only IDs from successful local create calls are removed.

Both official images must be newly created. Actual requested HostPort must be
empty on local Mac Desktop outside a container, and `0` everywhere else; positive
inspected bindings, real Ryuk connection and ClickHouse `/ping` remain required.
Three additional unit regressions cover portability, override guards and repeated
isolation with concurrent foreign entries. The real repeat regression prints
foreign IDs before and after both smokes and asserts their survival. No full
matrices are implied or automatically run by these standalone commands.
