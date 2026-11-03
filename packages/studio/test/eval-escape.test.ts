// Tester (S1): editor code must not be able to hang or kill the server process after `evaluate`
// returns. Each case runs in a child process so a hang or crash cannot take the test runner down.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

/** Evaluates `source` the way query.run does, then checks the event loop is still alive 300 ms later. */
function survive(source: string) {
  const script = `
    import { editorScope, prepare } from './server/eval.ts';
    const scope = editorScope({});
    try { prepare(${JSON.stringify(source)}, scope, { autoLimit: true, timeoutMs: 300 }); } catch {}
    setTimeout(() => { console.log('ALIVE'); process.exit(0); }, 300);
  `;
  const child = spawnSync(tsx, ['--eval', script], { cwd: root, encoding: 'utf8', timeout: 8_000 });
  return { alive: child.stdout.includes('ALIVE'), timedOut: child.error !== undefined || child.signal !== null, status: child.status, stderr: child.stderr.slice(0, 300) };
}

const t = `const t = table('x', { id: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });\n`;

describe('editor code cannot outlive evaluation', { timeout: 20_000 }, () => {
  it('baseline: a normal query leaves the process alive', () => {
    expect(survive(`${t}export default from(t)`)).toMatchObject({ alive: true });
  });

  it('a runaway loop scheduled as a microtask does not hang the process', () => {
    expect(survive(`${t}Promise.resolve().then(() => { for (;;) {} });\nexport default from(t)`)).toMatchObject({ alive: true });
  });

  it('a runaway loop after await in an async function does not hang the process', () => {
    expect(survive(`${t}(async () => { await 0; for (;;) {} })();\nexport default from(t)`)).toMatchObject({ alive: true });
  });

  it('a rejected promise does not crash the process', () => {
    expect(survive(`${t}Promise.reject(new Error('boom'));\nexport default from(t)`)).toMatchObject({ alive: true });
  });

  it('a non-query async default export does not crash the process', () => {
    expect(survive(`export default (async () => { throw new Error('boom') })()`)).toMatchObject({ alive: true });
  });
});

// Tester (S1 retest): the async guard must not reject ordinary synchronous query code.
import { parseCHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { editorScope, prepare, schemaScope } from '../server/eval.js';

describe('async guard accepts ordinary synchronous code', () => {
  const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
  const schema: DatabaseSchema = { functions: [], tables: [
    { name: 'events', engine: 'MergeTree', sortingKey: ['ts'], partitionKey: [], primaryKey: ['ts'], columns: [column('ts', 'DateTime', 1), column('country', 'String', 2), column('amount', 'Float64', 3)] },
    { name: 'odd', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns: [column('then', 'UInt32', 1), column('catch', 'String', 2), column('constructor', 'String', 3), column('__proto__', 'String', 4), column('finally', 'String', 5)] },
  ] };
  const scope = editorScope(schemaScope(schema));
  it.each([
    `function byCountry(c: string) { return from(events).where(e => e.country.eq(c)); }\nexport default byCountry('DE')`,
    `const pick = (e: any) => ({ country: e.country, amount: e.amount });\nexport default from(events).map(pick)`,
    `const countries = ['de', 'fr'].filter(c => c.length === 2).map(c => c.toUpperCase());\nexport default from(events).where(e => e.country.in(countries))`,
    'const p = `D${"E"}`;\nexport default from(events).where(e => e.country.eq(`${p}`))',
    `export default from(events).map(e => ({ ...{ c: e.country }, a: e.amount }))`,
    `// await the Promise, then catch errors\nexport default from(events).where(e => e.country.eq('Promise await then catch constructor Function eval'))`,
    `import type { Query } from '@typedhouse/core';\ntype P = Promise<number>;\nconst q: Query<any> = from(events);\nexport default q`,
    `export default from(events).map(({ country, amount }) => ({ country, amount }))`,
    `export default from(events).map(e => ({ then: e.country, Promise: e.amount }))`,
    `class B { q() { return from(events); } }\nexport default new B().q()`,
    `interface X { then(): void }\nconst since = new Date(Date.now() - 7 * 86400e3);\nexport default from(events).where(e => e.ts.gt(since))`,
    `export default from(odd).map(o => ({ k: o['constructor'], p: o['__proto__'] }))`,
    `export default from(odd)`,
  ])('%s', source => {
    expect(() => prepare(source, scope, { autoLimit: true })).not.toThrow();
  });

  // Columns named like promise members must stay reachable, at least with brackets (as `__proto__` is).
  it.each([
    `export default from(odd).map(o => ({ t: o['then'] }))`,
    `export default from(odd).map(o => ({ c: o['catch'], f: o['finally'] }))`,
    `export default from(odd).where(o => o['then'].gt(1))`,
  ])('column named like a promise member: %s', source => {
    expect(() => prepare(source, scope, { autoLimit: true })).not.toThrow();
  });
});

// Tester (S1 round 3): promise members are refused only when called; editor code runs in strict mode.
describe('call-only promise-member rule and strict mode', () => {
  const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
  const schema: DatabaseSchema = { functions: [], tables: [
    { name: 'events', engine: 'MergeTree', sortingKey: ['ts'], partitionKey: [], primaryKey: ['ts'], columns: [column('ts', 'DateTime', 1), column('country', 'String', 2)] },
    { name: 'odd', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns: [column('then', 'UInt32', 1), column('catch', 'String', 2), column('finally', 'String', 3)] },
  ] };
  const scope = editorScope(schemaScope(schema));

  it.each([
    `export default from(odd).where(o => o.then.gt(1)).map(o => ({ t: o.then, c: o.catch, f: o.finally }))`,
    `export default from(odd).orderBy(o => o.then).map(o => ({ t: o['then'].plus(1) }))`,
    `export default from(odd).groupBy(o => ({ c: o.catch })).aggregate(g => ({ n: count(), m: max(g.then) }))`,
    `export default from(odd).map(({ then, finally: fin }) => ({ then, fin }))`,
    // Sloppy-looking but valid strict code an LLM might write.
    `var n = 1; n = n + 1;\nfunction f(a: number) { return arguments.length + a; }\nexport default from(events).limit(f(n))`,
    `const self = this;\nexport default from(events)`,
  ])('accepts %s', source => {
    expect(() => prepare(source, scope, { autoLimit: true })).not.toThrow();
  });

  it.each([
    `declare const p: any;\np.then(() => 1);\nexport default from(events)`,
    `declare const p: any;\np?.then(() => 1);\nexport default from(events)`,
    `declare const p: any;\np.then?.(() => 1);\nexport default from(events)`,
    `declare const p: any;\np['catch'](() => 1);\nexport default from(events)`,
    `declare const p: any;\np.finally(() => 1);\nexport default from(events)`,
    `Array.fromAsync([1]);\nexport default from(events)`,
  ])('refuses at parse %s', source => {
    expect(() => prepare(source, scope, { autoLimit: true })).toThrow(/Asynchronous code is not supported/);
  });

  it('assigning an undeclared `query` is a clear evaluate error, not a leaked global', () => {
    expect(() => prepare(`query = from(events)`, scope, { autoLimit: true })).toThrow(/query is not defined/);
    expect((globalThis as Record<string, unknown>)['query']).toBeUndefined();
  });

  it('sloppy `this` no longer reaches host timers (child process stays alive)', { timeout: 20_000 }, () => {
    expect(survive(`${t}this.setTimeout(() => { for (;;) {} }, 0);\nvar query = from(t)`)).toMatchObject({ alive: true });
  });
});
