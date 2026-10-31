// Slice 3c Tester probes for scripts/check-type-performance.mjs (host-class wall budgets).
// Docker-free; run with `node --test scripts/check-type-performance.slice3c.test.mjs`.
// `node --test` rather than Vitest: the subject is a plain .mjs CLI outside vitest.config.ts's include
// globs (`packages/**`, `test/**`), it needs no aliasing, and `pnpm test` must not start to spawn these children.
//
// Every probe drives the script as a child process with `--budget=<tmp>/budget.json` and a fake `pnpm`
// placed first on PATH (the script spawns `pnpm exec tsc` / `pnpm --package typescript@X dlx tsc` through
// PATH, so a fake `pnpm` is the only injection point that does not edit the script). The fake answers
// `--version` with a version chosen per selector and prints crafted `--extendedDiagnostics` output; the
// real generators still run (they are spawned with process.execPath, not pnpm), so the real `inputHash`
// is checked on every run. Set SLICE3C_SCRIPT to probe a copy of the script (flip table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = process.env.SLICE3C_SCRIPT ? resolve(root, process.env.SLICE3C_SCRIPT) : resolve(root, 'scripts/check-type-performance.mjs');
const realBudgetPath = resolve(root, 'test/types/bench/budget.json');
const realBytes = readFileSync(realBudgetPath);
const real = JSON.parse(realBytes.toString('utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const realSha = sha256(realBytes);

// Independent re-derivation of the brief's host-class rule (not imported from the script).
function expectedClass(env) {
  const cls = { cpu: String(cpus()[0].model).trim(), platform: platform(), arch: arch() };
  if (env.GITHUB_ACTIONS === 'true') cls.runner = env.ImageOS ?? env.RUNNER_OS ?? 'unknown-runner';
  return cls;
}
function expectedSlug(cls) {
  return [cls.runner !== undefined ? 'github' : '', cls.cpu, cls.platform, cls.arch].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const localClass = expectedClass({});
const localSlug = expectedSlug(localClass);

// Fake pnpm: a POSIX sh script controlled by FAKE_TSC_* variables.
const work = mkdtempSync(join(tmpdir(), 'typedhouse-slice3c-probes-'));
const fakeBin = join(work, 'bin');
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, 'pnpm'), `#!/bin/sh
ver="\${FAKE_TSC_DEFAULT_VERSION:-5.8.3}"
mode="\${FAKE_TSC_MODE:-ok}"
inst="\${FAKE_TSC_INST:-1001}"
want_version=0
for a in "$@"; do
  case "$a" in
    typescript@latest) ver="\${FAKE_TSC_LATEST_VERSION:-7.0.2}";;
    typescript@*) ver="\${a#typescript@}";;
    --version) want_version=1;;
    test/types/bench/tsconfig.source.json) mode="\${FAKE_TSC_SOURCE_MODE:-$mode}"; inst="\${FAKE_TSC_SOURCE_INST:-1201}";;
  esac
done
if [ "$want_version" = 1 ]; then echo "Version $ver"; exit 0; fi
[ -n "\${FAKE_TSC_SLEEP:-}" ] && sleep "$FAKE_TSC_SLEEP"
case "$mode" in
  exit3) echo "error TS1234: synthetic failure"; exit 3;;
  garbage) echo "this is not extendedDiagnostics output"; exit 0;;
  missing-instantiations) printf 'Check time: 1.00s\\nTotal time: 1.50s\\nMemory used: 300000K\\n';;
  missing-check) printf 'Instantiations: %s\\nTotal time: 1.50s\\nMemory used: 300000K\\n' "$inst";;
  huge) printf 'Instantiations: 999999999\\nCheck time: 1.00s\\nTotal time: 1.50s\\nMemory used: 300000K\\n';;
  *) printf 'Files: 10\\nInstantiations: %s\\nCheck time: 1.00s\\nTotal time: 1.50s\\nMemory used: 300000K\\n' "$inst";;
esac
`);
chmodSync(join(fakeBin, 'pnpm'), 0o755);

let counter = 0;
function tempBudgetDir(mutate = b => b) {
  const dir = join(work, `case-${++counter}`);
  mkdirSync(dir);
  const budget = mutate(structuredClone(real));
  writeFileSync(join(dir, 'budget.json'), JSON.stringify(budget, null, 2) + '\n');
  return dir;
}
function hostFile(dir, slug = localSlug) { return join(dir, `budget.${slug}.json`); }
function writeHost(dir, body, slug = localSlug) {
  const path = hostFile(dir, slug);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  return path;
}
const baseHost = (baselines, extra = {}) => ({ policy: real.policy, inputHash: real.inputHash, hostClass: localClass, host: localClass, recordedAt: 'probe', baselines, ...extra });
const wallEntry = (wallSeconds, instantiations = 10) => ({ instantiations, wallSeconds });

function run(dir, args = [], env = {}) {
  const childEnv = { ...process.env };
  for (const k of Object.keys(childEnv)) if (k === 'GITHUB_ACTIONS' || k === 'ImageOS' || k === 'RUNNER_OS' || k === 'TYPEDHOUSE_TYPESCRIPT_VERSION' || k.startsWith('FAKE_TSC_')) delete childEnv[k];
  Object.assign(childEnv, { PATH: `${fakeBin}:${process.env.PATH}` }, env);
  const result = spawnSync(process.execPath, [script, `--budget=${join(dir, 'budget.json')}`, ...args], { cwd: root, encoding: 'utf8', env: childEnv, timeout: 180000 });
  const stdout = result.stdout ?? '';
  const headerLine = stdout.split('\n').find(l => l.startsWith('{"policy"'));
  return { status: result.status, stdout, stderr: result.stderr ?? '', header: headerLine ? JSON.parse(headerLine) : null, advisory: stdout.split('\n').filter(l => l.startsWith('ADVISORY ')), runs: stdout.split('\n').filter(l => l.includes('"run":')), info: stdout.split('\n').filter(l => l.startsWith('INFO ')) };
}
const advisoryRe = (key, why, ceiling) => new RegExp(`^ADVISORY wall ${key.replace('/', '\\/')} \\d+\\.\\d\\ds \\(${why}; Apple M3 Max ceiling ${ceiling}s\\) — not enforced$`);
function budgetUnchanged() { assert.equal(sha256(readFileSync(realBudgetPath)), realSha, 'real budget.json changed'); }
function nothingWritten(dir, slug = localSlug) { assert.ok(!existsSync(hostFile(dir, slug)), `host file was written: ${hostFile(dir, slug)}`); }
const dirBudgetUnchanged = (dir, before) => assert.equal(readFileSync(join(dir, 'budget.json'), 'utf8'), before, 'tmp budget.json rewritten');

test.after(() => { rmSync(work, { recursive: true, force: true }); budgetUnchanged(); });

// ---------------------------------------------------------------- (1) advisory path cannot swallow a non-wall failure
test('1a unknown host, healthy compile: exit 0, advisory per key, header advisory', () => {
  const dir = tempBudgetDir();
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.header.wallBudgetFile, null);
  assert.equal('wallEnforced' in r.header, false);
  assert.equal(r.header.hostClassSlug, localSlug);
  assert.deepEqual(r.header.hostClass, localClass);
  assert.equal(r.header.mode, 'check');
  assert.equal(r.runs.length, 6);
  assert.deepEqual(r.advisory.length, 2);
  assert.match(r.advisory[0], advisoryRe('5.8.3/built', `no wall budget for host class ${localSlug}`, '4\\.24'));
  assert.match(r.advisory[1], advisoryRe('5.8.3/source', `no wall budget for host class ${localSlug}`, '4\\.67'));
  assert.match(r.stdout, new RegExp(`Passed unchanged performance budget .*budget\\.json \\(instantiations hard; wall advisory for host class ${localSlug}\\)\\s*$`));
  budgetUnchanged();
});

