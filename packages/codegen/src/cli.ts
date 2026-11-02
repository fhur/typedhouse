#!/usr/bin/env node
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { introspect } from './introspect.js';
import { renderSchema, renderFunctions } from './render.js';
import { undeclaredColumns } from './check.js';

class UsageError extends Error {}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'generate' && command !== 'check') throw new UsageError('Usage: typedhouse generate|check --database DATABASE --out-dir DIR [--url URL] [--user USER] [--password PASSWORD] [--skip-alias]');
  const flags = new Map<string, string>();
  let skipAlias = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--skip-alias') { skipAlias = true; continue; }
    if (!['--url', '--database', '--out-dir', '--user', '--password'].includes(flag)) throw new UsageError('Unknown option');
    const value = args[++i];
    if (!value || value.startsWith('--') || flags.has(flag)) throw new UsageError('Missing value or repeated option');
    flags.set(flag, value);
  }
  const database = flags.get('--database'), out = flags.get('--out-dir');
  if (!database || !out) throw new UsageError('--database and --out-dir are required');
  const client = createClient({ url: flags.get('--url') ?? process.env.CLICKHOUSE_URL ?? 'http://localhost:8123', username: flags.get('--user') ?? process.env.CLICKHOUSE_USER ?? 'default', password: flags.get('--password') ?? process.env.CLICKHOUSE_PASSWORD ?? '', log: { level: ClickHouseLogLevel.OFF } });
  try {
    const schema = await introspect(client, database, { skipAlias });
    const files = [['schema.ts', renderSchema(schema)], ['functions.ts', renderFunctions(schema)]] as const;
    if (command === 'generate') {
      await mkdir(resolve(out), { recursive: true });
      for (const [name, content] of files) await writeFile(resolve(out, name), content);
    } else {
      const stale: string[] = [];
      for (const [name, content] of files) {
        let existing: string | undefined;
        try { existing = await readFile(resolve(out, name), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (existing !== content) stale.push(name);
        // Slice 4f: a live column the existing descriptor neither declares nor hides can capture an output alias.
        if (name === 'schema.ts' && existing !== undefined) for (const { table, columns } of undeclaredColumns(schema, existing)) {
          console.warn(`Warning: table ${JSON.stringify(table)} has server columns its descriptor does not declare: ${columns.map(c => JSON.stringify(c)).join(', ')}. ClickHouse resolves them by name, so an output alias with the same name can bind the column instead; regenerate, or list them in hiddenColumns.`);
        }
      }
      if (stale.length) throw new UsageError(`Stale generated files: ${stale.join(', ')}`);
    }
  } finally { await client.close(); }
}
// Driver errors may contain URLs or credentials. Never print their text.
main().catch(error => {
  console.error(error instanceof UsageError ? error.message : 'Code generation failed (connection, authentication, introspection or filesystem error).');
  process.exitCode = 1;
});
