import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  assertCompilerExit,
  assertControlDiagnostic,
  assertControlDiagnostics,
} from './corpus-control-diagnostics.mjs';

const expected = {
  file: '/consumer/control.ts',
  line: 5,
  column: 64,
  code: 2344,
  message: /Type 'Expected' does not satisfy the constraint/,
  detail: /Expected: number, Actual: string/,
};

const message =
  "Type 'Expected' does not satisfy the constraint '{ tenantId: string; }'.\n  Type 'number' is not assignable to type '\"Expected: number, Actual: string\"'.\n";

const plain = `/consumer/control.ts(5,64): error TS2344: ${message}`;

const pretty = `\x1b[96m/consumer/control.ts\x1b[0m:\x1b[93m5\x1b[0m:\x1b[93m64\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2344: \x1b[0m${message}`;

const result = (stdout, stderr = '') => ({ stdout, stderr, status: 1, signal: null });

for (const text of [
  plain,
  pretty,
  plain.replaceAll('\n', '\r\n'),
  pretty.replaceAll('\n', '\r\n'),
]) {
  assertControlDiagnostic(result(text), expected, '/consumer');
  assertControlDiagnostic(result('', text), expected, '/consumer');
  const split = text.indexOf("Type 'Expected'");
  assert.ok(split > 0);
  assertControlDiagnostic(result(text.slice(0, split), text.slice(split)), expected, '/consumer');

  for (const wrong of [
    text.replace('TS2344', 'TS6059'),
    text.replace('control.ts', 'other.ts'),
    text.replace('5', '6'),
    text.replace('64', '65'),
    text.replace("Type 'Expected'", "Type 'Unrelated'"),
    text.replace('Expected: number, Actual: string', 'unrelated'),
  ]) {
    assert.throws(() => assertControlDiagnostic(result(wrong), expected, '/consumer'));
  }

  for (const newline of ['\n', '\r\n']) {
    assert.throws(() =>
      assertControlDiagnostic(
        result(text, `error TS6059: unrelated rootDir failure${newline}`),
        expected,
        '/consumer',
      ),
    );

    assert.throws(() =>
      assertControlDiagnostic(
        result(text, `\x1b[91merror\x1b[0m TS6059: unrelated rootDir failure${newline}`),
        expected,
        '/consumer',
      ),
    );
  }

  assert.throws(() =>
    assertControlDiagnostic({ ...result(text), status: 0 }, expected, '/consumer'),
  );

  assert.throws(() =>
    assertControlDiagnostic({ ...result(text), status: null }, expected, '/consumer'),
  );

  assert.throws(() =>
    assertControlDiagnostic({ ...result(text), signal: 'SIGTERM' }, expected, '/consumer'),
  );

  const error = new Error('spawn failed');

  assert.throws(
    () => assertControlDiagnostic({ ...result(text), error }, expected, '/consumer'),
    e => e === error,
  );
}

assert.throws(() =>
  assertControlDiagnostic(result('\x1b[91mno diagnostics\x1b[0m'), expected, '/consumer'),
);

