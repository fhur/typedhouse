import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await readFile(new URL('../public/sandbox/worker.js', import.meta.url), 'utf8');
const fixture = await build({ entryPoints: [new URL('../src/playground/examples.ts', import.meta.url).pathname], bundle: true, write: false, format: 'cjs' });
const fixtureModule = { exports: {} };
vm.runInNewContext(fixture.outputFiles[0].text, { module: fixtureModule });
function compile(source) {
  let result;
  const self = { postMessage(message) { result = message; } };
  vm.runInNewContext(bundle, { self, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder });
  self.onmessage({ data: source });
  return result;
}
for (const [name, source] of Object.entries(fixtureModule.exports.examples)) {
  const result = compile(source);
  assert.equal(result.ok, true, `${name}: ${result.text}`);
  const output = JSON.parse(result.text);
  assert.match(output.sql, /SELECT\n/);
  assert.match(output.sql, /\nFROM\n/);
  if (name === 'parameters') {
    assert.ok(!output.sql.includes('OR 1=1'));
    assert.ok(Object.values(output.params).includes("electronics' OR 1=1 --"));
  }
}
for (const source of [
  "import x from 'https://example.com/x.js'; export default x;",
  "export { x } from 'external';",
  "export default import('external');",
  'export default 42;',
  'export default ;',
  'x'.repeat(32_001),
]) {
  assert.equal(compile(source).ok, false, source.slice(0, 80));
}
const formatterBundle = await build({
  entryPoints: [new URL('../src/playground/format-sql.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'cjs',
});
const formatterModule = { exports: {} };
vm.runInNewContext(formatterBundle.outputFiles[0].text, { module: formatterModule });
const { formatSql } = formatterModule.exports;
const rawSql = "SELECT `odd name`, 'keep  two spaces', {p0:Array(Nullable(String))}, {p1:Tuple(UInt32, String)} FROM (SELECT * FROM `events` FINAL WHERE `id` = {p2:UInt32}) LIMIT 10";
const formattedSql = formatSql(rawSql);
assert.match(formattedSql, /SELECT\n  `odd name`,/);
for (const token of ["'keep  two spaces'", '{p0:Array(Nullable(String))}', '{p1:Tuple(UInt32, String)}', '{p2:UInt32}', '`events`']) {
  assert.ok(formattedSql.includes(token), `Formatting must preserve ${token}`);
}
assert.equal(formatSql(formattedSql), formattedSql, 'Formatting is idempotent');
const unsupported = "SELECT 'unterminated";
assert.equal(formatSql(unsupported), unsupported, 'Formatter failures preserve raw SQL');

const cache = new URL('../node_modules/.cache/typedhouse-docs-examples/', import.meta.url);
await mkdir(cache, { recursive: true });
const files = [];
for (const [name, source] of Object.entries(fixtureModule.exports.examples)) {
  const file = new URL(`${name}.ts`, cache);
  await writeFile(file, source);
  files.push(fileURLToPath(file));
}
const program = ts.createProgram(files, {
  strict: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  paths: { '@typedhouse/core': [fileURLToPath(new URL('../../../packages/core/src/index.ts', import.meta.url))] },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => '\n',
}));
console.log('Playground examples typecheck; compilation, parameter separation, and invalid input checks passed.');
