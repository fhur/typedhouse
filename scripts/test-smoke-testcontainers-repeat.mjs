import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { GenericContainer, Wait } from 'testcontainers';

// A normal consumer holds its real Ryuk connection open while two separate smoke
// processes run. No synthetic Ryuk, reuse/disabled override, or foreign cleanup.
const require = createRequire(import.meta.url);
const { getContainerRuntimeClient } = require('testcontainers/build/container-runtime');
const client = await getContainerRuntimeClient();
const consumer = await new GenericContainer('clickhouse/clickhouse-server:24.8')
  .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' })
  .withExposedPorts(8123)
  .withWaitStrategy(Wait.forHttp('/ping', 8123).forStatusCode(200)).start();
try {
  const foreign = (await client.container.list()).filter((c) =>
    c.State === 'running' && c.Labels['org.testcontainers.ryuk'] === 'true' &&
    c.Labels.TESTCONTAINERS_RYUK_TEST_LABEL !== 'true').map((c) => c.Id);
  assert.ok(foreign.length > 0, 'Normal consumer must have a legitimate discoverable Ryuk');
  console.log(JSON.stringify({ before: foreign, consumer: consumer.getId() }));
  for (let run = 1; run <= 2; run++) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/smoke-testcontainers-port-patch.mjs'], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Smoke ${run}: ${code}/${signal}`)));
    });
    const running = (await client.container.list()).filter((c) => c.State === 'running').map((c) => c.Id);
    for (const id of [...foreign, consumer.getId()]) assert.ok(running.includes(id), `Foreign container lost: ${id}`);
    console.log(JSON.stringify({ run, preserved: foreign, consumer: consumer.getId() }));
  }
} finally {
  await consumer.stop();
}
