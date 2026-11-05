import { expect, it } from 'vitest';
import { parseCHType } from '@typedhouse/core';
import { renderSchema, type DatabaseSchema } from '../src/index.js';
import { declaredColumns, undeclaredColumns } from '../src/check.js';

// Slice 4f Tester probes for `check.ts` (parser of the renderSchema layout) and `hiddenColumns` rendering.
const t = (
  name: string,
  columns: string[],
  hiddenColumns?: string[],
): DatabaseSchema['tables'][number] => ({
  name,
  engine: 'MergeTree',
  sortingKey: [],
  partitionKey: [],
  primaryKey: [],
  columns: columns.map((c, i) => ({
    name: c,
    type: parseCHType('UInt8'),
    position: i + 1,
    defaultKind: '',
    comment: '',
  })),
  ...(hiddenColumns ? { hiddenColumns } : {}),
});

it('hostile names round-trip through renderSchema -> declaredColumns', () => {
  const hostile = [
    '`tick`',
    "it's",
    '"dq"',
    'line\nbreak',
    'cr\rlf',
    ' sep',
    'ünï😀',
    '\ud800',
    'class',
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
    '  x: col.UInt8,',
    '}, {',
    '\\',
    '',
  ];

  const schema: DatabaseSchema = {
    tables: [t('t\n"`', hostile, ['__proto__h', 'a\nb', '}, {', '])', 'constructor'])],
    functions: [],
  };

  const text = renderSchema(schema);

  expect([...declaredColumns(text).get('t\n"`')!].sort()).toEqual(
    [...hostile, '__proto__h', 'a\nb', '}, {', '])', 'constructor']
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort(),
  );

  expect(undeclaredColumns(schema, text)).toEqual([]);
});

it('hiddenColumns render order is the given order (introspect supplies position order)', () => {
  const a = renderSchema({ tables: [t('x', ['id'], ['b', 'a'])], functions: [] });
  expect(a).toContain('hiddenColumns: ["b","a"]');
});

it('D3 (check crash), flipped in 4f fix round 1: an entry with a valid JS escape that is invalid JSON is ignored, never thrown', () => {
  const edited =
    'const x = table("x", {\n  "a\\q": col.UInt8,\n  b: col.UInt8,\n}, { engine: "MergeTree" });\n';

  expect([...declaredColumns(edited).get('x')!]).toEqual(['b']); // 4f fix round 1: was SyntaxError
  const header = 'const x = table("x\\q", {\n  a: col.UInt8,\n}, { engine: "MergeTree" });\n';
  expect(declaredColumns(header).size).toBe(0); // 4f fix round 1: was SyntaxError; the table is skipped

  const brace =
    'const x = table("x", {\n  "\\u{1F600}": col.UInt8,\n}, { engine: "MergeTree" });\n';

  expect([...declaredColumns(brace).get('x')!]).toEqual([]); // 4f fix round 1: was SyntaxError
});

it('hand-edited layouts that are not the rendered form do not throw (silently ignored)', () => {
  for (const s of [
    "const x = table('x', {\n  a: col.UInt8,\n}, {});",
    'const x = table("x", {\n  a: col.UInt8,',
    'const x = table("x", {',
    '}, { hiddenColumns: [',
    '\0\n\r',
    'const x = table("x", {\n}, { hiddenColumns: ["a", }',
  ]) {
    expect(() => declaredColumns(s)).not.toThrow();
  }
});
