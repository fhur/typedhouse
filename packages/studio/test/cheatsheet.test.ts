import { describe, expect, it } from 'vitest';
import { parseCHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { editorScope, prepare, schemaScope } from '../server/eval.js';
import { CHEAT_SHEET, CHEAT_SHEET_TABLES } from '../server/llm.js';
import { createTypeService } from '../server/types.js';

// Every snippet the model is shown must pass what check_query enforces: 0 editor diagnostics and a compile.
const schema: DatabaseSchema = {
  functions: [],
  tables: CHEAT_SHEET_TABLES.map(([name, columns]) => ({
    name, engine: 'MergeTree', sortingKey: [], partitionKey: [], primaryKey: [],
    columns: columns.map(([c, t], i) => ({ name: c, type: parseCHType(t), position: i + 1, defaultKind: '', comment: '' })),
  })),
};
const types = createTypeService();
types.setSchema(schema);
const scope = editorScope(schemaScope(schema));
const example = "const query = from(events)\n  .where(o => o.status.eq('paid'))\n  .groupBy(o => ({ country: o.country }))\n  .aggregate(g => ({ orders: count(), revenue: sum(g.amount) }))\n  .orderBy(r => r.revenue.desc())\n\nexport default query";

describe('GUIDE cheat sheet', () => {
  it.each([...CHEAT_SHEET.map(s => [s.label, s.source] as const), ['Example', example] as const])('%s type-checks and compiles', (_label, source) => {
    expect(types.check(source).map(d => d.message)).toEqual([]);
    expect(() => prepare(source, scope, { autoLimit: false })).not.toThrow();
  });

  it('uniq over a UInt64 column is a type error (the old example), so it is not shown', () => {
    const t = createTypeService();
    t.setSchema({ functions: [], tables: [{ ...schema.tables[0]!, columns: [...schema.tables[0]!.columns, { name: 'uid', type: parseCHType('UInt64'), position: 99, defaultKind: '', comment: '' }] }] });
    expect(t.check('export default from(events).aggregate(g => ({ users: uniq(g.uid) }))').length).toBeGreaterThan(0);
    expect(CHEAT_SHEET.some(s => /uniq\(g\.(id|account_id)\)/.test(s.source))).toBe(false);
  });
});