// Real child statuses are authoritative, not inferred from diagnostic-looking text.
const zero = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(plain)})`], {
  encoding: 'utf8',
});

assertCompilerExit(zero, true);
assert.throws(() => assertControlDiagnostic(zero, expected, '/consumer'));

const failure = spawnSync(
  process.execPath,
  ['-e', `process.stderr.write(${JSON.stringify(pretty)}); process.exitCode = 2`],
  { encoding: 'utf8' },
);

assert.equal(failure.status, 2);
assertControlDiagnostic(failure, expected, '/consumer');
const missing = spawnSync('/nonexistent/chql-compiler', [], { encoding: 'utf8' });

assert.throws(
  () => assertCompilerExit(missing, false),
  e => e === missing.error,
);

const sibling = {
  file: '/consumer/sibling.ts',
  line: 8,
  column: 12,
  code: 2322,
  message: /Sibling mismatch/,
  detail: /sibling-only detail/,
};

const siblingPlain = 'sibling.ts(8,12): error TS2322: Sibling mismatch\n  sibling-only detail\n';

const siblingPretty =
  '\x1b[96msibling.ts\x1b[0m:\x1b[93m8\x1b[0m:\x1b[93m12\x1b[0m - \x1b[91merror\x1b[0m TS2322: Sibling mismatch\n  sibling-only detail\n';

const batch = [expected, sibling];

const framedPretty = `${pretty}
\x1b[7m5\x1b[0m expectTypeOf<Infer<typeof query>>().toEqualTypeOf<Expected>();
\x1b[7m \x1b[0m                                                 \x1b[91m~~~~~~~~\x1b[0m

  \x1b[96mtypes.d.ts\x1b[0m:\x1b[93m2\x1b[0m:\x1b[93m3\x1b[0m
    The expected type comes from this constraint.

${siblingPretty}
\x1b[7m8\x1b[0m const mismatch: string = 1;
\x1b[7m \x1b[0m       \x1b[91m~~~~~~~~\x1b[0m

Found 2 errors in 2 files.

Errors  Files
     1  /consumer/control.ts:5
     1  sibling.ts:8
`;

assertControlDiagnostics(result(framedPretty), batch, '/consumer');
assertControlDiagnostics(result(framedPretty.replaceAll('\n', '\r\n')), batch, '/consumer');

const checkBatch = (child, expectations = batch) =>
  assertControlDiagnostics(child, expectations, '/consumer');

assert.throws(() => checkBatch(result(''), []), /at least one control/);

for (const [first, second] of [
  [plain, siblingPlain],
  [pretty, siblingPretty],
  [plain, siblingPretty],
  [pretty, siblingPlain],
]) {
  for (const newline of ['\n', '\r\n']) {
    const a = first.replaceAll('\n', newline);
    const b = second.replaceAll('\n', newline);

    for (const [left, right] of [
      [a, b],
      [b, a],
    ]) {
      const text = left + right;

      for (const child of [result(text), result('', text), result(left, right)]) {
        checkBatch(child);
        checkBatch(child, [sibling, expected]);
      }

      for (const status of [0, null, undefined, '1', NaN, 1.5]) {
        assert.throws(() => checkBatch({ ...result(text), status }));
      }

      assert.throws(() => checkBatch({ ...result(text), signal: 'SIGTERM' }));
      const error = new Error('batch spawn failed');

      assert.throws(
        () => checkBatch({ ...result(text), error }),
        e => e === error,
      );
    }

    for (const wrong of [
      b.replace('TS2322', 'TS2344'),
      b.replace('sibling.ts', 'other.ts'),
      b.replace('sibling.ts', '/elsewhere/sibling.ts'),
      b.replace('8', '9'),
      b.replace('12', '13'),
      b.replace('Sibling mismatch', 'Wrong message'),
      b.replace('sibling-only detail', 'Wrong detail'),
      b.replace('error', 'warning'),
    ]) {
      assert.throws(() => checkBatch(result(a + wrong)));
      assert.throws(() => checkBatch(result(wrong + a)));
    }

    for (const unrelated of [
      `error TS6059: unrelated rootDir failure${newline}`,
      `warning TS1234: unrelated global warning${newline}`,
      `\x1b[91merror\x1b[0m TS5023: unknown compiler option${newline}`,
      `elsewhere.ts(1,1): error TS2344: unrelated${newline}`,
      `elsewhere.ts:1:1 - warning TS2344: unrelated${newline}`,
    ]) {
      assert.throws(() => checkBatch(result(a + b + unrelated)));
      // Equal counts must not let an unlocated error or warning substitute for a control.
      assert.throws(() => checkBatch(result(a + unrelated)));
    }

    for (const text of ['', a, b, a + a, b + b, a + b + a]) {
      assert.throws(() => checkBatch(result(text)));
    }

    // Details in either adjacent diagnostic must not satisfy this one's expectation.
    const missingDetail = a.replace('Expected: number, Actual: string', 'missing detail');
    const borrowingSibling = b + `  Expected: number, Actual: string${newline}`;
    assert.throws(() => checkBatch(result(missingDetail + borrowingSibling)));
    assert.throws(() => checkBatch(result(borrowingSibling + missingDetail)));

    assert.throws(() =>
      checkBatch(result(`Expected: number, Actual: string${newline}` + missingDetail + b)),
    );

    // The message must match the header, even if a continuation has the right text.
    const missingMessage =
      a.replace("Type 'Expected'", "Type 'Wrong'") +
      `  Type 'Expected' does not satisfy the constraint${newline}`;

    assert.throws(() => checkBatch(result(missingMessage + b)));
  }
}

for (const duplicate of [
  expected,
  { ...expected, code: 9999 },
  { ...expected, file: '/consumer/./control.ts' },
]) {
  assert.throws(
    () => checkBatch(result(plain + plain), [expected, duplicate]),
    /Duplicate expected diagnostic location/,
  );
}

// The singular wrapper also supports the deliberately broken rootDir control.
const rootDir = {
  file: '/consumer/index.ts',
  line: 1,
  column: 15,
  code: 6059,
  message: /not under 'rootDir'/,
  detail: /outside.ts/,
};

assertControlDiagnostic(
  result("index.ts(1,15): error TS6059: File '/outside.ts' is not under 'rootDir' '/consumer'.\n"),
  rootDir,
  '/consumer',
);

const batchFailure = spawnSync(
  process.execPath,
  [
    '-e',
    `process.stdout.write(${JSON.stringify(siblingPlain)}); process.stderr.write(${JSON.stringify(pretty)}); process.exitCode = 2`,
  ],
  { encoding: 'utf8' },
);

checkBatch(batchFailure);

assert.throws(
  () => checkBatch(missing),
  e => e === missing.error,
);

console.log(
  'Corpus diagnostic matcher: singular/batch plain/colored LF/CRLF stdout/stderr, reordered exact diagnostics, isolated details and real exit controls passed.',
);
