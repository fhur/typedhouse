import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { parseCHType } from '@typedhouse/core';
import { renderSchema } from '../src/render.js';

it.each([false, true])('generated DEFAULT/ALIAS/MATERIALIZED metadata retains exact insert types (skip alias: %s)', skipAlias => {
  const directory = mkdtempSync(join(tmpdir(), 'typedhouse-insert-types-'));
  try {
    const columns = [
      { name: 'id', type: 'UInt64', defaultKind: '' },
      { name: 'nullable', type: 'Nullable(String)', defaultKind: '' },
      { name: 'label', type: 'String', defaultKind: 'DEFAULT' },
      { name: 'alias', type: 'UInt64', defaultKind: 'ALIAS' },
      { name: 'materialized', type: 'UInt64', defaultKind: 'MATERIALIZED' },
    ].filter(c => !skipAlias || c.defaultKind !== 'ALIAS').map((c, i) => ({ ...c, type: parseCHType(c.type), position: i + 1, comment: '' }));
    writeFileSync(join(directory, 'schema.ts'), renderSchema({ tables: [{ name: 'target', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns, ...(skipAlias ? { hiddenColumns: ['alias'] } : {}) }], functions: [] }));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    const source = `import { from, type InsertRow } from '@typedhouse/core';
import { db } from './schema.js';
type Row = InsertRow<typeof db.target>;
const omitted: Row = { id: 1n, nullable: null };
const supplied: Row = { id: 2n, nullable: 'x', label: 'provided' };
from(db.target).insertMany([omitted, supplied]);
const missing: Row = { id: 1n };
const wrong: Row = { id: 1, nullable: null };
from(db.target).insertMany([{ ...omitted, alias: 1n }]);
from(db.target).insertMany([{ ...omitted, materialized: 1n }]);
const undefinedDefault: Row = { ...omitted, label: undefined };
`;
    const file = join(directory, 'consumer.ts');
    writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, exactOptionalPropertyTypes: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], paths: { '@typedhouse/core': [resolve('packages/core/src/index.ts')] } });
    const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ({ file: d.file?.fileName, line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }));
    expect(diagnostics.map(d => [d.file, d.line, d.code])).toEqual([[file, 7, 2322], [file, 8, 2322], [file, 9, 2322], [file, 10, 2322], [file, 11, 2375]]);
    for (const [index, text] of ["Property 'nullable' is missing", "Type 'number' is not assignable to type 'bigint'", "is not assignable to type 'never'", "is not assignable to type 'never'", "Type 'undefined' is not assignable to type 'string'"].entries()) expect(diagnostics[index]!.message).toContain(text);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
