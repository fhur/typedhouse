import { describe, expect, it } from 'vitest';
import { parseCHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { AUTO_LIMIT, editorScope, evaluate, prepare, schemaScope, StudioError } from '../server/eval.js';
import { matchShortcut } from '../web/keymap.js';

const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
const schema: DatabaseSchema = {
  functions: [],
  tables: [
    { name: 'events', engine: 'MergeTree', sortingKey: ['ts'], partitionKey: [], primaryKey: ['ts'], columns: [
      column('ts', 'DateTime', 1), column('country', 'LowCardinality(String)', 2), column('amount', 'Float64', 3), column('user_id', 'UInt64', 4), column('note', 'Nullable(String)', 5),
    ] },
    { name: 'odd-name', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns: [column('id', 'UInt32', 1)] },
  ],
};
const scope = editorScope(schemaScope(schema));

function failure(fn: () => unknown): StudioError {
  try { fn(); } catch (error) { if (error instanceof StudioError) return error; throw error; }
  throw new Error('expected a StudioError');
}

describe('evaluate', () => {
  it('runs a query with tables and core in scope, no imports', () => {
    const p = prepare(`const query = from(events).where(e => e.country.eq('DE')).map(e => ({ country: e.country, amount: e.amount }))`, scope, { autoLimit: false });
    expect(p.compiled.sql).toContain('`events`');
    expect(Object.values(p.compiled.params)).toEqual(['DE']);
    expect(p.columns).toEqual([{ name: 'country', path: ['country'], type: 'LowCardinality(String)' }, { name: 'amount', path: ['amount'], type: 'Float64' }]);
    expect(p.limit).toBeUndefined();
  });

  it('accepts export default, export const query, core imports and sanitized table bindings', () => {
    expect(evaluate(`import { from as f } from '@typedhouse/core';\nexport default f(odd_name)`, scope).ir.kind).toBe('Scan');
    expect(evaluate(`export const query = from(db['odd-name'])`, scope).ir.kind).toBe('Scan');
    // Editor code may redeclare a scope name.
    expect(evaluate(`const events = 1;\nexport default from(odd_name)`, scope).ir.kind).toBe('Scan');
  });

  it('prints the row type', () => {
    const p = prepare(`export default from(events).groupBy(e => ({ country: e.country })).aggregate(g => ({ orders: count(), revenue: sum(g.amount), last: max(g.ts) }))`, scope, { autoLimit: false });
    expect(p.rowType).toBe('{ country: string; orders: bigint; revenue: number; last: Date }');
    expect(prepare('export default from(events).map(e => ({ note: e.note, id: e.user_id }))', scope, { autoLimit: false }).rowType).toBe('{ note: (string) | null; id: bigint }');
  });

  it('rejects non-core imports, dynamic import and require at parse', () => {
    for (const source of [`import fs from 'node:fs';\nexport default from(events)`, `const m = import('node:fs');\nexport default from(events)`, `const fs = require('node:fs');\nexport default from(events)`, `export * from 'node:fs'`]) {
      expect(failure(() => evaluate(source, scope)).stage).toBe('parse');
    }
  });

  it('reports syntax errors at parse with a position', () => {
    const error = failure(() => evaluate(`export default from(events).map(e => ({ a: e.ts }`, scope));
    expect(error.stage).toBe('parse');
    expect(error.message).toMatch(/^1:\d+ /);
  });

  it('stops a runaway loop with a timeout', () => {
    const error = failure(() => evaluate(`while (true) {}\nexport default from(events)`, scope, 200));
    expect(error).toMatchObject({ stage: 'evaluate', message: 'Evaluation timed out after 200 ms.' });
    // Callbacks run during evaluation too.
    expect(failure(() => evaluate(`export default from(events).where(e => { for (;;) {} })`, scope, 200)).stage).toBe('evaluate');
    // Still usable afterwards.
    expect(evaluate('export default from(events)', scope).ir.kind).toBe('Scan');
  });

  it('does not expose process or timers to editor code', () => {
    expect(failure(() => evaluate(`process.exit(1)`, scope)).stage).toBe('evaluate');
    expect(failure(() => evaluate(`setTimeout(() => {}, 0)`, scope)).message).toMatch(/not a function/);
  });

  it('reports runtime errors, missing queries and wrong values at evaluate', () => {
    expect(failure(() => evaluate(`export default from(nope)`, scope))).toMatchObject({ stage: 'evaluate', message: 'nope is not defined' });
    expect(failure(() => evaluate(`const x = 1`, scope)).message).toMatch(/No query found/);
    expect(failure(() => evaluate(`export default from(events).groupBy(e => ({ c: e.country }))`, scope)).message).toMatch(/GroupedQuery.*aggregate/);
  });

  it('reports compiler failures at compile', () => {
    const error = failure(() => prepare(`export default from(events).where(e => e.user_id.eq(-1))`, scope, { autoLimit: false }));
    expect(error.stage).toBe('compile');
  });
});

describe('auto-limit', () => {
  it('shows LIMIT 100 in SQL and executes one extra row so `limited` is exact', () => {
    const p = prepare('export default from(events)', scope, { autoLimit: true });
    expect(p.limit).toBe(AUTO_LIMIT);
    expect(p.compiled.sql).toMatch(/LIMIT 100\s*$/);
    expect(p.execute.ir).toMatchObject({ kind: 'Limit', n: AUTO_LIMIT + 1 });
  });

  it('composes over a user limit', () => {
    const p = prepare('export default from(events).orderBy(e => e.ts).limit(5)', scope, { autoLimit: true });
    expect(p.execute.ir).toMatchObject({ kind: 'Limit', n: 101, input: { kind: 'Limit', n: 5 } });
    expect(p.compiled.sql).toMatch(/LIMIT/);
  });

  it('is absent when off', () => {
    const p = prepare('export default from(events)', scope, { autoLimit: false });
    expect(p.compiled.sql).not.toMatch(/LIMIT/);
    expect(p.execute.ir.kind).toBe('Scan');
  });
});

describe('keymap', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = { metaKey: true }) =>
    matchShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  it('maps ⌘ and Ctrl shortcuts', () => {
    expect(key('Enter')).toBe('run');
    expect(key('Enter', { ctrlKey: true })).toBe('run');
    expect(key('/')).toBe('toggleLimit');
    expect(key('1')).toBe('tabTable');
    expect(key('3', { ctrlKey: true })).toBe('tabSql');
    expect(key('L')).toBe('focusPrompt');
    expect(key('Enter', {})).toBeUndefined();
    expect(key('x')).toBeUndefined();
  });
});