test('1b unknown host, wall over the M3 Max ceiling: exit 0 with the advisory line only', () => {
  const dir = tempBudgetDir(b => { b.baselines['5.8.3/built'].wallSeconds = 1e-6; b.baselines['5.8.3/source'].wallSeconds = 1e-6; return b; });
  const r = run(dir, [], { FAKE_TSC_SLEEP: '0.05' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.advisory.length, 2);
  assert.match(r.advisory[0], advisoryRe('5.8.3/built', `no wall budget for host class ${localSlug}`, '0\\.00'));
  assert.doesNotMatch(r.stderr, /exceeds/);
});

for (const [name, env, message] of [
  ['missing Instantiations line', { FAKE_TSC_MODE: 'missing-instantiations' }, /Missing metric Instantiations/],
  ['missing Check time line', { FAKE_TSC_MODE: 'missing-check' }, /Missing metric Check time/],
  ['garbage tsc output', { FAKE_TSC_MODE: 'garbage' }, /Missing metric Instantiations/],
  ['non-zero tsc exit', { FAKE_TSC_MODE: 'exit3' }, /exec tsc -p .* failed \(not a baseline\)/],
  ['instantiations over the budget.json ceiling', { FAKE_TSC_MODE: 'huge' }, /instantiations 999999999 exceeds budget 3198669/],
]) {
  test(`1c unknown host, ${name}: exit 1, no advisory line`, () => {
    const dir = tempBudgetDir();
    const r = run(dir, [], env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(r.advisory.length, 0, r.stdout);
    assert.equal(r.header.wallBudgetFile, null);
    assert.doesNotMatch(r.stdout, /Passed unchanged/);
  });
}

test('1d unknown host, built healthy but source instantiations over: built advisory printed, exit 1, no source advisory, no pass line', () => {
  const dir = tempBudgetDir();
  const r = run(dir, [], { FAKE_TSC_SOURCE_MODE: 'huge' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /instantiations 999999999 exceeds budget 4064399/);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], /^ADVISORY wall 5\.8\.3\/built /);
  assert.doesNotMatch(r.stdout, /Passed unchanged/);
});

test('1e unknown host, inputHash mismatch in budget.json: exit 1 before any run, no advisory, no header-level measurement', () => {
  const dir = tempBudgetDir(b => { b.inputHash = 'stale'; return b; });
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Benchmark inputs changed/);
  assert.equal(r.runs.length, 0);
  assert.equal(r.advisory.length, 0);
  assert.equal(r.header, null);
});

