import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { toTypeScript } from '../packages/core/dist/index.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = join(root, 'test/types/snapshots/corpus');
const refresh = process.argv.includes('--refresh');
const selfTest = process.argv.includes('--self-test');
const version = process.env.CHQL_TYPESCRIPT_VERSION;
const cli = [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc'])];
function run(args, success = true) {
  const result = spawnSync('pnpm', [...cli, ...args], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (success && result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result;
}
const actualVersion = run(['--version']).stdout.trim().replace(/^Version /, '');
assert.match(actualVersion, /^\d+\.\d+\.\d+$/);
console.log(`Corpus official CLI TypeScript ${actualVersion}`);
const directory = mkdtempSync(join(tmpdir(), 'chql-corpus-types-'));
function verifySnapshot(path, text) {
  assert.equal(readFileSync(path, 'utf8'), text, `Stale snapshot: ${path}`);
}
function sameOrRefresh(path, text) {
  if (refresh) writeFileSync(path, text);
  else verifySnapshot(path, text);
}
// Independent of Infer/phantoms: ordered runtime output descriptors mapped by Part 1.
function decoded(output) {
  assert.notEqual(output.shape, 'deferred');
  const fields = output.shape === 'flat'
    ? output.order.map(name => [name, toTypeScript(output.columns[name])])
    : [...output.inputs.map(([name, child]) => [name, decoded(child)]), ...(output.fields ? output.fields.order.map(name => [name, toTypeScript(output.fields.columns[name])]) : [])];
  return `{ ${fields.map(([name, type]) => `${JSON.stringify(name)}: ${type}`).join('; ')} }`;
}
// Inspect real emitted declarations, not a separately authored expected type alias.
function readable(text, path) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      function queryArgs(node) {
        if ((ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)) && /(?:^|\.)(?:Query|TableQuery|OrderedQuery)$/.test((node.typeName ?? node.qualifier)?.getText(file) ?? '')) {
          const row = node.typeArguments?.[0];
          if (!row || !ts.isTypeLiteralNode(row)) failures.push(`${decl.name.getText(file)}: decoded row is ${row?.getText(file).slice(0, 100) ?? 'missing'}, not a flat object`);
        }
        ts.forEachChild(node, queryArgs);
      }
      if (decl.type) queryArgs(decl.type);
    }
  }
  assert.equal(failures.length, 0, `Unreadable inferred declarations in ${path}:\n${failures.slice(0, 12).join('\n')}\n(${failures.length} failures)`);
}
try {
  mkdirSync(snapshots, { recursive: true });
  mkdirSync(join(directory, 'node_modules/@chql'), { recursive: true });
  symlinkSync(join(root, 'packages/core'), join(directory, 'node_modules/@chql/core'), 'dir');
  symlinkSync(join(root, 'node_modules/expect-type'), join(directory, 'node_modules/expect-type'), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const files = ['packages/compiler/test/fixtures/corpus/supported-types.ts', 'test/types/bench/queries.ts', 'packages/compiler/test/fixtures/corpus/components-latest.ts', 'packages/compiler/test/fixtures/corpus/projection-enrichment.ts'];
  const config = { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, incremental: false, skipLibCheck: false, types: [], declaration: true, rootDir: root, outDir: join(directory, 'emit'), paths: { '@chql/core': [join(root, 'packages/core/dist/index.d.ts')] } }, files: files.map(f => join(root, f)) };
  const configPath = join(directory, 'tsconfig.json');
  writeFileSync(configPath, JSON.stringify(config));
  run(['-p', configPath]);
  run(['-p', configPath, '--emitDeclarationOnly']);
  let rows = '// Generated solely from ordered runtime CHType output; check-corpus-types.mjs.\n';
  let assertions = "// Generated exact/not-any correspondence to independently runtime-derived snapshots.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport * as supported from '../../packages/compiler/test/fixtures/corpus/supported-types.js';\nimport * as bench from './bench/queries.js';\nimport type * as Snapshot from './snapshots/corpus/rows.js';\n";
  const descriptors = {};
  const declarations = [];
  for (const [index, source] of files.slice(0, 2).entries()) {
    const module = await import(pathToFileURL(join(directory, 'emit', source.replace(/\.ts$/, '.js'))).href);
    const namespace = index === 0 ? 'supported' : 'bench';
    if (namespace === 'bench') assert.equal(Object.keys(module).length, 200);
    for (const [name, query] of Object.entries(module)) {
      assert.ok(query.ir?.output, `${name} is not a query`);
      const id = `${namespace}_${name}`;
      rows += `export type ${id} = ${decoded(query.ir.output)};\n`;
      descriptors[id] = query.ir.output;
      assertions += `expectTypeOf<Infer<typeof ${namespace}.${name}>>().toEqualTypeOf<Snapshot.${id}>();\nexpectTypeOf<Infer<typeof ${namespace}.${name}>>().not.toBeAny();\n`;
    }
    declarations.push([`${namespace}-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', source.replace(/\.ts$/, '.d.ts')), 'utf8')]);
  }
  // Supplemental examples do not mutate the frozen 200+2 benchmark's row input.
  const latestModule = await import(pathToFileURL(join(directory, 'emit', files[2].replace(/\.ts$/, '.js'))).href);
  const latestOutput = latestModule.componentsLatest.ir.output;
  sameOrRefresh(join(snapshots, 'components-latest-row.d.ts'), `// Generated from runtime CHType output.\nexport type ComponentsLatest = ${decoded(latestOutput)};\n`);
  sameOrRefresh(join(snapshots, 'components-latest-descriptors.json'), JSON.stringify(latestOutput, null, 2) + '\n');
  const latestAssertions = `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport { componentsLatest } from '../../packages/compiler/test/fixtures/corpus/components-latest.js';\nimport type { ComponentsLatest } from './snapshots/corpus/components-latest-row.js';\nexpectTypeOf<Infer<typeof componentsLatest>>().toEqualTypeOf<ComponentsLatest>();\nexpectTypeOf<Infer<typeof componentsLatest>>().not.toBeAny();\n`;
  sameOrRefresh(join(root, 'test/types/components-latest-corpus.ts'), latestAssertions);
  declarations.push([`components-latest-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[2].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const projectionModule = await import(pathToFileURL(join(directory, 'emit', files[3].replace(/\.ts$/, '.js'))).href);
  const projectionOutput = projectionModule.projectionEnrichment.ir.output;
  sameOrRefresh(join(snapshots, 'projection-enrichment-row.d.ts'), `// Generated from runtime CHType output.\nexport type ProjectionEnrichment = ${decoded(projectionOutput)};\n`);
  sameOrRefresh(join(snapshots, 'projection-enrichment-descriptors.json'), JSON.stringify(projectionOutput, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/projection-enrichment-corpus.ts'), `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport { projectionEnrichment } from '../../packages/compiler/test/fixtures/corpus/projection-enrichment.js';\nimport type { ProjectionEnrichment } from './snapshots/corpus/projection-enrichment-row.js';\nexpectTypeOf<Infer<typeof projectionEnrichment>>().toEqualTypeOf<ProjectionEnrichment>();\nexpectTypeOf<Infer<typeof projectionEnrichment>>().not.toBeAny();\n`);
  declarations.push([`projection-enrichment-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[3].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const coverage = JSON.parse(readFileSync(join(root, 'test/types/corpus-coverage.json'), 'utf8'));
  assert.equal(coverage.fullM3, false);
  assert.equal(new Set(coverage.entries.map(e => e.id)).size, coverage.entries.length, 'Duplicate coverage IDs');
  const covered = new Set(coverage.entries.flatMap(e => e.queries ?? []));
  const supported = [...Object.keys(descriptors).filter(k => k.startsWith('supported_')).map(k => k.slice('supported_'.length)), 'componentsLatest', 'projectionEnrichment'];
  assert.deepEqual([...covered].sort(), supported.sort(), 'Coverage ledger must name every supported query, and no nonexistent query');
  const manifest = JSON.parse(readFileSync(join(root, 'test/types/bench/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.queries.map(q => `bench_${q.name}`).sort(), Object.keys(descriptors).filter(k => k.startsWith('bench_')).sort());
  sameOrRefresh(join(snapshots, 'rows.d.ts'), rows);
  sameOrRefresh(join(snapshots, 'descriptors.json'), JSON.stringify(descriptors, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/corpus-types.ts'), assertions);
  const benchAssertions = "// Generated runtime correspondence for the isolated 200+2 bench.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport * as bench from './queries.js';\nimport type * as Snapshot from '../snapshots/corpus/rows.js';\n" + assertions.split('\n').filter(line => line.startsWith('expectTypeOf<Infer<typeof bench.')).join('\n') + '\n';
  sameOrRefresh(join(root, 'test/types/bench/correspondence.ts'), benchAssertions);
  console.log(`${Object.keys(descriptors).length} runtime-derived row snapshots; checking exact/not-any inference.`);
  // Compile exactly the checked-in correspondence assertions against published types.
  config.compilerOptions.noEmit = true;
  config.files = [join(root, 'test/types/corpus-types.ts'), join(root, 'test/types/components-latest-corpus.ts'), join(root, 'test/types/greatest.ts'), join(root, 'test/types/projection-enrichment-corpus.ts'), join(root, 'test/types/projection-enrichment.ts')];
  writeFileSync(configPath, JSON.stringify(config));
  run(['-p', configPath]);
  if (selfTest) {
    const stalePath = join(directory, 'stale.d.ts');
    writeFileSync(stalePath, rows + '// stale');
    assert.throws(() => verifySnapshot(stalePath, rows), /Stale snapshot/);
    assert.throws(() => readable('export declare const broken: import("@chql/core").Query<Infer<Row<X>>>;', 'synthetic.d.ts'), /Unreadable/);
    // Real compiler controls: mutate an expected field, then widen the inferred row.
    const probe = join(directory, 'control.ts');
    const row = 'supported_filterTenantActive';
    const prefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport { filterTenantActive } from ${JSON.stringify(join(root, files[0]).replace(/\.ts$/, '.js'))};\n`;
    for (const assertion of [
      `type Expected = ${decoded(descriptors[row]).replace('"tenantId": string', '"tenantId": number')};\nexpectTypeOf<Infer<typeof filterTenantActive>>().toEqualTypeOf<Expected>();`,
      `type Expected = ${decoded(descriptors[row])};\nexpectTypeOf<Infer<typeof filterTenantActive> | undefined>().toEqualTypeOf<Expected>();`,
    ]) {
      writeFileSync(probe, prefix + assertion);
      config.files = [probe];
      config.compilerOptions.rootDir = directory;
      delete config.compilerOptions.rootDir;
      writeFileSync(configPath, JSON.stringify(config));
      const failure = run(['-p', configPath], false);
      assert.notEqual(failure.status, 0);
      assert.match(failure.stdout, /control\.ts.*error TS/);
    }
    const latestPrefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport { componentsLatest } from ${JSON.stringify(join(root, files[2]).replace(/\.ts$/, '.js'))};\n`;
    for (const [from, to] of [['"asOf": Date', '"asOf": string'], ['"category": (string) | null', '"category": string']]) {
      const wrong = decoded(latestOutput).replace(from, to);
      assert.notEqual(wrong, decoded(latestOutput), 'Control must really mutate a descriptor-derived field');
      writeFileSync(probe, latestPrefix + `type Expected = ${wrong};\nexpectTypeOf<Infer<typeof componentsLatest>>().toEqualTypeOf<Expected>();`);
      const failure = run(['-p', configPath], false);
      assert.notEqual(failure.status, 0);
      assert.match(failure.stdout, /control\.ts.*error TS/);
    }
    const projectionPrefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@chql/core';\nimport { projectionEnrichment } from ${JSON.stringify(join(root, files[3]).replace(/\.ts$/, '.js'))};\n`;
    for (const [from, to] of [['"age": bigint', '"age": number'], ['"category": string', '"category": string | null'], ['"tier": string', '"tier": string | null']]) {
      const wrong = decoded(projectionOutput).replace(from, to);
      assert.notEqual(wrong, decoded(projectionOutput));
      writeFileSync(probe, projectionPrefix + `type Expected = ${wrong};\nexpectTypeOf<Infer<typeof projectionEnrichment>>().toEqualTypeOf<Expected>();`);
      const failure = run(['-p', configPath], false);
      assert.notEqual(failure.status, 0);
      assert.match(failure.stdout, /control\.ts.*error TS/);
    }
    console.log('Stale, descriptor-mismatch, inferred-widening, temporal/projection and unreadable-declaration controls passed.');
  }
  // Preserve both actual outputs even if the readability contract fails; do not bless them as readable.
  for (const [name, text] of declarations) sameOrRefresh(join(snapshots, name), text);
  for (const [name, text] of declarations) readable(text, name);
  console.log(`${Object.keys(descriptors).length + 2} exact/not-any runtime rows and emitted declarations passed (248 frozen + componentsLatest + projectionEnrichment).`);
} finally { rmSync(directory, { recursive: true, force: true }); }
