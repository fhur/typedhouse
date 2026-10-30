import { beforeAll, afterAll, it, expect } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { introspect } from '../src/introspect.js';
import { renderSchema, renderFunctions } from '../src/render.js';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { CHType } from '@typedhouse/core';
const exec = promisify(execFile);
const root = resolve('.');
const snapshots = resolve('packages/codegen/test/snapshots');
let container: StartedTestContainer, client: ClickHouseClient, cwd: string, url: string;
async function cli(command: string, extra: string[] = [], env: NodeJS.ProcessEnv = {}) {
  try {
    const result = await exec(process.execPath, [join(root, 'packages/codegen/dist/cli.js'), command, '--database', 'fixture', '--out-dir', 'generated', ...extra], { cwd, env: { ...process.env, CLICKHOUSE_URL: url, CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', ...env }, timeout: 30000 });
    return { status: 0, output: result.stdout + result.stderr };
  } catch (error) { const e = error as { code: number; stdout: string; stderr: string }; return { status: e.code, output: e.stdout + e.stderr }; }
}
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'typedhouse-codegen-'));
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  client = createClient({ url, username: 'fixture', password: 'test-secret' });
  await client.command({ query: 'CREATE DATABASE fixture' });
  await client.close();
  client = createClient({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  const ddl = await readFile(join(root, 'packages/compiler/test/fixtures/schema.sql'), 'utf8');
  for (const statement of ddl.split(';').filter(s => s.trim())) await client.command({ query: statement });
  console.log('Codegen real server:', await (await client.query({ query: 'SELECT version() AS version', format: 'JSONEachRow' })).json());
}, 120000);
afterAll(async () => { await client?.close(); await container?.stop(); if (cwd) await rm(cwd, { recursive: true, force: true }); });
it('captures live metadata and compares explicit generated snapshots', async () => {
  const schema = await introspect(client, 'fixture');
  expect(schema.tables.find(t => t.name === 'coverage')!.columns.some(c => c.name === 'nested.label')).toBe(true);
  expect(schema.tables.find(t => t.name === 'coverage_view')!.engine).toBe('View');
  expect(schema.tables.find(t => t.name === 'coverage_mv')!.engine).toBe('MaterializedView');
  expect(schema.tables.find(t => t.name === 'coverage')!.sortingKey).toEqual(['id', 'cityHash64(`odd-name`, __proto__)']);
  expect(schema.functions.length).toBeGreaterThan(1000);
  expect(schema.functions.find(f => f.name === 'sum')!.isAggregate).toBe(true);
  for (const [name, content] of [['schema.ts', renderSchema(schema)], ['functions.ts', renderFunctions(schema)]]) {
    if (process.env.TYPEDHOUSE_UPDATE_CODEGEN_SNAPSHOTS === '1') { await mkdir(snapshots, { recursive: true }); await writeFile(join(snapshots, name!), content!); }
    expect(content).toBe(await readFile(join(snapshots, name!), 'utf8'));
  }
});
it('built CLI generates deterministically and checks both artifacts without writing', async () => {
  expect(await cli('generate')).toEqual({ status: 0, output: '' });
  for (const name of ['schema.ts', 'functions.ts']) expect(await readFile(join(cwd, 'generated', name), 'utf8')).toBe(await readFile(join(snapshots, name), 'utf8'));
  expect((await cli('check')).status).toBe(0);
  expect((await cli('generate')).status).toBe(0);
  for (const name of ['schema.ts', 'functions.ts']) {
    const path = join(cwd, 'generated', name);
    await writeFile(path, 'stale');
    expect((await cli('check')).status).not.toBe(0);
    expect(await readFile(path, 'utf8')).toBe('stale');
    await rm(path);
    expect((await cli('check')).status).not.toBe(0);
    await expect(readFile(path)).rejects.toThrow();
    expect((await cli('generate')).status).toBe(0);
  }
});
it('check never creates a missing output directory and failures leave both artifacts untouched', async () => {
  await rm(join(cwd, 'generated'), { recursive: true, force: true });
  expect((await cli('check')).status).toBe(1);
  await expect(readFile(join(cwd, 'generated/schema.ts'))).rejects.toThrow();
  expect((await cli('generate')).status).toBe(0);
  const before = await Promise.all(['schema.ts', 'functions.ts'].map(name => readFile(join(cwd, 'generated', name), 'utf8')));
  for (const args of [['--password', 'private-adversarial-secret'], ['--database', 'duplicate'], ['--url'], ['--not-real', 'private-adversarial-secret']]) {
    const result = await cli('generate', args);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain('private-adversarial-secret');
    expect(await Promise.all(['schema.ts', 'functions.ts'].map(name => readFile(join(cwd, 'generated', name), 'utf8')))).toEqual(before);
  }
});

it('binds hostile database names and generates an actually empty database', async () => {
  const database = "adversarial' OR 1=1 --";
  await client.command({ query: `CREATE DATABASE \`${database}\`` });
  try {
    const result = await exec(process.execPath, [join(root, 'packages/codegen/dist/cli.js'), 'generate', '--database', database, '--out-dir', 'empty'], { cwd, env: { ...process.env, CLICKHOUSE_URL: url, CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret' } });
    expect(result.stderr).toBe('');
    const schema = await introspect(client, database);
    expect(schema.tables).toEqual([]);
    expect(await readFile(join(cwd, 'empty/schema.ts'), 'utf8')).toBe(renderSchema(schema));
    expect(await readFile(join(cwd, 'empty/functions.ts'), 'utf8')).toBe(renderFunctions(schema));
  } finally { await client.command({ query: `DROP DATABASE \`${database}\`` }); }
});

it('preserves live numeric named-tuple field order in imported generated descriptors', async () => {
  await client.command({ query: "CREATE TABLE adversarial_numeric (v Tuple(`42` String, `0` UInt64, z UInt8)) ENGINE = Memory" });
  try {
    const schema = await introspect(client, 'fixture');
    const table = schema.tables.find(t => t.name === 'adversarial_numeric')!;
    const live = table.columns[0]!.type;
    expect(live.kind).toBe('Tuple');
    if (live.kind !== 'Tuple') throw new Error('Expected real named tuple');
    expect(live.items.map(item => item.name)).toEqual(['42', '0', 'z']);
    await client.command({ query: "INSERT INTO adversarial_numeric VALUES (('first', 7, 2))" });
    expect(await (await client.query({ query: 'SELECT tupleElement(v, 1) AS first, toTypeName(tupleElement(v, 1)) AS type FROM adversarial_numeric', format: 'JSONEachRow' })).json()).toEqual([{ first: 'first', type: 'String' }]);
    expect((await cli('generate')).status).toBe(0);
    const source = (await readFile(join(cwd, 'generated/schema.ts'), 'utf8')).replace("'@typedhouse/core'", JSON.stringify(pathToFileURL(join(root, 'packages/core/dist/index.js')).href));
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const generated = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as { db: { adversarial_numeric: { columns: { v: CHType } } } };
    expect(generated.db.adversarial_numeric.columns.v).toEqual(live);
  } finally { await client.command({ query: 'DROP TABLE adversarial_numeric' }); }
});

it('preserves nested positional tuple semantics through the built CLI and built core', async () => {
  await client.command({ query: 'CREATE TABLE adversarial_nested (v Array(Tuple(`42` Tuple(`7` String, `0` UInt64), `0` UInt8, __proto__ String))) ENGINE = Memory' });
  try {
    await client.command({ query: "INSERT INTO adversarial_nested VALUES ([(('inner-first', 9), 2, 'safe')])" });
    const rows = await (await client.query({ query: 'SELECT tupleElement(tupleElement(v[1], 1), 1) AS first, tupleElement(v[1], 3) AS last FROM adversarial_nested', format: 'JSONEachRow' })).json();
    expect(rows).toEqual([{ first: 'inner-first', last: 'safe' }]);
    const live = (await introspect(client, 'fixture')).tables.find(t => t.name === 'adversarial_nested')!.columns[0]!.type;
    expect((await cli('generate')).status).toBe(0);
    const source = (await readFile(join(cwd, 'generated/schema.ts'), 'utf8')).replace("'@typedhouse/core'", JSON.stringify(pathToFileURL(join(root, 'packages/core/dist/index.js')).href));
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const generated = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as { db: { adversarial_nested: { columns: { v: CHType } } } };
    expect(generated.db.adversarial_nested.columns.v).toEqual(live);
  } finally { await client.command({ query: 'DROP TABLE adversarial_nested' }); }
});

it('supports skip-alias and flag precedence over credentials/environment', async () => {
  expect((await cli('generate', ['--url', url, '--user', 'fixture', '--password', 'test-secret', '--skip-alias'], { CLICKHOUSE_URL: 'http://127.0.0.1:1', CLICKHOUSE_USER: 'wrong', CLICKHOUSE_PASSWORD: 'wrong' })).status).toBe(0);
  expect(await readFile(join(cwd, 'generated/schema.ts'), 'utf8')).not.toContain('alias_id:');
  expect((await cli('check', ['--skip-alias'])).status).toBe(0);
  expect((await cli('check')).status).not.toBe(0);
  const failure = await cli('check', ['--password', 'secret-never-print']);
  expect(failure.status).not.toBe(0); expect(failure.output).not.toContain('secret-never-print');
  expect((await cli('generate', ['--unknown'])).status).not.toBe(0);
  expect((await cli('generate', ['--password'])).status).not.toBe(0);
  expect((await cli('invalid')).status).not.toBe(0);
});
