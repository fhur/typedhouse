import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';

const require = createRequire(import.meta.url);
const { getContainerRuntimeClient } = require('testcontainers/build/container-runtime');
const { REAPER_IMAGE } = require('testcontainers/build/reaper/reaper');

export function expectedDynamicPort(platform, runtime, inContainer) {
  return platform === 'darwin' && runtime.operatingSystem === 'Docker Desktop' &&
    new Set(['localhost', '127.0.0.1', '::1']).has(runtime.host) && !inContainer ? '' : '0';
}

export function assertSmokeEnvironment(env) {
  for (const key of ['TESTCONTAINERS_RYUK_DISABLED', 'TESTCONTAINERS_RYUK_PORT', 'RYUK_CONTAINER_IMAGE']) {
    assert.equal(env[key], undefined, `Unset ${key} for this smoke`);
  }
}

// This executable owns a fresh process (and hence an empty getReaper singleton).
// A test label alone does NOT prevent discovery/reuse of an existing Ryuk.
// Hide only eligible Ryuks from no-argument discovery until our Ryuk is created;
// never change Docker state, non-Ryuk entries, or filtered list calls.
export function isolateSmoke(client, env = process.env) {
  assertSmokeEnvironment(env);
  const owned = [];
  const originalCreate = client.container.create;
  const originalList = client.container.list;
  const previousLabel = env.TESTCONTAINERS_RYUK_TEST_LABEL;
  env.TESTCONTAINERS_RYUK_TEST_LABEL = 'true';
  client.container.list = async function (...args) {
    const containers = await originalList.apply(this, args);
    return args.length ? containers : containers.filter((container) =>
      !(container.State === 'running' && container.Labels?.['org.testcontainers.ryuk'] === 'true' &&
        container.Labels.TESTCONTAINERS_RYUK_TEST_LABEL !== 'true'));
  };
  client.container.create = async function (options) {
    const container = await originalCreate.call(this, options);
    owned.push({ container, options });
    if (options.Image === REAPER_IMAGE) client.container.list = originalList;
    return container;
  };
  return { owned, restore() {
    client.container.create = originalCreate;
    client.container.list = originalList;
    if (previousLabel === undefined) delete env.TESTCONTAINERS_RYUK_TEST_LABEL;
    else env.TESTCONTAINERS_RYUK_TEST_LABEL = previousLabel;
  } };
}

export async function smoke() {
  assertSmokeEnvironment(process.env);
  const client = await getContainerRuntimeClient();
  const expected = expectedDynamicPort(process.platform, client.info.containerRuntime, existsSync('/.dockerenv'));
  const isolation = isolateSmoke(client);
  const { owned } = isolation;
  let started;
  try {
    started = await new GenericContainer('clickhouse/clickhouse-server:24.8')
      .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' })
      .withExposedPorts(8123)
      .withWaitStrategy(Wait.forHttp('/ping', 8123).forStatusCode(200))
      .start();
    assert.equal(owned.length, 2, 'Must create our own ClickHouse and Ryuk');
    assert.deepEqual(new Set(owned.map(({ options }) => options.Image)),
      new Set(['clickhouse/clickhouse-server:24.8', REAPER_IMAGE]));
    for (const { container, options } of owned) {
      const port = options.Image === REAPER_IMAGE ? 8080 : 8123;
      if (options.Image === REAPER_IMAGE) assert.equal(options.Labels.TESTCONTAINERS_RYUK_TEST_LABEL, 'true');
      assert.equal(options.HostConfig.PortBindings[port][0].HostPort, expected);
      const inspect = await client.container.inspect(container);
      assert.ok(Number(inspect.NetworkSettings.Ports[`${port}/tcp`][0].HostPort) > 0);
      console.log(JSON.stringify({ id: container.id, image: options.Image,
        requested: options.HostConfig.PortBindings, mapped: inspect.NetworkSettings.Ports }));
    }
    const host = started.getHost();
    const response = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${started.getMappedPort(8123)}/ping`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Ok.\n');
    console.log('ClickHouse /ping passed; real Ryuk startup and connection passed');
  } finally {
    isolation.restore();
    // Attempt every owned cleanup even if stop/removal fails; foreign IDs never enter this list.
    const errors = [];
    if (started) try { await started.stop(); } catch (error) { errors.push(error); }
    for (const { container } of [...owned].reverse()) {
      try {
        await container.remove({ force: true, v: true });
        console.log(`Removed owned ${container.id}`);
      } catch (error) {
        if (error.statusCode !== 404) errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Owned smoke cleanup failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await smoke();
