import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const version = process.env.TYPEDHOUSE_TYPESCRIPT_VERSION;
const cli = version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc'];
let api;
if (!version) api = require('typescript');
else {
  const located = spawnSync('pnpm', ['--package', `typescript@${version}`, 'dlx', 'sh', '-c', 'command -v tsc'], { encoding: 'utf8' });
  if (located.status !== 0) throw new Error(located.stderr);
  const path = resolve(dirname(located.stdout.trim()), '../typescript/lib/typescript.js');
  if (existsSync(path)) api = require(path);
}
/** Every diagnostic is consumed exactly once, including line, code and message substring. */
function match(expected, diagnostics) {
  assert.equal(diagnostics.length, expected.length, `diagnostic count mismatch\n${JSON.stringify(diagnostics, null, 2)}`);
  for (const e of expected) {
    const matches = diagnostics.filter(d => d.file === e.file && d.line === e.line && d.code === e.code && d.message.includes(e.message));
    assert.equal(matches.length, 1, `missing/wrong diagnostic ${JSON.stringify(e)}\n${JSON.stringify(diagnostics, null, 2)}`);
  }
}
/** Retain indented overload/cause details, not just the generic first line. */
function parseCliDiagnostics(text) {
  const diagnostics = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
    if (m) diagnostics.push({ file: basename(m[1]), line: Number(m[2]), code: Number(m[4]), message: m[5] });
    else if (/^\s+\S/.test(line) && diagnostics.length) diagnostics.at(-1).message += `\n${line}`;
  }
  return diagnostics;
}
assert.deepEqual(parseCliDiagnostics('a.ts(4,1): error TS2769: No overload matches this call.\n  Wrong mode\nb.ts(3,1): error TS2345: Wrong state'), [
  { file: 'a.ts', line: 4, code: 2769, message: 'No overload matches this call.\n  Wrong mode' },
  { file: 'b.ts', line: 3, code: 2345, message: 'Wrong state' },
]);
const directory = mkdtempSync(join(tmpdir(), 'typedhouse-diagnostics-'));
try {
  mkdirSync(join(directory, 'node_modules/@typedhouse'), { recursive: true });
  symlinkSync(resolve('packages/core'), join(directory, 'node_modules/@typedhouse/core'), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const expected = [];
  const files = readdirSync('test/types/negative/expressions').filter(f => f.endsWith('.ts'));
  for (const file of files) {
    const source = readFileSync(join('test/types/negative/expressions', file), 'utf8');
    writeFileSync(join(directory, file), source);
    source.split('\n').forEach((line, index) => {
      // TS7 reports some argument failures as property diagnostics and prints
      // only the final overload. Each compiler still has one exact expectation.
      const annotation = !api?.createProgram && line.includes('// expect-ts7:') ? line.slice(line.indexOf('// expect-ts7:')).replace('// expect-ts7:', '// expect:') : line.split(' // expect-ts7:')[0];
      const m = annotation.match(/\/\/ expect: TS(\d+) (.+)$/);
      if (m) expected.push({ file, line: index + 1, code: Number(m[1]), message: m[2] });
    });
  }
  const config = { compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], skipLibCheck: false }, include: ['*.ts'] };
  if (process.argv.includes('--source')) {
    config.compilerOptions.paths = { '@typedhouse/core': [resolve('packages/core/src/index.ts')] };
  }
  console.log(`Checking ${process.argv.includes('--source') ? 'source' : 'built'} declarations.`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(config));
  let diagnostics;
  if (api?.createProgram) {
    const parsed = api.parseJsonConfigFileContent(config, api.sys, directory);
    const program = api.createProgram(parsed.fileNames, parsed.options);
    diagnostics = [...parsed.errors, ...api.getPreEmitDiagnostics(program)].map(d => ({ file: d.file ? basename(d.file.fileName) : '', line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0, code: d.code, message: api.flattenDiagnosticMessageText(d.messageText, '\n') }));
    console.log(`Precise diagnostics via TypeScript ${api.version} compiler API.`);
  } else {
    // TS7 removed the JS compiler API. Its CLI supplies equivalent source locations/codes/messages.
    const result = spawnSync('pnpm', [...cli, '--project', join(directory, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', timeout: 90000 });
    if (result.error || result.status === null) throw result.error ?? new Error('Compiler failed');
    const text = result.stdout + result.stderr;
    diagnostics = parseCliDiagnostics(text);
    if (result.status !== 0 && !diagnostics.length) throw new Error(text);
    console.log(`Precise diagnostics via selected TypeScript ${version} CLI (no compiler API).`);
  }
  match(expected, diagnostics);
  // Prove that missing, extra, wrong-code, wrong-line and wrong-message results cannot pass.
  assert.throws(() => match(expected, diagnostics.slice(1)));
  assert.throws(() => match(expected, [...diagnostics, diagnostics[0]]));
  for (const replacement of [{ code: 9999 }, { line: 9999 }, { message: 'unrelated error' }]) {
    assert.throws(() => match(expected, [{ ...diagnostics[0], ...replacement }, ...diagnostics.slice(1)]));
  }
  console.log(`${expected.length} precise expression diagnostics and matcher failure probes passed.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
