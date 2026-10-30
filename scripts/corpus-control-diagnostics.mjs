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
  assertCompilerExit(result, false);
  const output = compilerOutput(result);
  // Match every diagnostic header, including unlocated/configuration errors. Never
  // discard unrelated errors merely because the desired diagnostic also exists.
  const headers = output.split(/\r?\n/).filter(line => /\b(?:error|warning) TS\d+:/.test(line));
  assert.equal(headers.length, 1, `Expected exactly one control diagnostic:\n${output}`);
  const header = headers[0];
  const match = /^(.*?)(?:\((\d+),(\d+)\): |:(\d+):(\d+) - )error TS(\d+): (.*)$/.exec(header);
  assert.ok(match, `Unrecognized diagnostic header: ${header}`);
  assert.equal(resolve(cwd, match[1]), resolve(expected.file), output);
  assert.equal(Number(match[2] ?? match[4]), expected.line, output);
  assert.equal(Number(match[3] ?? match[5]), expected.column, output);
  assert.equal(Number(match[6]), expected.code, output);
  assert.match(match[7], expected.message);
  assert.match(output, expected.detail);
}
