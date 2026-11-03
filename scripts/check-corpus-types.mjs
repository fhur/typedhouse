import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { assertCompilerExit, assertControlDiagnostic, assertControlDiagnostics, compilerOutput } from './corpus-control-diagnostics.mjs';
import { controlLayout } from './corpus-control-layout.mjs';
import { toTypeScript } from '../packages/core/dist/index.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = join(root, 'test/types/snapshots/corpus');
const refresh = process.argv.includes('--refresh');
const selfTest = process.argv.includes('--self-test');
const version = process.env.TYPEDHOUSE_TYPESCRIPT_VERSION;
const cli = [...(version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc'])];
const logRoot = join(root, 'node_modules/.cache/corpus-controls');
mkdirSync(logRoot, { recursive: true });
const logDirectory = mkdtempSync(join(logRoot, 'run-'));
console.log(`Raw corpus compiler logs: ${logDirectory}`);
let invocation = 0;
function run(args, success = true) {
  const result = spawnSync('pnpm', [...cli, ...args], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  const log = join(logDirectory, String(++invocation).padStart(3, '0'));
  writeFileSync(`${log}.stdout.log`, result.stdout ?? '');
  writeFileSync(`${log}.stderr.log`, result.stderr ?? '');
  writeFileSync(`${log}.json`, JSON.stringify({ cli, args, status: result.status, signal: result.signal, error: result.error?.message }, null, 2));
  if (args[0] === '-p') {
    const text = readFileSync(args[1], 'utf8');
    writeFileSync(`${log}.tsconfig.json`, text);
    for (const file of JSON.parse(text).files) {
      if (/^control-\d+\.ts$/.test(basename(file))) writeFileSync(`${log}.${basename(file)}`, readFileSync(file, 'utf8'));
    }
  }
  assertCompilerExit(result, success);
  return result;
}
const actualVersion = run(['--version']).stdout.trim().replace(/^Version /, '');
assert.match(actualVersion, /^\d+\.\d+\.\d+$/);
console.log(`Corpus official CLI TypeScript ${actualVersion}`);
const directory = mkdtempSync(join(tmpdir(), 'typedhouse-corpus-types-'));
let controlDirectory;
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
  mkdirSync(join(directory, 'node_modules/@typedhouse'), { recursive: true });
  symlinkSync(join(root, 'packages/core'), join(directory, 'node_modules/@typedhouse/core'), 'dir');
  symlinkSync(join(root, 'node_modules/expect-type'), join(directory, 'node_modules/expect-type'), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const files = ['packages/compiler/test/fixtures/corpus/supported-types.ts', 'test/types/bench/queries.ts', 'packages/compiler/test/fixtures/corpus/components-latest.ts', 'packages/compiler/test/fixtures/corpus/projection-enrichment.ts', 'packages/compiler/test/fixtures/corpus/known-functions.ts', 'packages/compiler/test/fixtures/corpus/sql-snippets.ts', 'test/types/insert-corpus.ts'];
  const config = { compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, incremental: false, skipLibCheck: false, types: [], declaration: true, rootDir: root, outDir: join(directory, 'emit'), paths: { '@typedhouse/core': [join(root, 'packages/core/dist/index.d.ts')] } }, files: files.map(f => join(root, f)) };
  const configPath = join(directory, 'tsconfig.json');
  writeFileSync(configPath, JSON.stringify(config));
  run(['-p', configPath]);
  run(['-p', configPath, '--emitDeclarationOnly']);
  let rows = '// Generated solely from ordered runtime CHType output; check-corpus-types.mjs.\n';
  let assertions = "// Generated exact/not-any correspondence to independently runtime-derived snapshots.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport * as supported from '../../packages/compiler/test/fixtures/corpus/supported-types.js';\nimport * as bench from './bench/queries.js';\nimport type * as Snapshot from './snapshots/corpus/rows.js';\n";
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
  const latestAssertions = `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { componentsLatest } from '../../packages/compiler/test/fixtures/corpus/components-latest.js';\nimport type { ComponentsLatest } from './snapshots/corpus/components-latest-row.js';\nexpectTypeOf<Infer<typeof componentsLatest>>().toEqualTypeOf<ComponentsLatest>();\nexpectTypeOf<Infer<typeof componentsLatest>>().not.toBeAny();\n`;
  sameOrRefresh(join(root, 'test/types/components-latest-corpus.ts'), latestAssertions);
  declarations.push([`components-latest-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[2].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const projectionModule = await import(pathToFileURL(join(directory, 'emit', files[3].replace(/\.ts$/, '.js'))).href);
  const projectionOutput = projectionModule.projectionEnrichment.ir.output;
  sameOrRefresh(join(snapshots, 'projection-enrichment-row.d.ts'), `// Generated from runtime CHType output.\nexport type ProjectionEnrichment = ${decoded(projectionOutput)};\n`);
  sameOrRefresh(join(snapshots, 'projection-enrichment-descriptors.json'), JSON.stringify(projectionOutput, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/projection-enrichment-corpus.ts'), `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { projectionEnrichment } from '../../packages/compiler/test/fixtures/corpus/projection-enrichment.js';\nimport type { ProjectionEnrichment } from './snapshots/corpus/projection-enrichment-row.js';\nexpectTypeOf<Infer<typeof projectionEnrichment>>().toEqualTypeOf<ProjectionEnrichment>();\nexpectTypeOf<Infer<typeof projectionEnrichment>>().not.toBeAny();\n`);
  declarations.push([`projection-enrichment-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[3].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const knownModule = await import(pathToFileURL(join(directory, 'emit', files[4].replace(/\.ts$/, '.js'))).href);
  let knownRows = '// Generated from runtime CHType output.\n';
  let knownAssertions = `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport * as queries from '../../packages/compiler/test/fixtures/corpus/known-functions.js';\nimport type * as Snapshot from './snapshots/corpus/known-functions-row.js';\n`;
  const knownDescriptors = {};
  for (const [name, query] of Object.entries(knownModule)) {
    knownDescriptors[name] = query.ir.output;
    knownRows += `export type ${name} = ${decoded(query.ir.output)};\n`;
    knownAssertions += `expectTypeOf<Infer<typeof queries.${name}>>().toEqualTypeOf<Snapshot.${name}>();\nexpectTypeOf<Infer<typeof queries.${name}>>().not.toBeAny();\n`;
  }
  sameOrRefresh(join(snapshots, 'known-functions-row.d.ts'), knownRows);
  sameOrRefresh(join(snapshots, 'known-functions-descriptors.json'), JSON.stringify(knownDescriptors, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/known-functions-corpus.ts'), knownAssertions);
  declarations.push([`known-functions-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[4].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const snippetModule = await import(pathToFileURL(join(directory, 'emit', files[5].replace(/\.ts$/, '.js'))).href);
  const snippetOutput = snippetModule.snippetDistance.ir.output;
  sameOrRefresh(join(snapshots, 'sql-snippets-row.d.ts'), `// Generated from runtime CHType output.\nexport type SnippetDistance = ${decoded(snippetOutput)};\n`);
  sameOrRefresh(join(snapshots, 'sql-snippets-descriptors.json'), JSON.stringify(snippetOutput, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/sql-snippets-corpus.ts'), `// Generated exact/not-any runtime correspondence.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { snippetDistance } from '../../packages/compiler/test/fixtures/corpus/sql-snippets.js';\nimport type { SnippetDistance } from './snapshots/corpus/sql-snippets-row.js';\nexpectTypeOf<Infer<typeof snippetDistance>>().toEqualTypeOf<SnippetDistance>();\nexpectTypeOf<Infer<typeof snippetDistance>>().not.toBeAny();\n`);
  declarations.push([`sql-snippets-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[5].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  // Commands have no relational output: snapshot their actual public declarations separately.
  declarations.push([`insert-${actualVersion}.d.ts`, readFileSync(join(directory, 'emit', files[6].replace(/\.ts$/, '.d.ts')), 'utf8')]);
  const coverage = JSON.parse(readFileSync(join(root, 'test/types/corpus-coverage.json'), 'utf8'));
  assert.equal(coverage.fullM3, false);
  assert.equal(new Set(coverage.entries.map(e => e.id)).size, coverage.entries.length, 'Duplicate coverage IDs');
  const covered = new Set(coverage.entries.flatMap(e => e.queries ?? []));
  const supported = [...Object.keys(descriptors).filter(k => k.startsWith('supported_')).map(k => k.slice('supported_'.length)), 'componentsLatest', 'projectionEnrichment', ...Object.keys(knownModule), 'snippetDistance'];
  assert.deepEqual([...covered].sort(), supported.sort(), 'Coverage ledger must name every supported query, and no nonexistent query');
  const manifest = JSON.parse(readFileSync(join(root, 'test/types/bench/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.queries.map(q => `bench_${q.name}`).sort(), Object.keys(descriptors).filter(k => k.startsWith('bench_')).sort());
  sameOrRefresh(join(snapshots, 'rows.d.ts'), rows);
  sameOrRefresh(join(snapshots, 'descriptors.json'), JSON.stringify(descriptors, null, 2) + '\n');
  sameOrRefresh(join(root, 'test/types/corpus-types.ts'), assertions);
  const benchAssertions = "// Generated runtime correspondence for the isolated 200+2 bench.\nimport { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport * as bench from './queries.js';\nimport type * as Snapshot from '../snapshots/corpus/rows.js';\n" + assertions.split('\n').filter(line => line.startsWith('expectTypeOf<Infer<typeof bench.')).join('\n') + '\n';
  sameOrRefresh(join(root, 'test/types/bench/correspondence.ts'), benchAssertions);
  console.log(`${Object.keys(descriptors).length} runtime-derived row snapshots; checking exact/not-any inference.`);
  // Compile exactly the checked-in correspondence assertions against published types.
  config.compilerOptions.noEmit = true;
  config.files = [join(root, 'test/types/corpus-types.ts'), join(root, 'test/types/components-latest-corpus.ts'), join(root, 'test/types/greatest.ts'), join(root, 'test/types/projection-enrichment-corpus.ts'), join(root, 'test/types/projection-enrichment.ts'), join(root, 'test/types/known-functions-corpus.ts'), join(root, 'test/types/known-functions.ts'), join(root, 'test/types/sql-snippets-corpus.ts'), join(root, 'test/types/sql-snippets.ts')];
  writeFileSync(configPath, JSON.stringify(config));
  run(['-p', configPath]);
  if (selfTest) {
    const stalePath = join(directory, 'stale.d.ts');
    writeFileSync(stalePath, rows + '// stale');
    assert.throws(() => verifySnapshot(stalePath, rows), /Stale snapshot/);
    assert.throws(() => readable('export declare const broken: import("@typedhouse/core").Query<Infer<Row<X>>>;', 'synthetic.d.ts'), /Unreadable/);
    assertCompilerExit(spawnSync(process.execPath, [join(root, 'scripts/corpus-control-diagnostics.test.mjs')], { encoding: 'utf8' }), true);
    assertCompilerExit(spawnSync(process.execPath, [join(root, 'scripts/corpus-control-layout.test.mjs')], { encoding: 'utf8' }), true);
    // Controls stay outside node_modules, on the repository filesystem. Preserve
    // the explicit built-declaration paths mapping, not source consumption.
    // The external emit/runtime consumer above remains in OS temp unchanged.
    const layout = controlLayout(root);
    controlDirectory = mkdtempSync(layout.prefix);
    const configPath = join(controlDirectory, 'tsconfig.json');
    config.compilerOptions.rootDir = layout.rootDir;
    const controls = [];
    function addControl(prefix, query, correct, wrong, widen = false) {
      const probe = join(controlDirectory, `control-${String(controls.length + 1).padStart(2, '0')}.ts`);
      const assertion = `expectTypeOf<Infer<typeof ${query}>>().toEqualTypeOf<Expected>();`;
      const positive = prefix + `type Expected = ${correct};\n` + assertion;
      const negativeAssertion = widen ? assertion.replace('>>()', '> | undefined>()') : assertion;
      assert.ok(widen || correct !== wrong, 'Control must mutate a descriptor-derived field');
      const negative = prefix + `type Expected = ${wrong};\n` + negativeAssertion;
      const expected = { file: probe, line: 5, column: negativeAssertion.indexOf('<Expected>') + 2, code: 2344, message: /Type 'Expected' does not satisfy the constraint/, detail: /Expected:|Actual:/ };
      const control = { positive, negative, expected };
      controls.push(control);
      return control;
    }
    const row = 'supported_filterTenantActive';
    const prefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { filterTenantActive } from ${JSON.stringify(join(root, files[0]).replace(/\.ts$/, '.js'))};\n`;
    const correctRow = decoded(descriptors[row]);
    const first = addControl(prefix, 'filterTenantActive', correctRow, correctRow.replace('"tenantId": string', '"tenantId": number'));
    addControl(prefix, 'filterTenantActive', correctRow, correctRow, true);
    const latestPrefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { componentsLatest } from ${JSON.stringify(join(root, files[2]).replace(/\.ts$/, '.js'))};\n`;
    for (const [from, to] of [['"asOf": Date', '"asOf": string'], ['"category": (string) | null', '"category": string']]) {
      const wrong = decoded(latestOutput).replace(from, to);
      addControl(latestPrefix, 'componentsLatest', decoded(latestOutput), wrong);
    }
    const projectionPrefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { projectionEnrichment } from ${JSON.stringify(join(root, files[3]).replace(/\.ts$/, '.js'))};\n`;
    for (const [from, to] of [['"age": bigint', '"age": number'], ['"category": string', '"category": string | null'], ['"tier": string', '"tier": string | null']]) {
      const wrong = decoded(projectionOutput).replace(from, to);
      addControl(projectionPrefix, 'projectionEnrichment', decoded(projectionOutput), wrong);
    }
    const knownPrefix = `import { expectTypeOf } from 'expect-type';\nimport type { Infer } from '@typedhouse/core';\nimport { knownHash } from ${JSON.stringify(join(root, files[4]).replace(/\.ts$/, '.js'))};\n`;
    const wrongKnown = decoded(knownDescriptors.knownHash).replace('bigint', 'number');
    addControl(knownPrefix, 'knownHash', decoded(knownDescriptors.knownHash), wrongKnown);
    // Every control is an independent module. Compile all positives first, then
    // require exactly one intended diagnostic per negative module (no extras).
    config.files = controls.map(control => control.expected.file);
    writeFileSync(configPath, JSON.stringify(config));
    for (const control of controls) writeFileSync(control.expected.file, control.positive);
    run(['-p', configPath]);
    for (const control of controls) writeFileSync(control.expected.file, control.negative);
    assertControlDiagnostics(run(['-p', configPath], false), controls.map(control => control.expected), root);
    // A real broken-rootDir positive must not masquerade as a mismatch control.
    writeFileSync(first.expected.file, first.positive);
    config.files = [first.expected.file];
    config.compilerOptions.rootDir = controlDirectory;
    writeFileSync(configPath, JSON.stringify(config));
    const brokenRoot = run(['-p', configPath], false);
    assert.match(compilerOutput(brokenRoot), /error TS6059:/);
    assert.doesNotMatch(compilerOutput(brokenRoot), /error TS2344:/);
    assert.throws(() => assertControlDiagnostic(brokenRoot, first.expected, root));
    console.log('Stale, descriptor-mismatch, inferred-widening, temporal/projection/known and unreadable-declaration controls passed.');
  }
  // Preserve both actual outputs even if the readability contract fails; do not bless them as readable.
  for (const [name, text] of declarations) sameOrRefresh(join(snapshots, name), text);
  for (const [name, text] of declarations) readable(text, name);
  console.log(`${Object.keys(descriptors).length + 3 + Object.keys(knownModule).length} exact/not-any runtime rows and emitted declarations passed (custom extensions removed by owner scope decision).`);
} finally {
  try {
    if (controlDirectory) rmSync(controlDirectory, { recursive: true, force: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
