import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { assertSmokeEnvironment, expectedDynamicPort, isolateSmoke } from './smoke-testcontainers-port-patch.mjs';

// Execute the installed package, not a copy of the patch's allocation logic.
const require = createRequire(import.meta.url);
const filename = require.resolve('testcontainers/build/generic-container/generic-container.js');
const localRequire = createRequire(filename);
const source = readFileSync(filename, 'utf8');
const { REAPER_IMAGE } = localRequire('../reaper/reaper');
assert.equal(require('testcontainers/package.json').version, '10.28.0');

const cases = [
  { name: 'Mac host Desktop', expected: '' },
  { name: 'Mac host Desktop IPv4', host: '127.0.0.1', expected: '' },
  { name: 'Mac host Desktop IPv6', host: '::1', expected: '' },
  { name: 'native Linux', platform: 'linux', os: 'Ubuntu', expected: '0' },
  { name: 'Linux Desktop', platform: 'linux', expected: '0' },
  { name: 'Windows unchanged', platform: 'win32', expected: '0' },
  { name: 'non-Desktop Mac runtime', os: 'Colima', expected: '0' },
  { name: 'missing runtime identity', os: undefined, expected: '0' },
  { name: 'remote Desktop', host: '192.0.2.1', expected: '0' },
  { name: 'container marker', inContainer: true, expected: '0' },
  { name: 'Linux container on Desktop', platform: 'linux', inContainer: true, expected: '0' },
];

test('smoke platform expectations match all allocation guard cases', () => {
  for (const scenario of cases) {
    assert.equal(expectedDynamicPort(scenario.platform ?? 'darwin', {
      operatingSystem: Object.hasOwn(scenario, 'os') ? scenario.os : 'Docker Desktop',
      host: scenario.host ?? 'localhost',
    }, scenario.inContainer ?? false), scenario.expected, scenario.name);
  }
});

test('smoke refuses override environments before modifying anything', () => {
  for (const key of ['TESTCONTAINERS_RYUK_DISABLED', 'TESTCONTAINERS_RYUK_PORT', 'RYUK_CONTAINER_IMAGE']) {
    for (const value of ['true', 'false', '']) assert.throws(() => assertSmokeEnvironment({ [key]: value }), /Unset/);
  }
});

test('repeated isolation preserves foreign/concurrent containers and restores methods and environment', async () => {
  const foreign = { Id: 'foreign', State: 'running', Labels: { 'org.testcontainers.ryuk': 'true' } };
  const app = { Id: 'app', State: 'running', Labels: {} };
  const stopped = { ...foreign, Id: 'stopped', State: 'exited' };
  const labelled = { ...foreign, Id: 'labelled', Labels: { ...foreign.Labels, TESTCONTAINERS_RYUK_TEST_LABEL: 'true' } };
  const rows = [foreign, app, stopped, labelled];
  const originalRows = structuredClone(rows);
  const calls = [];
  const client = { container: {
    list: async function (...args) { assert.equal(this, client.container); calls.push(args); return rows; },
    create: async function (options) { assert.equal(this, client.container); return { id: options.Image }; },
  } };
  const { list, create } = client.container;
  for (const previous of [undefined, 'false', 'true']) {
    const env = previous === undefined ? {} : { TESTCONTAINERS_RYUK_TEST_LABEL: previous };
    const isolation = isolateSmoke(client, env);
    try {
      assert.equal(env.TESTCONTAINERS_RYUK_TEST_LABEL, 'true');
      assert.deepEqual(await client.container.list(), [app, stopped, labelled]);
      const concurrent = { ...foreign, Id: 'concurrent' };
      rows.push(concurrent);
      assert.deepEqual(await client.container.list(), [app, stopped, labelled]);
      const filter = { all: true };
      assert.equal(await client.container.list(filter), rows);
      assert.deepEqual(calls.at(-1), [filter]);
      await client.container.create({ Image: 'clickhouse/clickhouse-server:24.8' });
      await client.container.create({ Image: REAPER_IMAGE });
      assert.equal(client.container.list, list, 'startup listing restored as soon as own Ryuk exists');
      assert.equal(await client.container.list(), rows);
      assert.deepEqual(isolation.owned.map(({ container }) => container.id), ['clickhouse/clickhouse-server:24.8', REAPER_IMAGE]);
      rows.pop();
    } finally { isolation.restore(); }
    assert.equal(client.container.list, list);
    assert.equal(client.container.create, create);
    assert.deepEqual(env, previous === undefined ? {} : { TESTCONTAINERS_RYUK_TEST_LABEL: previous });
    assert.deepEqual(rows, originalRows);
  }
  const isolation = isolateSmoke(client, {});
  isolation.restore(); // startup failure before any successful create
  assert.deepEqual(isolation.owned, []);
  assert.equal(client.container.list, list);
  assert.equal(client.container.create, create);
});

for (const scenario of cases) {
  for (const image of ['clickhouse/clickhouse-server:24.8', REAPER_IMAGE]) {
    test(`${scenario.name}: ${image}`, async () => {
      const stoppedAtCreate = new Error('captured create; no Docker operation');
      let captured;
      let reaperCalls = 0;
      const client = {
        info: { containerRuntime: {
          operatingSystem: Object.hasOwn(scenario, 'os') ? scenario.os : 'Docker Desktop',
          host: scenario.host ?? 'localhost',
        } },
        image: { pull: async () => {} },
        container: { create: async (options) => {
          captured = options;
          throw stoppedAtCreate;
        } },
      };
      const exports = {};
      vm.runInNewContext(source, {
        exports,
        process: { platform: scenario.platform ?? 'darwin', env: {} },
        require: (id) => {
          if (id === 'node:fs') return { existsSync: (path) => {
            assert.equal(path, '/.dockerenv');
            return scenario.inContainer ?? false;
          } };
          if (id === '../container-runtime') return {
            ...localRequire(id), getContainerRuntimeClient: async () => client,
          };
          if (id === '../reaper/reaper') return {
            REAPER_IMAGE,
            getReaper: async () => { reaperCalls++; return { sessionId: 'patch-unit' }; },
          };
          if (id === '../port-forwarder/port-forwarder') return {
            SSHD_IMAGE: 'unused', PortForwarderInstance: { isRunning: () => false },
          };
          return localRequire(id);
        },
      }, { filename });
      const container = new exports.GenericContainer(image)
        .withExposedPorts(8123, 8080, { container: 9000, host: 19000 }, { container: 9001, host: 0 })
        .withExposedPorts(9002, { container: 9002, host: 19002 })
        .withExposedPorts({ container: 9003, host: 19003 }, 9003);
      await assert.rejects(container.start(), (error) => error === stoppedAtCreate);
      assert.deepEqual(JSON.parse(JSON.stringify(captured.HostConfig.PortBindings)), {
        8123: [{ HostPort: scenario.expected }],
        8080: [{ HostPort: scenario.expected }],
        9000: [{ HostPort: '19000' }],
        9001: [{ HostPort: '0' }],
        9002: [{ HostPort: '19002' }],
        9003: [{ HostPort: scenario.expected }],
      });
      assert.equal(reaperCalls, image === REAPER_IMAGE ? 0 : 1);
    });
  }
}
