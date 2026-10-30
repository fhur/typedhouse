import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertCompilerExit, assertControlDiagnostic } from './corpus-control-diagnostics.mjs';

const expected = { file: '/consumer/control.ts', line: 5, column: 64, code: 2344, message: /Type 'Expected' does not satisfy the constraint/, detail: /Expected: number, Actual: string/ };
const message = "Type 'Expected' does not satisfy the constraint '{ tenantId: string; }'.\n  Type 'number' is not assignable to type '\"Expected: number, Actual: string\"'.\n";
const plain = `/consumer/control.ts(5,64): error TS2344: ${message}`;
const pretty = `\x1b[96m/consumer/control.ts\x1b[0m:\x1b[93m5\x1b[0m:\x1b[93m64\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2344: \x1b[0m${message}`;
const result = (stdout, stderr = '') => ({ stdout, stderr, status: 1, signal: null });
for (const text of [plain, pretty, plain.replaceAll('\n', '\r\n'), pretty.replaceAll('\n', '\r\n')]) {
  assertControlDiagnostic(result(text), expected, '/consumer');
  assertControlDiagnostic(result('', text), expected, '/consumer');
  const split = text.indexOf("Type 'Expected'");
  assert.ok(split > 0);
  assertControlDiagnostic(result(text.slice(0, split), text.slice(split)), expected, '/consumer');
  for (const wrong of [text.replace('TS2344', 'TS6059'), text.replace('control.ts', 'other.ts'), text.replace('5', '6'), text.replace('64', '65'), text.replace("Type 'Expected'", "Type 'Unrelated'"), text.replace('Expected: number, Actual: string', 'unrelated')]) {
    assert.throws(() => assertControlDiagnostic(result(wrong), expected, '/consumer'));
  }
  for (const newline of ['\n', '\r\n']) {
    assert.throws(() => assertControlDiagnostic(result(text, `error TS6059: unrelated rootDir failure${newline}`), expected, '/consumer'));
    assert.throws(() => assertControlDiagnostic(result(text, `\x1b[91merror\x1b[0m TS6059: unrelated rootDir failure${newline}`), expected, '/consumer'));
  }
  assert.throws(() => assertControlDiagnostic({ ...result(text), status: 0 }, expected, '/consumer'));
  assert.throws(() => assertControlDiagnostic({ ...result(text), status: null }, expected, '/consumer'));
  assert.throws(() => assertControlDiagnostic({ ...result(text), signal: 'SIGTERM' }, expected, '/consumer'));
  const error = new Error('spawn failed');
  assert.throws(() => assertControlDiagnostic({ ...result(text), error }, expected, '/consumer'), e => e === error);
}
assert.throws(() => assertControlDiagnostic(result('\x1b[91mno diagnostics\x1b[0m'), expected, '/consumer'));
// Real child statuses are authoritative, not inferred from diagnostic-looking text.
const zero = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(plain)})`], { encoding: 'utf8' });
assertCompilerExit(zero, true);
assert.throws(() => assertControlDiagnostic(zero, expected, '/consumer'));
const failure = spawnSync(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(pretty)}); process.exitCode = 2`], { encoding: 'utf8' });
assert.equal(failure.status, 2);
assertControlDiagnostic(failure, expected, '/consumer');
const missing = spawnSync('/nonexistent/chql-compiler', [], { encoding: 'utf8' });
assert.throws(() => assertCompilerExit(missing, false), e => e === missing.error);
console.log('Corpus diagnostic matcher: plain/colored LF/CRLF stdout/stderr, exact diagnostics, unrelated errors and real exit controls passed.');
