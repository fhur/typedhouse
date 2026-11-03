import vm from 'node:vm';
import ts from 'typescript';
import * as core from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { renderSchema, type DatabaseSchema } from '@typedhouse/codegen';
import type { CompiledQuery, OutputSchema } from '@typedhouse/core';

/** Where a run failed. The UI shows the stage and message, never a stack. */
export type Stage = 'parse' | 'evaluate' | 'compile' | 'clickhouse';
export class StudioError extends Error {
  constructor(readonly stage: Stage, message: string) { super(message); this.name = 'StudioError'; }
}
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4000);

export const AUTO_LIMIT = 100;
const MAX_SOURCE = 64_000;
const TIMEOUT_MS = 1_000;
const CORE = '@typedhouse/core';

// `query.toSQL()` inside the editor works too.
core.registerCompiler(compile);

// Editor code runs in this process, so anything it schedules for later (promise jobs, timers) would run
// outside the evaluation timeout: a loop there hangs the server, a rejection can kill it. Queries are
// built synchronously, so asynchronous code is refused up front. This is a guard against ordinary and
// LLM-written code, not a sandbox: deliberately obfuscated code can still reach host globals.
// Timers, process and globalThis are not listed: they are shadowed as `undefined` at evaluation (see SHADOWED).
const ASYNC_GLOBALS = new Set(['Promise', 'WebAssembly', 'Atomics', 'Function', 'eval']);
// Refused only when called (`x.then(...)`, `x['then'](...)`): reading a column named `then` stays fine.
const ASYNC_MEMBERS = new Set(['then', 'catch', 'finally', 'fromAsync', 'waitAsync']);
// Dotted only: columns may be named `constructor`/`__proto__` and are then read as c['__proto__'].
const DOTTED_MEMBERS = new Set(['constructor', '__proto__']);
const memberName = (node: ts.Expression): string | undefined =>
  ts.isPropertyAccessExpression(node) ? node.name.text
  : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text
  : undefined;
const ASYNC_MESSAGE = 'Asynchronous code is not supported: build the query synchronously.';
const isReference = (node: ts.Identifier) => {
  const parent = node.parent;
  return !((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) || (ts.isPropertySignature(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) || ts.isTypeReferenceNode(parent));
};

/** TypeScript → CommonJS. Only `@typedhouse/core` imports (type-only imports are erased); no dynamic import, require, re-exports or async code. */
export function transpile(source: string): string {
  if (source.length > MAX_SOURCE) throw new StudioError('parse', `Source is larger than ${MAX_SOURCE} characters.`);
  const ast = ts.createSourceFile('query.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const inspect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) return;
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== CORE) {
        throw new StudioError('parse', `Only imports from ${CORE} are allowed; tables are already in scope.`);
      }
    }
    if (ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      throw new StudioError('parse', 'Dynamic import, require, re-exports and import assignments are not allowed.');
    }
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier) ||
        (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) ||
        (ts.isIdentifier(node) && ASYNC_GLOBALS.has(node.text) && isReference(node)) ||
        (ts.isPropertyAccessExpression(node) && DOTTED_MEMBERS.has(node.name.text)) ||
        (ts.isCallExpression(node) && ASYNC_MEMBERS.has(memberName(node.expression) ?? ''))) {
      const { line, character } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      throw new StudioError('parse', `${line + 1}:${character + 1} ${ASYNC_MESSAGE}`);
    }
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  const syntax = (ast as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: 'query.ts',
  });
  const errors = [...syntax, ...(result.diagnostics ?? [])].filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new StudioError('parse', errors.slice(0, 5).map(d => {
      const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      return `${where ? `${where.line + 1}:${where.character + 1} ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    }).join('\n'));
  }
  return result.outputText;
}

// Host globals that would let editor code outlive the timeout are shadowed. This is a convenience
// boundary for a single local user, not a sandbox: builder objects still reach the host realm.
const SHADOWED = ['process', 'globalThis', 'global', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'fetch'];
const RESERVED = ['require', 'module', 'exports', ...SHADOWED];
let evalSeq = 0;

