import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

export function compilerOutput(result) {
  return stripVTControlCharacters((result.stdout ?? '') + (result.stderr ?? ''));
}

export function assertCompilerExit(result, success) {
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'Compiler terminated by signal');
  assert.ok(Number.isInteger(result.status), 'Compiler must have a real exit status');
  if (success) assert.equal(result.status, 0, compilerOutput(result));
  else assert.notEqual(result.status, 0, 'Negative control must fail compilation');
}

export function assertControlDiagnostic(result, expected, cwd) {
  assertControlDiagnostics(result, [expected], cwd);
}

export function assertControlDiagnostics(result, expectedArray, cwd) {
  assertCompilerExit(result, false);
  assert.ok(expectedArray.length > 0, 'Expected at least one control diagnostic');
  const output = compilerOutput(result);
  const locationKey = (file, line, column) => JSON.stringify([file, line, column]);
  const remaining = new Map();
  for (const expected of expectedArray) {
    const key = locationKey(resolve(expected.file), expected.line, expected.column);
    assert.ok(!remaining.has(key), `Duplicate expected diagnostic location: ${key}`);
    remaining.set(key, expected);
  }

  // Count every diagnostic header, including warnings and unlocated/configuration
  // errors. They must fail validation, not disappear from the diagnostic count.
  const lines = output.split(/\r?\n/);
  const headers = [];
  for (const [index, line] of lines.entries()) {
    if (/\b(?:error|warning) TS\d+:/.test(line)) headers.push(index);
  }
  assert.equal(headers.length, expectedArray.length, `Expected exactly ${expectedArray.length} control diagnostics:\n${output}`);
  for (const [index, start] of headers.entries()) {
    const header = lines[start];
    const match = /^(.*?)(?:\((\d+),(\d+)\): |:(\d+):(\d+) - )error TS(\d+): (.*)$/.exec(header);
    assert.ok(match, `Unrecognized diagnostic header: ${header}`);
    const key = locationKey(resolve(cwd, match[1]), Number(match[2] ?? match[4]), Number(match[3] ?? match[5]));
    const expected = remaining.get(key);
    assert.ok(expected, `Unexpected or duplicate diagnostic location: ${header}`);
    assert.equal(Number(match[6]), expected.code, output);
    assert.match(match[7], expected.message);
    const block = lines.slice(start, headers[index + 1] ?? lines.length).join('\n');
    assert.match(block, expected.detail);
    remaining.delete(key);
  }
  assert.equal(remaining.size, 0, `Missing control diagnostics:\n${output}`);
}
