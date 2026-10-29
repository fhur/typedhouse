import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const budgetPath = resolve(root, process.argv.find(a => a.startsWith('--budget='))?.slice(9) ?? 'test/types/bench/budget.json');
const initialize = process.argv.includes('--initialize');
const policy = 'Three sequential fresh official CLI processes per version/input, no incremental state; maximum of three; initial ceilings = maximum * 1.5 (instantiations rounded up). Wall includes pnpm/CLI startup, excludes builds and version resolution. Warm OS caches, not cold machine.';
function parse(text) {
  const labels = { instantiations: ['Instantiations', ''], checkSeconds: ['Check time', 's'], totalSeconds: ['Total time', 's'], memoryKiB: ['Memory used', 'K'] };
  return Object.fromEntries(Object.entries(labels).map(([key, [label, unit]]) => {
    const match = text.match(new RegExp(`^${label}:\\s*([0-9.]+)${unit}\\s*$`, 'm'));
    assert.ok(match, `Missing metric ${label}`);
    const value = Number(match[1]);
    assert.ok(Number.isFinite(value) && value > 0, `Invalid metric ${label}`);
    return [key, value];
  }));
}
function compare(measured, budget) {
  assert.ok(budget, 'Unknown compiler/input baseline; explicit reviewed initialization required');
  for (const key of ['instantiations', 'wallSeconds']) {
    assert.ok(Number.isFinite(measured[key]) && measured[key] > 0, `Missing metric ${key}`);
    assert.ok(Number.isFinite(budget[key]) && budget[key] > 0, `Missing budget ${key}`);
    assert.ok(measured[key] <= budget[key], `${key} ${measured[key]} exceeds budget ${budget[key]}`);
  }
}
if (process.argv.includes('--self-test')) {
  const measured = { instantiations: 10, wallSeconds: 2 };
  compare(measured, measured);
  assert.throws(() => compare(measured, { instantiations: 1, wallSeconds: 1 }), /exceeds/);
  assert.throws(() => compare(measured, { instantiations: 10, wallSeconds: 1 }), /wallSeconds.*exceeds/);
  assert.throws(() => compare({}, measured), /Missing metric/);
  assert.throws(() => compare(measured, undefined), /Unknown/);
  assert.throws(() => parse('Instantiations: 42\n'), /Missing metric/);
  assert.deepEqual(parse('Instantiations: 10\nCheck time: 1s\nTotal time: 2s\nMemory used: 300K\n'), { instantiations: 10, checkSeconds: 1, totalSeconds: 2, memoryKiB: 300 });
  console.log('Performance enforcement controls passed: tiny ceilings, wall-only regression, missing metrics, unknown baseline.');
  if (!initialize) process.exit(0);
}
function invoke(args) {
  const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args.join(' ')} failed (not a baseline):\n${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  return result.stdout;
}
for (const generator of ['generate-type-stress.mjs', 'generate-type-bench.mjs']) {
  const result = spawnSync(process.execPath, [joinScript(generator)], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function joinScript(name) { return resolve(root, 'scripts', name); }
const inputs = [
  'scripts/generate-type-bench.mjs', 'scripts/generate-type-stress.mjs',
  ...['queries.ts', 'correspondence.ts', 'chain25.ts', 'join10.ts', 'manifest.json', 'tsconfig.json', 'tsconfig.source.json'].map(f => `test/types/bench/${f}`),
  'test/types/snapshots/corpus/rows.d.ts', 'packages/compiler/test/fixtures/corpus/low-stock.ts',
];
const hash = createHash('sha256');
for (const path of inputs) hash.update(path + '\0').update(readFileSync(resolve(root, path)));
const inputHash = hash.digest('hex');
let budget;
if (initialize) {
  assert.ok(!existsSync(budgetPath), 'Refusing to overwrite an existing budget. Raises require an explicit reviewed note; never silently rebaseline.');
  budget = { policy, inputHash, inputs, recordedAt: new Date().toISOString(), host: { cpu: cpus()[0]?.model, memoryBytes: totalmem(), platform: platform(), arch: arch(), release: release(), node: process.version }, baselines: {} };
} else {
  budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
  assert.equal(budget.policy, policy, 'Repeat policy changed');
  assert.equal(budget.inputHash, inputHash, 'Benchmark inputs changed: review corpus and budget provenance; no automatic rebaseline');
}
console.log(JSON.stringify({ policy, inputHash, host: { cpu: cpus()[0]?.model, node: process.version, platform: platform(), arch: arch() } }));
const selectors = initialize || process.argv.includes('--all') ? [undefined, '5.5.4', 'latest'] : [process.env.CHQL_TYPESCRIPT_VERSION];
const seen = new Set();
for (const selector of selectors) {
  const cli = selector ? ['--package', `typescript@${selector}`, 'dlx', 'tsc'] : ['exec', 'tsc'];
  const actualVersion = invoke([...cli, '--version']).trim().replace(/^Version /, '');
  assert.match(actualVersion, /^\d+\.\d+\.\d+$/);
  console.log(`Selector ${selector ?? 'default'} resolved official CLI ${actualVersion}`);
  if (seen.has(actualVersion)) continue;
  seen.add(actualVersion);
  for (const mode of ['built', 'source']) {
    const key = `${actualVersion}/${mode}`;
    if (!initialize) assert.ok(budget.baselines[key], `Unknown compiler/input baseline ${key}`);
    const config = `test/types/bench/tsconfig${mode === 'source' ? '.source' : ''}.json`;
    const args = [...cli, '-p', config, '--extendedDiagnostics', '--pretty', 'false', '--incremental', 'false'];
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const output = invoke(args);
      const wallSeconds = (performance.now() - start) / 1000;
      const metrics = { ...parse(output), wallSeconds };
      runs.push(metrics);
      console.log(JSON.stringify({ key, run: i + 1, ...metrics }));
    }
    const maxima = { instantiations: Math.max(...runs.map(r => r.instantiations)), wallSeconds: Math.max(...runs.map(r => r.wallSeconds)) };
    if (initialize) budget.baselines[key] = { instantiations: Math.ceil(maxima.instantiations * 1.5), wallSeconds: maxima.wallSeconds * 1.5, command: ['pnpm', ...args], runs };
    else compare(maxima, budget.baselines[key]);
  }
}
if (initialize) writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + '\n');
console.log(`${initialize ? 'Initialized measured' : 'Passed unchanged'} performance budget ${relative(root, budgetPath)}`);