/**
 * Runs transpiled CommonJS (always strict, so a bare `this` is undefined rather than the real global) in this realm (core checks `instanceof Date` and plain-object prototypes,
 * so a separate vm context would break builder values) with a synchronous timeout. `scope` names
 * become parameters of an outer function, so editor code may still redeclare them.
 * Returns the module exports plus the value of a top-level `query` binding, if any.
 */
export function run(js: string, scope: Readonly<Record<string, unknown>>, timeoutMs = TIMEOUT_MS): { exports: Record<string, unknown>; query: unknown } {
  const names = Object.keys(scope).filter(name => !RESERVED.includes(name) && /^[A-Za-z_$][\w$]*$/.test(name));
  const module = { exports: {} as Record<string, unknown> };
  const requireCore = (name: string) => {
    if (name !== CORE) throw new Error(`Unsupported module: ${name}`);
    return core;
  };
  const key = `__typedhouseStudioEval${++evalSeq}`;
  const args = [requireCore, module, module.exports, ...names.map(name => scope[name]), ...SHADOWED.map(() => undefined)];
  const params = ['require', 'module', 'exports', ...names, ...SHADOWED];
  const code = `(function (${params.join(', ')}) { return (function () {\n'use strict';\n${js}\n;return typeof query === 'undefined' ? undefined : query; })(); }).apply(undefined, globalThis[${JSON.stringify(key)}])`;
  (globalThis as Record<string, unknown>)[key] = args;
  try {
    const query = vm.runInThisContext(code, { timeout: timeoutMs, filename: 'query.ts' }) as unknown;
    return { exports: module.exports, query };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new StudioError('evaluate', `Evaluation timed out after ${timeoutMs} ms.`);
    throw new StudioError('evaluate', messageOf(error));
  } finally {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

type AnyQuery = core.Query<unknown>;

/** Editor contract: `export default <query>`, `export const query`, or a top-level `query` binding. */
export function evaluate(source: string, scope: Readonly<Record<string, unknown>>, timeoutMs = TIMEOUT_MS): AnyQuery {
  const { exports, query } = run(transpile(source), scope, timeoutMs);
  const value = exports['default'] ?? exports['query'] ?? query;
  if (value instanceof core.Query) return value as AnyQuery;
  if (value === undefined) throw new StudioError('evaluate', 'No query found. End with `export default query` or define `const query = ...`.');
  const kind = value !== null && typeof value === 'object' ? value.constructor.name : typeof value;
  throw new StudioError('evaluate', `Expected a TypedHouse query, got ${kind}.${kind === 'GroupedQuery' ? ' Call .aggregate(...) after .groupBy(...).' : ''}`);
}

/** Tables from the introspected schema, keyed by the same binding names `renderSchema` gives the LLM. */
/** Names a table binding must not take: core exports (they would shadow `from`, `count`, ...), and the editor's own. */
// Also hidden or blocked globals (a table named `process` would be shadowed as undefined; one named `Promise`
// would trip the async guard) and common JS globals a query may use (`Object`, `Array`, `JSON`, `Math`, ...).
const COMMON_GLOBALS = ['Object', 'Array', 'Map', 'Set', 'JSON', 'Math', 'Date', 'Number', 'String', 'Boolean', 'Symbol', 'BigInt', 'Error', 'RegExp', 'undefined', 'NaN', 'Infinity'];
const TAKEN = new Set([...Object.keys(core), 'db', 'query', ...RESERVED, ...ASYNC_GLOBALS, ...COMMON_GLOBALS]);

/**
 * The introspected schema as the editor and the LLM see it: `renderSchema` output where a table binding that
 * would shadow a core export (a table named `from` or `count`) is renamed deterministically to `<name>_table`
 * (then `<name>_table2`, ...). `db.<table name>` keeps the original name. `bindings` maps table name → binding.
 */
export function editorSchema(schema: DatabaseSchema): { source: string; bindings: Map<string, string> } {
  let source = renderSchema(schema).replace(/^\/\/ generated by[^\n]*\n/, '');
  const found = [...source.matchAll(/^const ([A-Za-z_$][\w$]*) = table\(("(?:[^"\\]|\\.)*")/gm)].map(m => ({ binding: m[1]!, table: JSON.parse(m[2]!) as string }));
  const used = new Set(found.map(f => f.binding));
  const bindings = new Map<string, string>();
  for (const { binding, table } of found) {
    let name = binding;
    if (TAKEN.has(binding)) {
      let n = 1;
      do { name = `${binding}_table${n === 1 ? '' : n}`; n++; } while (used.has(name) || TAKEN.has(name));
      used.add(name);
      const esc = binding.replace(/\$/g, '\\$');
      source = source
        .replace(new RegExp(`^const ${esc} = table\\(`, 'm'), `const ${name} = table(`)
        .replace(new RegExp(`typeof ${esc}>`, 'g'), `typeof ${name}>`)
        .replace(new RegExp(`^  ${esc},$`, 'm'), `  ${binding}: ${name},`)
        .replace(new RegExp(`^(  .+): ${esc},$`, 'm'), `$1: ${name},`);
    }
    bindings.set(table, name);
  }
  return { source, bindings };
}

export function schemaScope(schema: DatabaseSchema): Record<string, unknown> {
  const { source, bindings } = editorSchema(schema);
  const names = [...bindings.values()];
  const { exports } = run(transpile(`${source}\nexport const __bindings = { ${names.join(', ')} };\n`), {}, 10_000);
  return { ...(exports['__bindings'] as Record<string, unknown>), db: exports['db'] };
}

/** Core exports plus the tables (whose bindings never collide with core, see `editorSchema`). */
export function editorScope(tables: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...core, ...tables };
}

const identifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
/** The decoded row type, e.g. `{ country: string; orders: bigint }`; join sides nest by alias. */
export function rowType(output: OutputSchema, compiled?: CompiledQuery): string {
  if (output.shape === 'deferred') {
    return compiled ? `{ ${Object.entries(compiled.columns).map(([name, type]) => `${identifier(name)}: ${core.toTypeScript(type)}`).join('; ')} }` : 'unknown';
  }
  const fields = output.shape === 'flat' ? output : output.fields;
  const parts = [
    ...(output.shape === 'nested' ? output.inputs.map(([alias, child]) => `${identifier(alias)}: ${rowType(child)}`) : []),
    ...(fields ? fields.order.map(name => `${identifier(name)}: ${core.toTypeScript(fields.columns[name]!)}`) : []),
  ];
  return `{ ${parts.join('; ')} }`;
}

export interface Column { name: string; path: string[]; type: string }
export interface Prepared {
  /** What actually runs: with auto-limit, one extra row so `limited` is exact. */
  execute: AnyQuery;
  /** What the SQL tab shows (auto-limit appended as `.limit(100)`). */
  compiled: CompiledQuery;
  rowType: string;
  columns: Column[];
  /** Rows kept for display; `undefined` when auto-limit is off. */
  limit: number | undefined;
}

export function prepare(source: string, scope: Readonly<Record<string, unknown>>, options: { autoLimit: boolean; timeoutMs?: number }): Prepared {
  const query = evaluate(source, scope, options.timeoutMs);
  let compiled: CompiledQuery, execute: AnyQuery;
  try {
    const shown = options.autoLimit ? query.limit(AUTO_LIMIT) : query;
    compiled = compile(shown.ir);
    execute = options.autoLimit ? query.limit(AUTO_LIMIT + 1) : query;
    if (options.autoLimit) compile(execute.ir);
  } catch (error) { throw new StudioError('compile', messageOf(error)); }
  const columns = Object.entries(compiled.columns).map(([name, type]) => {
    const path = [...(compiled.columnPaths?.[name] ?? [name])];
    return { name: path.join('.'), path, type: core.print(type) };
  });
  return { execute, compiled, rowType: rowType(query.ir.output, compiled), columns, limit: options.autoLimit ? AUTO_LIMIT : undefined };
}

export { messageOf };