test('1f unknown host, changed policy in budget.json: exit 1 before any run', () => {
  const dir = tempBudgetDir(b => { b.policy = b.policy + ' (edited)'; return b; });
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Repeat policy changed/);
  assert.equal(r.runs.length, 0);
  assert.equal(r.advisory.length, 0);
});

test('1g unknown host, compiler version with no budget.json baseline: exit 1 before any run', () => {
  const dir = tempBudgetDir();
  const r = run(dir, [], { FAKE_TSC_DEFAULT_VERSION: '9.9.9' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Unknown compiler\/input baseline 9\.9\.9\/built/);
  assert.equal(r.runs.length, 0);
  assert.equal(r.advisory.length, 0);
});

test('1h unknown host, budget.json baseline lacks instantiations: exit 1 (not advisory)', () => {
  const dir = tempBudgetDir(b => { delete b.baselines['5.8.3/built'].instantiations; return b; });
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Missing budget instantiations/);
  assert.equal(r.advisory.length, 0);
});

test('1i (m3, slice 4a) unknown host, budget.json baseline lacks wallSeconds: exit 1, never a NaN advisory ceiling', () => {
  const dir = tempBudgetDir(b => { delete b.baselines['5.8.3/built'].wallSeconds; return b; });
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Missing budget wallSeconds in test\/types\/bench\/budget\.json/);
  assert.equal(r.advisory.length, 0);
  assert.doesNotMatch(r.stdout, /NaN/);
});

