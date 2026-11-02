#!/usr/bin/env node
// Publish every public workspace package at one shared 0.0.X version.
//
//   pnpm check:publish            full release: preflight → checks → pack → publish → commit/tag/push
//   pnpm check:publish --dry-run  everything except `npm publish` and git writes (checks still run)
//   pnpm check:publish --dry-run --skip-checks   fast rehearsal of version selection and packing
//
// Idempotent: the version comes from the registry, never from package.json.
//   - nothing published            → 0.0.1
//   - some packages miss the max   → resume that version, publish only the missing packages
//   - all packages have the max    → if tag v<max> is on origin, release max+1; else finish the git step for max
// Any failure restores the package.json files, so a rerun starts from a clean master.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipChecks = args.has('--skip-checks');
if (skipChecks && !dryRun) fail('--skip-checks is only allowed together with --dry-run.');
for (const a of args) if (!['--dry-run', '--skip-checks'].includes(a)) fail(`Unknown argument ${a}`);

function fail(message) { console.error(`\ncheck:publish: ${message}`); process.exit(1); }
function log(message) { console.log(`\n▶ ${message}`); }
function out(cmd, argv, opts = {}) { return execFileSync(cmd, argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim(); }
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} exited with ${r.status ?? r.signal}`);
}

// Publish order respects workspace dependencies: core first, then its dependents.
const packages = readdirSync(join(root, 'packages'))
  .map(dir => ({ dir: join(root, 'packages', dir), file: join(root, 'packages', dir, 'package.json') }))
  .filter(p => existsSync(p.file))
  .map(p => ({ ...p, json: JSON.parse(readFileSync(p.file, 'utf8')) }))
  .filter(p => !p.json.private);
const order = [];
const visit = (p, seen = new Set()) => {
  if (order.includes(p)) return;
  if (seen.has(p)) fail(`dependency cycle at ${p.json.name}`);
  seen.add(p);
  for (const dep of Object.keys(p.json.dependencies ?? {})) {
    const local = packages.find(q => q.json.name === dep);
    if (local) visit(local, seen);
  }
  order.push(p);
};
packages.forEach(p => visit(p));
const names = order.map(p => p.json.name);

const VERSION = /^0\.0\.(\d+)$/;
function publishedVersions(name) {
  const r = spawnSync('npm', ['view', name, 'versions', '--json'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    if (/E404|404 Not Found/.test(r.stdout + r.stderr)) return [];
    throw new Error(`npm view ${name} failed:\n${r.stderr}`);
  }
  const parsed = JSON.parse(r.stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}
// Tarball policy: an allowlist of paths plus content checks. `files: ["dist"]` in each
// package.json is the first line of defence; this re-checks the packed artifact itself.
const ALLOWED = [/^package\/package\.json$/, /^package\/(README|LICENSE|LICENCE)(\.md|\.txt)?$/i, /^package\/dist\/[\w.-]+\.(js|d\.ts)$/];
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish'];
const SECRETS = [
  [/npm_[A-Za-z0-9]{36}/, 'npm token'], [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'], [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/_authToken\s*=/, 'npm auth token'], [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/(?:^|[\s"'=:(])\/(?:home|Users)\/[^\s"'/]+\//, 'absolute local path'], [/sourceMappingURL=/, 'source map reference'],
];
function inspectTarball(name, file) {
  const listing = out('tar', ['-tzvf', file]).split('\n').map(line => line.trim().split(/\s+/));
  let unpacked = 0;
  for (const cols of listing) {
    const path = cols.at(-1);
    if (!ALLOWED.some(r => r.test(path))) throw new Error(`${name} tarball contains a disallowed path: ${path}`);
    unpacked += Number(cols[2]) || 0;
  }
  if (unpacked > MAX_UNPACKED_BYTES) throw new Error(`${name} tarball unpacks to ${unpacked} bytes (limit ${MAX_UNPACKED_BYTES})`);
  for (const cols of listing) {
    const path = cols.at(-1);
    const text = execFileSync('tar', ['-xzOf', file, path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const [pattern, label] of SECRETS) if (pattern.test(text)) throw new Error(`${name} tarball ${path} matches the ${label} pattern`);
  }
  const manifest = JSON.parse(out('tar', ['-xzOf', file, 'package/package.json']));
  const hooks = LIFECYCLE.filter(h => manifest.scripts?.[h]);
  if (hooks.length) throw new Error(`${name} manifest declares lifecycle scripts: ${hooks.join(', ')}`);
  if (manifest.publishConfig?.access !== 'public') throw new Error(`${name} manifest lacks publishConfig.access "public"`);
  return { manifest, files: listing.map(c => c.at(-1)), unpacked };
}
function patch(v) { return Number(VERSION.exec(v)?.[1] ?? -1); }

// 1. Preflight: a release is cut only from an up-to-date, clean master.
log('Preflight');
const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'master' && !dryRun) fail(`must run on master (current branch: ${branch}).`);
if (out('git', ['status', '--porcelain'])) fail('working tree is not clean; commit or remove changes first.');
out('git', ['fetch', '--quiet', '--tags', 'origin']);
if (!dryRun && out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/master'])) fail('HEAD does not match origin/master; pull or push first.');
for (const f of out('git', ['ls-files']).split('\n').filter(f => /(^|\/)\.npmrc$/.test(f))) {
  if (/_auth|_password|\/\/[^\s]*:_/.test(readFileSync(join(root, f), 'utf8'))) fail(`tracked ${f} contains credentials; remove them and rotate the token.`);
}
log('Auditing the published packages\' production dependencies (high and critical fail the release)');
{
  // pnpm audit covers the whole workspace; keep only advisories reachable from a published package
  // (path prefix `packages__<dir>`), so the private docs app cannot block or mask a release.
  const r = spawnSync('pnpm', ['audit', '--prod', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(r.stdout); } catch { fail(`pnpm audit did not return JSON (exit ${r.status}):\n${r.stderr}`); }
  const importers = order.map(p => `packages__${p.dir.split(/[\\/]/).at(-1)}`);
  const hits = Object.values(report.advisories ?? {}).flatMap(a => (a.findings ?? []).flatMap(f => f.paths)
    .filter(path => importers.some(i => path === i || path.startsWith(`${i}>`)))
    .map(path => ({ severity: a.severity, module: a.module_name, url: a.url, path })));
  for (const h of hits) console.log(`${h.severity.padEnd(8)} ${h.module} via ${h.path} ${h.url ?? ''}`);
  const blocking = hits.filter(h => h.severity === 'high' || h.severity === 'critical');
  if (blocking.length) fail(`${blocking.length} high/critical advisories affect published packages.`);
  console.log(hits.length ? `${hits.length} low/moderate advisories in published dependencies (not blocking).` : 'No advisories in published dependencies.');
}
if (!dryRun) {
  const who = spawnSync('npm', ['whoami'], { cwd: root, encoding: 'utf8' });
  if (who.status !== 0) fail('not logged in to npm; run `npm login` first.');
  console.log(`npm user: ${who.stdout.trim()}`);
}

// 2. Version from the registry.
log('Resolving version from the registry');
const published = Object.fromEntries(names.map(n => [n, publishedVersions(n)]));
const stray = names.flatMap(n => published[n].filter(v => !VERSION.test(v)).map(v => `${n}@${v}`));
if (stray.length) console.warn(`ignoring versions outside 0.0.X: ${stray.join(', ')}`);
const max = Math.max(0, ...names.flatMap(n => published[n].map(patch)));
const hasMax = n => max > 0 && published[n].includes(`0.0.${max}`);
const tagExists = tag => out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== '';
let version, toPublish;
if (max === 0) { version = '0.0.1'; toPublish = names; }
else if (!names.every(hasMax)) { version = `0.0.${max}`; toPublish = names.filter(n => !hasMax(n)); }
else if (tagExists(`v0.0.${max}`)) { version = `0.0.${max + 1}`; toPublish = names; }
else { version = `0.0.${max}`; toPublish = []; }
const tag = `v${version}`;
for (const n of names) console.log(`${n.padEnd(22)} published: ${published[n].filter(v => VERSION.test(v)).join(', ') || '—'}`);
console.log(toPublish.length === names.length ? `Releasing ${version} for all packages.`
  : toPublish.length ? `Resuming ${version}: publishing ${toPublish.join(', ')}.`
  : `${version} is already published everywhere; finishing the git step.`);
if (tagExists(tag) && toPublish.length) fail(`tag ${tag} already exists on origin but packages are unpublished; resolve manually.`);

// 3. Write the shared version, run the gate, pack, publish. Restore package.json files on any failure.
const original = new Map(order.map(p => [p.file, readFileSync(p.file, 'utf8')]));
const restore = () => { for (const [file, text] of original) writeFileSync(file, text); };
const staging = mkdtempSync(join(tmpdir(), 'typedhouse-publish-'));
try {
  for (const p of order) {
    const text = original.get(p.file);
    writeFileSync(p.file, text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`));
    if (JSON.parse(readFileSync(p.file, 'utf8')).version !== version) throw new Error(`could not set version in ${p.file}`);
  }

  if (toPublish.length) {
    if (skipChecks) log('Skipping checks (--dry-run --skip-checks)');
    else { log('Running the full gate: pnpm check:all'); run('pnpm', ['check:all']); }
    if (skipChecks) { log('Building packages'); run('pnpm', ['-r', '--filter', './packages/*', 'build']); }

    log('Packing and inspecting tarballs');
    const tarballs = new Map();
    for (const p of order.filter(p => toPublish.includes(p.json.name))) {
      const dest = join(staging, p.json.name.replace('/', '__'));
      run('pnpm', ['pack', '--pack-destination', dest], { cwd: p.dir, stdio: ['ignore', 'ignore', 'inherit'] });
      const [tgz] = readdirSync(dest).filter(f => f.endsWith('.tgz'));
      if (!tgz) throw new Error(`pnpm pack produced no tarball for ${p.json.name}`);
      const file = join(dest, tgz);
      const { manifest, files, unpacked } = inspectTarball(p.json.name, file);
      if (manifest.version !== version) throw new Error(`${p.json.name} tarball has version ${manifest.version}`);
      for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
        if (String(range).startsWith('workspace:')) throw new Error(`${p.json.name} tarball still depends on ${dep}@${range}`);
        if (names.includes(dep) && range !== version) throw new Error(`${p.json.name} depends on ${dep}@${range}, expected ${version}`);
      }
      if (!files.some(f => f.startsWith('package/dist/'))) throw new Error(`${p.json.name} tarball has no dist/ files`);
      console.log(`${p.json.name}@${version}: ${files.length} files, ${unpacked} bytes, deps ${JSON.stringify(manifest.dependencies ?? {})}`);
      tarballs.set(p.json.name, file);
    }

    log(dryRun ? 'Publishing (dry run)' : 'Publishing');
    for (const name of toPublish) {
      run('npm', ['publish', tarballs.get(name), '--access', 'public', ...(dryRun ? ['--dry-run'] : [])]);
    }
  }

  // 4. Record the release in git.
  if (dryRun) {
    log(`Dry run complete: would commit "release: ${tag}", tag ${tag} and push to origin/master.`);
    restore();
  } else {
    log(`Committing, tagging ${tag} and pushing`);
    run('git', ['add', ...order.map(p => p.file)]);
    if (out('git', ['diff', '--cached', '--name-only'])) run('git', ['commit', '-m', `release: ${tag}`]);
    run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
    run('git', ['push', 'origin', 'HEAD:master']);
    run('git', ['push', 'origin', tag]);
    log(`Released ${tag}: ${names.join(', ')}`);
  }
} catch (error) {
  restore();
  console.error(error instanceof Error ? error.message : error);
  fail(`aborted; package.json files restored. Rerun to resume at ${version} (already-published packages are skipped).`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
