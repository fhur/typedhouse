# chql

Typed ClickHouse query algebra. Implementation contract: [spec.md](spec.md).
Progress and current tasks: [TODO.md](TODO.md).

## Development

Node.js 20+ and Corepack are required. Integration tests require Docker and
use `clickhouse/clickhouse-server:24.8`.

```sh
corepack enable
pnpm install
pnpm check:all
```

ESM-only pnpm workspace with strict TypeScript and exact optional properties.

- `packages/core`: dependency-free types, descriptors, expressions and relational IR
- `packages/codegen`: ClickHouse introspection and generation CLI
- `packages/compiler`: validation, rewrites and SQL emission
- `packages/client`: execution, streaming and decoding

Milestones 1–6 are v1 scope. Temporary-table materialization and the incremental
engine (milestones 7–8) are deferred by the specification.