// ---------------------------------------------------------------- (2) host-class matching and lookup order
test('2a host file for this class: wall hard from the file (tiny ceiling exits 1 naming the file; generous exits 0)', () => {
  const dir = tempBudgetDir();
  const file = writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1e-6), '5.8.3/source': wallEntry(1e-6) }));
  const tight = run(dir);
  assert.equal(tight.status, 1, tight.stdout + tight.stderr);
  assert.match(tight.stderr, new RegExp(`wallSeconds [0-9.]+ exceeds budget 0\\.000001 \\(${relative(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.notEqual(tight.header.wallBudgetFile, null);
  assert.equal(tight.header.wallBudgetFile, relative(root, file));
  assert.equal(tight.advisory.length, 0);
  writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1000), '5.8.3/source': wallEntry(1000) }));
  const ok = run(dir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(ok.advisory.length, 0);
  assert.match(ok.stdout, new RegExp(`\\(instantiations hard; wall hard from ${relative(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
});

test('2b host file wins over a budget.json whose host matches this class (lookup order 1 before 2)', () => {
  const dir = tempBudgetDir(b => { b.host = { ...b.host, ...localClass }; b.baselines['5.8.3/built'].wallSeconds = 1000; b.baselines['5.8.3/source'].wallSeconds = 1000; return b; });
  const file = writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1e-6), '5.8.3/source': wallEntry(1e-6) }));
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /exceeds budget 0\.000001 \(.*budget\.amd.*\.json\)|exceeds budget 0\.000001 \(.*budget\.[a-z0-9-]+\.json\)/);
  assert.equal(r.header.wallBudgetFile, relative(root, file));
});

test('2c budget.json host matches this class exactly and no host file: wall hard from budget.json', () => {
  const tight = tempBudgetDir(b => { b.host = { ...b.host, ...localClass }; b.baselines['5.8.3/built'].wallSeconds = 1e-6; return b; });
  const r = run(tight);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /wallSeconds [0-9.]+ exceeds budget 0\.000001 \(.*case-\d+\/budget\.json\)/);
  assert.notEqual(r.header.wallBudgetFile, null);
  assert.match(r.header.wallBudgetFile, /budget\.json$/);
  assert.equal(r.advisory.length, 0);
  const ok = tempBudgetDir(b => { b.host = { ...b.host, ...localClass }; return b; });
  const r2 = run(ok);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /wall hard from .*budget\.json\)/);
});

for (const [name, mutateHost, matches] of [
  ['cpu with leading/trailing spaces', h => ({ ...h, cpu: `  ${h.cpu}  ` }), true],
  ['cpu with a trailing tab', h => ({ ...h, cpu: `${h.cpu}\t` }), true],
  ['cpu upper-cased', h => ({ ...h, cpu: h.cpu.toUpperCase() }), false],
  ['cpu with doubled internal space', h => ({ ...h, cpu: h.cpu.replace(' ', '  ') }), false],
  ['host missing arch', h => { const c = { ...h }; delete c.arch; return c; }, false],
  ['host with a runner field', h => ({ ...h, runner: 'ubuntu24' }), false],
]) {
  test(`2d budget.json host match: ${name} → ${matches ? 'hard from budget.json' : 'advisory'}`, () => {
    const dir = tempBudgetDir(b => { b.host = mutateHost({ ...b.host, ...localClass }); b.baselines['5.8.3/built'].wallSeconds = 1e-6; b.baselines['5.8.3/source'].wallSeconds = 1e-6; return b; });
    const r = run(dir);
    if (matches) {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /exceeds budget 0\.000001 \(.*budget\.json\)/);
      assert.notEqual(r.header.wallBudgetFile, null);
    } else {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.header.wallBudgetFile, null);
      assert.equal(r.advisory.length, 2);
    }
  });
}

