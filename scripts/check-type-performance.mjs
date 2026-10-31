import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { cpus, totalmem, platform, arch, release, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const budgetPath = resolve(root, process.argv.find(a => a.startsWith('--budget='))?.slice(9) ?? 'test/types/bench/budget.json');
const initialize = process.argv.includes('--initialize');
const record = process.argv.includes('--record-host-budget');
assert.ok(!(initialize && record), '--initialize and --record-host-budget are exclusive');
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
// Host class: the values budget.json.host already records. On GitHub Actions the runner image joins the
// class so every runner of one image/CPU model shares a budget file; the slug follows the brief's examples
// (`apple-m3-max-darwin-arm64`, `github-amd-epyc-7763-64-core-processor-linux-x64`) and omits the image.
function hostClass(env = process.env, machine = { cpu: cpus()[0]?.model ?? 'unknown-cpu', platform: platform(), arch: arch() }) {
  const cls = { cpu: String(machine.cpu).trim(), platform: machine.platform, arch: machine.arch };
  if (env.GITHUB_ACTIONS === 'true') cls.runner = env.ImageOS ?? env.RUNNER_OS ?? 'unknown-runner';
  return cls;
}
function slugOf(cls) {
  return [cls.runner !== undefined ? 'github' : '', cls.cpu, cls.platform, cls.arch].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sameHost(host, cls) {
  return Boolean(host) && String(host.cpu ?? '').trim() === cls.cpu && host.platform === cls.platform && host.arch === cls.arch && (host.runner ?? null) === (cls.runner ?? null);
}
// Wall-budget lookup: (1) budget.<slug>.json next to budget.json; (2) budget.json when its host is this class
// exactly; (3) nothing, wall becomes advisory. Instantiation ceilings never come from here.
function wallSource(budget, cls, hostBudgetPath, expectedHash) {
  const name = relative(root, hostBudgetPath);
  if (existsSync(hostBudgetPath)) {
    const hostBudget = JSON.parse(readFileSync(hostBudgetPath, 'utf8'));
    assert.equal(hostBudget.policy, policy, `Repeat policy changed in ${name}`);
    assert.equal(hostBudget.inputHash, expectedHash, `Benchmark inputs changed since ${name} was recorded: re-record it (type-budget.yml / --record-host-budget) or delete it in review; no automatic rebaseline`);
    assert.ok(hostBudget.baselines && typeof hostBudget.baselines === 'object', `Missing baselines in ${name}`);
    // Same slug, different runner image (the slug omits the image): say so, no exit-code effect.
    const recorded = hostBudget.hostClass ?? hostBudget.host ?? {};
    const recordedRunner = recorded.runner ?? null;
    const note = recordedRunner !== (cls.runner ?? null) && recorded.cpu === cls.cpu && recorded.platform === cls.platform && recorded.arch === cls.arch
      ? `INFO runner image differs from the recorded host-class budget ${name}: running on ${cls.runner ?? 'none'}, recorded on ${recordedRunner ?? 'none'} (same cpu/platform/arch; wall ceilings still enforced from that file)`
      : null;
    return { enforced: true, source: name, baselines: hostBudget.baselines, note };
  }
  if (sameHost(budget.host, cls)) return { enforced: true, source: relative(root, budgetPath), baselines: budget.baselines ?? {} };
  return { enforced: false, source: null, baselines: {} };
}
// `ceilings` is budget.json's baseline for the key (instantiations are hard on every host); `wall` carries the
// host-class wall ceiling when one exists. Returns the advisory line (caller prints it) or null when enforced.
function compare(measured, ceilings, wall) {
  assert.ok(ceilings, 'Unknown compiler/input baseline; explicit reviewed initialization required');
  for (const key of ['instantiations', 'wallSeconds']) assert.ok(Number.isFinite(measured[key]) && measured[key] > 0, `Missing metric ${key}`);
  assert.ok(Number.isFinite(ceilings.instantiations) && ceilings.instantiations > 0, 'Missing budget instantiations');
  assert.ok(measured.instantiations <= ceilings.instantiations, `instantiations ${measured.instantiations} exceeds budget ${ceilings.instantiations}`);
  assert.ok(Number.isFinite(ceilings.wallSeconds) && ceilings.wallSeconds > 0, 'Missing budget wallSeconds in test/types/bench/budget.json');
  const entry = wall.enforced ? wall.baselines[wall.key] : undefined;
  if (entry !== undefined) {
    assert.ok(Number.isFinite(entry.wallSeconds) && entry.wallSeconds > 0, `Missing budget wallSeconds in ${wall.source}`);
    assert.ok(measured.wallSeconds <= entry.wallSeconds, `wallSeconds ${measured.wallSeconds} exceeds budget ${entry.wallSeconds} (${wall.source})`);
    return null;
  }
  const why = wall.enforced ? `no wall budget for ${wall.key} in ${wall.source}, host class ${wall.slug}` : `no wall budget for host class ${wall.slug}`;
  return `ADVISORY wall ${wall.key} ${measured.wallSeconds.toFixed(2)}s (${why}; ${wall.reference} ceiling ${ceilings.wallSeconds.toFixed(2)}s) — not enforced`;
}
function invoke(args) {
  const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args.join(' ')} failed (not a baseline):\n${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  return result.stdout;
}
if (process.argv.includes('--self-test')) {
  const measured = { instantiations: 10, wallSeconds: 2 };
  const m3 = { cpu: 'Apple M3 Max', platform: 'darwin', arch: 'arm64' };
  const gh = hostClass({ GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24', RUNNER_OS: 'Linux' }, { cpu: 'AMD EPYC 7763 64-Core Processor', platform: 'linux', arch: 'x64' });
  const local = hostClass({}, { cpu: ' AMD Ryzen 7 255 w/ Radeon 780M Graphics ', platform: 'linux', arch: 'x64' });
  // Slug pins and class shape.
  assert.deepEqual(hostClass({}, m3), m3);
  assert.equal(slugOf(hostClass({}, m3)), 'apple-m3-max-darwin-arm64');
  assert.deepEqual(gh, { cpu: 'AMD EPYC 7763 64-Core Processor', platform: 'linux', arch: 'x64', runner: 'ubuntu24' });
  assert.equal(slugOf(gh), 'github-amd-epyc-7763-64-core-processor-linux-x64');
  assert.equal(hostClass({ GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' }, m3).runner, 'Linux');
  assert.equal(slugOf(local), 'amd-ryzen-7-255-w-radeon-780m-graphics-linux-x64');
  assert.ok(sameHost({ ...m3, memoryBytes: 1, node: 'v1' }, hostClass({}, m3)) && !sameHost(m3, gh) && !sameHost(m3, local) && !sameHost(undefined, m3));
  const budget = { host: m3, baselines: { 'x/built': { instantiations: 10, wallSeconds: 2 } } };
  const key = 'x/built';
  const tight = { instantiations: 10, wallSeconds: 1 };
  const unknown = { ...wallSource(budget, local, resolve(root, 'test/types/bench/budget.no-such-host.json'), 'h'), key, slug: slugOf(local), reference: m3.cpu };
  const known = { ...wallSource(budget, hostClass({}, m3), resolve(root, 'test/types/bench/budget.no-such-host.json'), 'h'), key, slug: 'apple-m3-max-darwin-arm64', reference: m3.cpu };
  assert.equal(unknown.enforced, false);
  assert.equal(known.enforced, true);
  assert.equal(known.source, 'test/types/bench/budget.json');
  // Known host: both hard (tiny ceilings, wall-only regression, missing metrics, unknown baseline).
  assert.equal(compare(measured, measured, known), null);
  assert.throws(() => compare(measured, { instantiations: 1, wallSeconds: 1 }, known), /instantiations 10 exceeds/);
  assert.throws(() => compare(measured, tight, { ...known, baselines: { [key]: tight } }), /wallSeconds 2 exceeds budget 1 \(test\/types\/bench\/budget\.json\)/);
  assert.throws(() => compare({}, measured, known), /Missing metric instantiations/);
  assert.throws(() => compare(measured, undefined, known), /Unknown/);
  assert.throws(() => compare(measured, measured, { ...known, baselines: { [key]: { instantiations: 10 } } }), /Missing budget wallSeconds in test\/types\/bench\/budget\.json/);
  // Unknown host: wall over ceiling is advisory with the labelled line; instantiations stay hard; metric
  // and baseline failures stay fatal on the advisory path.
  const advisory = compare(measured, tight, unknown);
  assert.equal(advisory, `ADVISORY wall x/built 2.00s (no wall budget for host class ${slugOf(local)}; Apple M3 Max ceiling 1.00s) — not enforced`);
  assert.throws(() => compare(measured, { instantiations: 9, wallSeconds: 9 }, unknown), /instantiations 10 exceeds budget 9/);
  assert.throws(() => compare({ wallSeconds: 2 }, measured, unknown), /Missing metric instantiations/);
  assert.throws(() => compare({ instantiations: 10 }, measured, unknown), /Missing metric wallSeconds/);
  assert.throws(() => compare(measured, undefined, unknown), /Unknown/);
  assert.throws(() => compare(measured, { wallSeconds: 1 }, unknown), /Missing budget instantiations/);
  // A budget.json baseline without wallSeconds is fatal on every path, never a NaN advisory ceiling.
  for (const wall of [unknown, known]) assert.throws(() => compare(measured, { instantiations: 10 }, wall), /Missing budget wallSeconds in test\/types\/bench\/budget\.json/);
  assert.throws(() => parse('Instantiations: 42\n'), /Missing metric/);
  assert.throws(() => parse('garbage'), /Missing metric Instantiations/);
  assert.deepEqual(parse('Instantiations: 10\nCheck time: 1s\nTotal time: 2s\nMemory used: 300K\n'), { instantiations: 10, checkSeconds: 1, totalSeconds: 2, memoryKiB: 300 });
  assert.throws(() => invoke(['exec', 'node', '-e', 'process.exit(3)']), /failed \(not a baseline\)/);
  // Host-class file: wall hard from the file; a key the file lacks is advisory for that key only, never the
  // reference host's wall ceiling; a stale inputHash or changed policy in the file is fatal.
  const temp = mkdtempSync(join(tmpdir(), 'typedhouse-type-budget-self-test-'));
  try {
    const hostFile = join(temp, `budget.${slugOf(local)}.json`);
    writeFileSync(hostFile, JSON.stringify({ policy, inputHash: 'h', host: local, baselines: { [key]: { instantiations: 10, wallSeconds: 3 }, 'y/built': { instantiations: 10 } } }));
    const fromFile = { ...wallSource(budget, local, hostFile, 'h'), slug: slugOf(local), reference: m3.cpu };
    assert.equal(fromFile.enforced, true);
    assert.equal(fromFile.note, null);
    // runner-image drift note: same cpu/platform/arch, different image → one INFO line, still enforced.
    const ghFile = join(temp, `budget.${slugOf(gh)}.json`);
    writeFileSync(ghFile, JSON.stringify({ policy, inputHash: 'h', hostClass: { ...gh, runner: 'ubuntu22' }, baselines: { [key]: { instantiations: 10, wallSeconds: 3 } } }));
    const drift = wallSource(budget, gh, ghFile, 'h');
    assert.equal(drift.enforced, true);
    assert.equal(drift.note, `INFO runner image differs from the recorded host-class budget ${relative(root, ghFile)}: running on ubuntu24, recorded on ubuntu22 (same cpu/platform/arch; wall ceilings still enforced from that file)`);
    assert.throws(() => compare({ instantiations: 10, wallSeconds: 4 }, tight, { ...drift, key, slug: slugOf(gh), reference: m3.cpu }), /wallSeconds 4 exceeds budget 3/);
    writeFileSync(ghFile, JSON.stringify({ policy, inputHash: 'h', hostClass: gh, baselines: {} }));
    assert.equal(wallSource(budget, gh, ghFile, 'h').note, null);
    assert.equal(compare(measured, tight, { ...fromFile, key }), null);
    assert.throws(() => compare({ instantiations: 10, wallSeconds: 4 }, tight, { ...fromFile, key }), /wallSeconds 4 exceeds budget 3/);
    assert.throws(() => compare(measured, tight, { ...fromFile, key: 'y/built' }), /Missing budget wallSeconds/);
    assert.match(compare(measured, tight, { ...fromFile, key: 'z/built' }), /^ADVISORY wall z\/built 2\.00s \(no wall budget for z\/built in .*budget\..*\.json, host class .*; Apple M3 Max ceiling 1\.00s\) — not enforced$/);
    assert.throws(() => wallSource(budget, local, hostFile, 'other'), /Benchmark inputs changed since/);
    writeFileSync(hostFile, JSON.stringify({ policy: 'other', inputHash: 'h', baselines: {} }));
    assert.throws(() => wallSource(budget, local, hostFile, 'h'), /Repeat policy changed/);
    // End to end through the CLI: an inputHash mismatch in budget.json is fatal before any measurement on
    // this (unknown) host, and --record-host-budget refuses to overwrite an existing host-class file.
    const real = JSON.parse(readFileSync(budgetPath, 'utf8'));
    const tempBudget = join(temp, 'budget.json');
    const child = (...extra) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--budget=${tempBudget}`, ...extra], { cwd: root, encoding: 'utf8', timeout: 120000 });
    writeFileSync(tempBudget, JSON.stringify({ ...real, inputHash: 'stale' }));
    const stale = child();
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stderr, /Benchmark inputs changed/);
    assert.doesNotMatch(stale.stdout, /"run":/);
    writeFileSync(tempBudget, JSON.stringify(real));
    writeFileSync(join(temp, `budget.${slugOf(hostClass())}.json`), '{}');
    const refused = child('--record-host-budget');
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, new RegExp(`Refusing to overwrite .*budget\\.${slugOf(hostClass())}\\.json`));
    assert.doesNotMatch(refused.stdout, /"run":/);
    assert.equal(JSON.parse(readFileSync(tempBudget, 'utf8')).inputHash, real.inputHash);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log('Performance enforcement controls passed: tiny ceilings, wall-only regression on a known host, missing metrics, unknown baseline, failing compiler, unknown host advisory (instantiations hard, parse/metric failures fatal), host-class file (hard wall, per-key advisory, stale hash, policy), inputHash mismatch exit 1, record refusal exit 1, slug pins, runner-image drift note.');
  if (!initialize) process.exit(0);
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
const cls = hostClass();
const slug = slugOf(cls);
const hostBudgetPath = resolve(dirname(budgetPath), `budget.${slug}.json`);
const hostRecord = { ...cls, memoryBytes: totalmem(), release: release(), node: process.version };
let budget;
if (initialize) {
  assert.ok(!existsSync(budgetPath), 'Refusing to overwrite an existing budget. Raises require an explicit reviewed note; never silently rebaseline.');
  budget = { policy, inputHash, inputs, recordedAt: new Date().toISOString(), host: { cpu: cpus()[0]?.model, memoryBytes: totalmem(), platform: platform(), arch: arch(), release: release(), node: process.version }, baselines: {} };
} else {
  budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
  assert.equal(budget.policy, policy, 'Repeat policy changed');
  assert.equal(budget.inputHash, inputHash, 'Benchmark inputs changed: review corpus and budget provenance; no automatic rebaseline');
}
let hostBudget;
if (record) {
  assert.ok(!existsSync(hostBudgetPath), `Refusing to overwrite existing host-class budget ${relative(root, hostBudgetPath)}; deleting or re-recording it is a review decision, never silently rebaseline.`);
  hostBudget = { policy, inputHash, hostClass: cls, host: hostRecord, recordedAt: new Date().toISOString(), baselines: {} };
}
const wall = record ? { enforced: false, source: null, baselines: {} } : wallSource(budget, cls, hostBudgetPath, inputHash);
if (wall.note) console.log(wall.note);
console.log(JSON.stringify({ policy, inputHash, host: { cpu: cpus()[0]?.model, node: process.version, platform: platform(), arch: arch() }, hostClass: cls, hostClassSlug: slug, wallBudgetFile: wall.source, mode: initialize ? 'initialize' : record ? 'record-host-budget' : 'check' }));
const selectors = initialize || process.argv.includes('--all') ? [undefined, '5.5.4', 'latest'] : [process.env.TYPEDHOUSE_TYPESCRIPT_VERSION];
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
    if (initialize) {
      budget.baselines[key] = { instantiations: Math.ceil(maxima.instantiations * 1.5), wallSeconds: maxima.wallSeconds * 1.5, command: ['pnpm', ...args], runs };
    } else {
      const advisory = compare(maxima, budget.baselines[key], { ...wall, key, slug, reference: budget.host?.cpu ?? 'reference' });
      if (advisory) console.log(advisory);
      if (record) hostBudget.baselines[key] = { instantiations: Math.ceil(maxima.instantiations * 1.5), wallSeconds: maxima.wallSeconds * 1.5, command: ['pnpm', ...args], runs };
    }
  }
}
if (initialize) writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + '\n');
if (record) writeFileSync(hostBudgetPath, JSON.stringify(hostBudget, null, 2) + '\n');
console.log(initialize ? `Initialized measured performance budget ${relative(root, budgetPath)}`
  : record ? `Recorded host-class wall budget ${relative(root, hostBudgetPath)} (${slug}); commit it after review to make wall ceilings hard for this class`
  : `Passed unchanged performance budget ${relative(root, budgetPath)} (instantiations hard; wall ${wall.enforced ? `hard from ${wall.source}` : `advisory for host class ${slug}`})`);
