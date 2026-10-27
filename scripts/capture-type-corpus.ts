import { GenericContainer, Wait } from 'testcontainers';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const image = 'clickhouse/clickhouse-server:24.8';
const directory = 'packages/compiler/test/fixtures/';
const fixture = directory + 'type-corpus.sql';
const ddl = await readFile(fixture, 'utf8');
const query = "SELECT database, table, name, type, position FROM system.columns WHERE database = 'type_corpus' ORDER BY database, table, position";
const container = await new GenericContainer(image).withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
try {
  const url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  async function sql(text: string): Promise<string> {
    const response = await fetch(url, { method: 'POST', body: text });
    const body = await response.text(); if (!response.ok) throw new Error(body); return body;
  }
  for (const statement of ddl.split(';').filter(s => s.trim())) await sql(statement);
  const records = JSON.parse(await sql(query + ' FORMAT JSON')).data as Array<{ type: string }>;
  const content = JSON.stringify(records, null, 2) + '\n';
  const version = (await sql('SELECT version()')).trim();
  const digest = execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'], { encoding: 'utf8' }).trim();
  const provenance = { source: 'Live system.columns from controlled DDL on throwaway testcontainers server (not production data)', image, repoDigests: JSON.parse(digest) as string[], serverVersion: version, capturedAt: new Date().toISOString(), query, fixture, fixtureSha256: createHash('sha256').update(ddl).digest('hex'), command: 'pnpm capture:type-corpus', sha256: createHash('sha256').update(content).digest('hex'), count: records.length, distinctTypes: new Set(records.map(r => r.type)).size, experimentalTypes: 'JSON, Dynamic and Variant are covered by unit/type tests, not enabled in this 24.8 capture. Nullable(Nothing) was rejected by 24.8 with Code 370 DATA_TYPE_CANNOT_BE_USED_IN_TABLES; Nothing is tested separately.' };
  if (process.argv.includes('--check')) {
    const expected = await readFile(directory + 'columns.json', 'utf8');
    const saved = JSON.parse(await readFile(directory + 'columns.provenance.json', 'utf8')) as typeof provenance;
    if (content !== expected || provenance.fixtureSha256 !== saved.fixtureSha256) throw new Error('Live type corpus differs from checked-in capture; inspect and recapture explicitly.');
    console.log(`Verified ${records.length} live system.columns records (${provenance.distinctTypes} distinct types), ClickHouse ${version}.`);
  } else {
    await writeFile(directory + 'columns.json', content);
    await writeFile(directory + 'columns.provenance.json', JSON.stringify(provenance, null, 2) + '\n');
    console.log(JSON.stringify(provenance, null, 2));
  }
} finally { await container.stop(); }