test('2e GitHub slug stability: ImageOS, RUNNER_OS fallback and neither give one slug; runner recorded in the class', () => {
  const dir = tempBudgetDir();
  const ghClass = expectedClass({ GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24' });
  const ghSlug = expectedSlug(ghClass);
  assert.equal(ghSlug, `github-${localSlug}`);
  const withImage = run(dir, [], { GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24', RUNNER_OS: 'Linux' });
  const osOnly = run(dir, [], { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' });
  const neither = run(dir, [], { GITHUB_ACTIONS: 'true' });
  const notActions = run(dir, [], { GITHUB_ACTIONS: 'false', ImageOS: 'ubuntu24' });
  for (const r of [withImage, osOnly, neither, notActions]) assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(withImage.header.hostClassSlug, ghSlug);
  assert.equal(osOnly.header.hostClassSlug, ghSlug);
  assert.equal(neither.header.hostClassSlug, ghSlug);
  assert.equal(notActions.header.hostClassSlug, localSlug);
  assert.equal(withImage.header.hostClass.runner, 'ubuntu24');
  assert.equal(osOnly.header.hostClass.runner, 'Linux');
  assert.equal(neither.header.hostClass.runner, 'unknown-runner');
  assert.equal(notActions.header.hostClass.runner, undefined);
  assert.match(withImage.advisory[0], new RegExp(`no wall budget for host class ${ghSlug};`));
});

test('2f GitHub host file recorded on another image: one INFO line before the header, wall still hard; same image → no INFO', () => {
  const ghClass = expectedClass({ GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24' });
  const ghSlug = expectedSlug(ghClass);
  const dir = tempBudgetDir();
  const file = writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1e-6), '5.8.3/source': wallEntry(1e-6) }, { hostClass: { ...ghClass, runner: 'ubuntu22' }, host: { ...ghClass, runner: 'ubuntu22' } }), ghSlug);
  const drift = run(dir, [], { GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24' });
  assert.equal(drift.status, 1, drift.stdout + drift.stderr);
  assert.deepEqual(drift.info, [`INFO runner image differs from the recorded host-class budget ${relative(root, file)}: running on ubuntu24, recorded on ubuntu22 (same cpu/platform/arch; wall ceilings still enforced from that file)`]);
  assert.ok(drift.stdout.indexOf('INFO ') < drift.stdout.indexOf('{"policy"'), 'INFO must precede the header');
  assert.match(drift.stderr, /exceeds budget 0\.000001/);
  assert.notEqual(drift.header.wallBudgetFile, null);
  const same = run(dir, [], { GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu22' });
  assert.equal(same.info.length, 0);
  assert.equal(same.status, 1);
  // Advisory path on GitHub without any file: no INFO either.
  const noFile = run(tempBudgetDir(), [], { GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24' });
  assert.equal(noFile.status, 0, noFile.stdout + noFile.stderr);
  assert.equal(noFile.info.length, 0);
});

test('2g host file lacks the running key: advisory for that key only, naming the file, never the M3 Max ceiling; other key hard', () => {
  // budget.json's M3 Max source wall is made tiny: if the lookup ever fell back to it, the run would exit 1.
  const dir = tempBudgetDir(b => { b.baselines['5.8.3/source'].wallSeconds = 1e-6; return b; });
  const file = writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1000) }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.notEqual(r.header.wallBudgetFile, null);
  assert.equal(r.advisory.length, 1);
  assert.match(r.advisory[0], advisoryRe('5.8.3/source', `no wall budget for 5\\.8\\.3\\/source in ${relative(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, host class ${localSlug}`, '0\\.00'));
  assert.match(r.stdout, /wall hard from .*budget\.[a-z0-9-]+\.json\)\s*$/);
  // and the key the file does carry stays hard
  writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1e-6) }));
  const tight = run(dir);
  assert.equal(tight.status, 1, tight.stdout + tight.stderr);
  assert.match(tight.stderr, /wallSeconds [0-9.]+ exceeds budget 0\.000001 \(.*budget\.[a-z0-9-]+\.json\)/);
});

test('2h CI selector: TYPEDHOUSE_TYPESCRIPT_VERSION picks one selector; a file recorded for other versions is per-key advisory (header names wallBudgetFile)', () => {
  const dir = tempBudgetDir(b => { b.baselines['5.5.4/built'].wallSeconds = 1e-6; b.baselines['5.5.4/source'].wallSeconds = 1e-6; return b; });
  const file = writeHost(dir, baseHost({ '5.8.3/built': wallEntry(1000), '5.8.3/source': wallEntry(1000) }));
  const r = run(dir, [], { TYPEDHOUSE_TYPESCRIPT_VERSION: '5.5.4' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Selector 5\.5\.4 resolved official CLI 5\.5\.4/);
  assert.equal(r.runs.length, 6);
  assert.ok(r.runs.every(l => l.includes('"key":"5.5.4/')), r.runs.join('\n'));
  assert.equal(r.advisory.length, 2);
  assert.match(r.advisory[0], new RegExp(`no wall budget for 5\\.5\\.4\\/built in ${relative(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, host class`));
  assert.equal(r.header.wallBudgetFile, relative(root, file)); // m2 (slice 4a): names the file consulted, not a file-level enforcement claim; the per-key fact is on the ADVISORY lines
  assert.equal('wallEnforced' in r.header, false);
  const latest = run(dir, [], { TYPEDHOUSE_TYPESCRIPT_VERSION: 'latest' });
  assert.equal(latest.status, 0, latest.stdout + latest.stderr);
  assert.match(latest.stdout, /Selector latest resolved official CLI 7\.0\.2/);
  assert.ok(latest.runs.every(l => l.includes('"key":"7.0.2/')));
});

for (const [name, body, message] of [
  ['stale inputHash', baseHost({ '5.8.3/built': wallEntry(1000) }, { inputHash: 'stale' }), /Benchmark inputs changed since .*budget\.[a-z0-9-]+\.json was recorded: re-record it \(type-budget\.yml \/ --record-host-budget\) or delete it in review; no automatic rebaseline/],
  ['changed policy', baseHost({ '5.8.3/built': wallEntry(1000) }, { policy: 'other' }), /Repeat policy changed in .*budget\.[a-z0-9-]+\.json/],
  ['missing baselines', { policy: real.policy, inputHash: real.inputHash }, /Missing baselines in .*budget\.[a-z0-9-]+\.json/],
  ['malformed JSON', '{ not json', /JSON|Unexpected token|Expected property name/],
]) {
  test(`2i host file ${name}: exit 1 before any run, no advisory`, () => {
    const dir = tempBudgetDir();
    writeHost(dir, body);
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(r.runs.length, 0);
    assert.equal(r.advisory.length, 0);
  });
}

test('2j host file key present but without wallSeconds: exit 1, not advisory', () => {
  const dir = tempBudgetDir();
  writeHost(dir, baseHost({ '5.8.3/built': { instantiations: 10 }, '5.8.3/source': wallEntry(1000) }));
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Missing budget wallSeconds in .*budget\.[a-z0-9-]+\.json/);
  assert.equal(r.advisory.length, 0);
});

// ---------------------------------------------------------------- (3) --record-host-budget
test('3a record refuses an existing host file: exit 1 naming it, nothing written, no run', () => {
  const dir = tempBudgetDir();
  const before = readFileSync(join(dir, 'budget.json'), 'utf8');
  const file = writeHost(dir, '{}');
  const r = run(dir, ['--record-host-budget']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`Refusing to overwrite existing host-class budget ${relative(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(r.runs.length, 0);
  assert.equal(r.header, null);
  assert.equal(readFileSync(file, 'utf8'), '{}');
  dirBudgetUnchanged(dir, before);
});

test('3b record with instantiations over the budget.json ceiling: exit 1, no file written', () => {
  const dir = tempBudgetDir(b => { b.baselines['5.8.3/built'].instantiations = 1; return b; });
  const before = readFileSync(join(dir, 'budget.json'), 'utf8');
  const r = run(dir, ['--record-host-budget']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /instantiations 1001 exceeds budget 1/);
  assert.equal(r.header.mode, 'record-host-budget');
  nothingWritten(dir);
  dirBudgetUnchanged(dir, before);
});

test('3c record with a non-zero tsc / stale budget.json hash: exit 1, no file written', () => {
  const dir = tempBudgetDir();
  const r = run(dir, ['--record-host-budget'], { FAKE_TSC_MODE: 'exit3' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  nothingWritten(dir);
  const stale = tempBudgetDir(b => { b.inputHash = 'stale'; return b; });
  const r2 = run(stale, ['--record-host-budget']);
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /Benchmark inputs changed/);
  nothingWritten(stale);
});

test('3d record succeeds: file carries budget.json policy/inputHash, max×1.5 ceilings (instantiations rounded up), only the selected keys; budget.json untouched', () => {
  const dir = tempBudgetDir();
  const before = readFileSync(join(dir, 'budget.json'), 'utf8');
  const r = run(dir, ['--record-host-budget'], { FAKE_TSC_INST: '1001', FAKE_TSC_SOURCE_INST: '1201', FAKE_TSC_SLEEP: '0.02' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.header.mode, 'record-host-budget');
  assert.equal(r.header.wallBudgetFile, null);
  assert.match(r.stdout, new RegExp(`Recorded host-class wall budget .*budget\\.${localSlug}\\.json \\(${localSlug}\\); commit it after review`));
  const written = JSON.parse(readFileSync(hostFile(dir), 'utf8'));
  assert.equal(written.policy, real.policy);
  assert.equal(written.inputHash, real.inputHash);
  assert.deepEqual(written.hostClass, localClass);
  assert.deepEqual({ cpu: written.host.cpu, platform: written.host.platform, arch: written.host.arch }, localClass);
  assert.ok(typeof written.recordedAt === 'string' && !Number.isNaN(Date.parse(written.recordedAt)));
  assert.deepEqual(Object.keys(written.baselines), ['5.8.3/built', '5.8.3/source']);
  for (const [key, inst] of [['5.8.3/built', 1001], ['5.8.3/source', 1201]]) {
    const b = written.baselines[key];
    assert.equal(b.runs.length, 3);
    assert.equal(b.instantiations, Math.ceil(inst * 1.5));
    assert.equal(b.wallSeconds, Math.max(...b.runs.map(x => x.wallSeconds)) * 1.5);
    assert.ok(b.wallSeconds >= 0.02 * 1.5);
    assert.deepEqual(b.command.slice(0, 3), ['pnpm', 'exec', 'tsc']);
  }
  assert.deepEqual(Object.keys(written), ['policy', 'inputHash', 'hostClass', 'host', 'recordedAt', 'baselines']);
  dirBudgetUnchanged(dir, before);
  assert.deepEqual(readdirSync(dir).sort(), ['budget.json', `budget.${localSlug}.json`].sort());
  // Follow-up check run now takes the file (lookup 1) and enforces wall from it.
  const check = run(dir);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.notEqual(check.header.wallBudgetFile, null);
  assert.equal(check.header.wallBudgetFile, relative(root, hostFile(dir)));
  assert.equal(check.advisory.length, 0);
  // Second record refuses.
  const again = run(dir, ['--record-host-budget']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /Refusing to overwrite/);
});

test('3e record --all writes all six keys (default/5.5.4/latest selectors, dedup by resolved version)', () => {
  const dir = tempBudgetDir();
  const r = run(dir, ['--record-host-budget', '--all']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const written = JSON.parse(readFileSync(hostFile(dir), 'utf8'));
  assert.deepEqual(Object.keys(written.baselines).sort(), ['5.5.4/built', '5.5.4/source', '5.8.3/built', '5.8.3/source', '7.0.2/built', '7.0.2/source']);
  assert.equal(r.runs.length, 18);
  // A duplicate resolution is measured once.
  const dup = tempBudgetDir();
  const r2 = run(dup, ['--record-host-budget', '--all'], { FAKE_TSC_LATEST_VERSION: '5.8.3' });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(hostFile(dup), 'utf8')).baselines).sort(), ['5.5.4/built', '5.5.4/source', '5.8.3/built', '5.8.3/source']);
  assert.equal(r2.runs.length, 12);
});

test('3f --initialize with --record-host-budget is rejected before anything runs', () => {
  const dir = tempBudgetDir();
  const r = run(dir, ['--initialize', '--record-host-budget']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /--initialize and --record-host-budget are exclusive/);
  assert.equal(r.header, null);
  nothingWritten(dir);
});

test('3g record on GitHub writes the github- slug file with the runner in hostClass', () => {
  const dir = tempBudgetDir();
  const ghClass = expectedClass({ GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24' });
  const r = run(dir, ['--record-host-budget'], { GITHUB_ACTIONS: 'true', ImageOS: 'ubuntu24', RUNNER_OS: 'Linux' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = hostFile(dir, expectedSlug(ghClass));
  assert.ok(existsSync(file), readdirSync(dir).join(','));
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(written.hostClass, ghClass);
  assert.equal(written.host.runner, 'ubuntu24');
  assert.deepEqual(readdirSync(dir).sort(), ['budget.json', `budget.github-${localSlug}.json`].sort());
});

// ---------------------------------------------------------------- (5) workflows
test('5 workflows: ci.yml fail-fast under strategy; type-budget.yml dispatch-only, mirrors install, builds, self-test then record --all, uploads strictly, never commits', async () => {
  const yamlDir = readdirSync(resolve(root, 'node_modules/.pnpm')).filter(d => /^yaml@2\./.test(d)).sort().at(-1);
  assert.ok(yamlDir, 'yaml package not found under node_modules/.pnpm');
  const { parse } = await import(resolve(root, 'node_modules/.pnpm', yamlDir, 'node_modules/yaml/dist/index.js'));
  const ci = parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
  const tb = parse(readFileSync(resolve(root, '.github/workflows/type-budget.yml'), 'utf8'));
  assert.equal(ci.jobs.check.strategy['fail-fast'], false);
  assert.deepEqual(ci.jobs.check.strategy.matrix.typescript, ['5.5.4', 'latest']);
  assert.deepEqual(Object.keys(tb.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(tb.jobs), ['record']);
  const steps = tb.jobs.record.steps;
  const ciSteps = ci.jobs.check.steps;
  // install mirrors ci.yml (pnpm/action-setup, setup-node, frozen install); checkout differs only by not persisting credentials (m1 fix)
  assert.deepEqual(steps[0], { ...ciSteps[0], with: { 'persist-credentials': false } });
  assert.deepEqual(steps.slice(1, 4), ciSteps.slice(1, 4));
  assert.deepEqual(steps.slice(4).map(s => s.run ?? s.uses), ['pnpm build', 'node scripts/check-type-performance.mjs --self-test', 'node scripts/check-type-performance.mjs --record-host-budget --all', 'actions/upload-artifact@v4']);
  const upload = steps.at(-1);
  assert.equal(upload.with.path, 'test/types/bench/budget.*.json');
  assert.equal(upload.with['if-no-files-found'], 'error');
  const text = readFileSync(resolve(root, '.github/workflows/type-budget.yml'), 'utf8');
  assert.doesNotMatch(text, /git (commit|push|add)|create-pull-request|GITHUB_TOKEN|secrets\./);
  assert.deepEqual(tb.permissions, { contents: 'read' }); // m1 fix: read-only token for the whole workflow
  assert.equal(tb.jobs.record.permissions, undefined);
  // the glob the upload step uses must not match budget.json itself
  assert.ok(!/^budget\.[^/]+\.json$/.test('budget.json'));
});
