import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as core from '@typedhouse/core';
import { print, type CHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { editorSchema, StudioError, transpile } from './eval.js';

/**
 * Editor language intelligence (R12): one in-process TypeScript LanguageService over virtual files.
 * - `schema.ts`: the editor schema (same `editorSchema` output and bindings as eval), bindings exported.
 * - `scope.d.ts`: `declare global` consts for every core value export, every table binding and `db`, so
 *   the editor contract (no imports needed) type-checks; a user import or local declaration shadows them.
 * - `query.ts`: the editor text (always a module).
 * Core's types come from `packages/core/dist/index.d.ts` when built, else from its sources.
 */
export type CoreMode = 'dist' | 'src';
export interface TypeDiagnostic { from: number; to: number; line: number; column: number; severity: 'error' | 'warning'; message: string; full: string }
export interface Completion { label: string; kind: string; detail?: string; boost: number; apply?: string }
export interface Hover { from: number; to: number; text: string }

const VIRTUAL = '/__typedhouse_studio__';
const QUERY = `${VIRTUAL}/query.ts`;
const SCHEMA = `${VIRTUAL}/schema.ts`;
const SCOPE = `${VIRTUAL}/scope.d.ts`;
const MAX_MESSAGE = 300;

const coreRoot = (() => {
  // server/types.ts (dev) and dist/main.js (built) both sit one level below packages/studio.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'core');
})();

export function resolveCore(mode: CoreMode | 'auto' = 'auto'): { mode: CoreMode; path: string } {
  const dist = join(coreRoot, 'dist', 'index.d.ts');
  if (mode === 'dist' || (mode === 'auto' && existsSync(dist))) return { mode: 'dist', path: dist };
  return { mode: 'src', path: join(coreRoot, 'src', 'index.ts') };
}

/** Core value exports that can become globals (a name the ES lib already declares would clash). */
const CORE_GLOBALS = Object.keys(core).filter(name => /^[A-Za-z_$][\w$]*$/.test(name) && !(name in globalThis));

/** Collapses bracket groups (`<…>`, `{…}`, `(…)`) whose content is longer than `limit` characters. */
function collapse(text: string, limit = 48): string {
  const pairs: Record<string, string> = { '<': '>', '{': '}', '(': ')' };
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const open = text[i]!;
    const close = pairs[open];
    // `=>` is not a bracket.
    if (!close || (open === '<' && text[i - 1] === '=')) { out += open; continue; }
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      if (text[j] === open && !(open === '<' && text[j - 1] === '=')) depth++;
      else if (text[j] === close && !(close === '>' && text[j - 1] === '=')) { depth--; if (depth === 0) break; }
    }
    if (j >= text.length) { out += open; continue; }
    const inner = text.slice(i + 1, j);
    out += inner.length > limit ? `${open}…${close}` : `${open}${collapse(inner, limit)}${close}`;
    i = j;
  }
  return out;
}

/** One line, at most `max` characters, long builder generics collapsed (`DescribedRow<…>`, `Operand<string | null>`). */
export function shorten(text: string, max = MAX_MESSAGE): string {
  let out = text.replace(/\s+/g, ' ').trim();
  out = out.replace(/ & \{ readonly ir: /g, ' & { ir: ');
  for (let i = 0; i < 5; i++) out = out.replace(/\b(Expr|DescribedExpr|Operand)<([^<>,]+)(?:,[^<>]*)>/g, '$1<$2>');
  out = collapse(out);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

export function createTypeService(options: { core?: CoreMode | 'auto'; compilerOverrides?: ts.CompilerOptions } = {}) {
  const coreTypes = resolveCore(options.core);
  const files = new Map<string, { text: string; version: number }>();
  const setFile = (path: string, text: string) => {
    const current = files.get(path);
    if (current?.text === text) return;
    files.set(path, { text, version: (current?.version ?? 0) + 1 });
  };
  /** Table name → column name → ClickHouse type, and binding → table name, for completion details. */
  let columnTypes = new Map<string, Map<string, string>>();
  let tableBindings: string[] = [];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    allowJs: false,
    paths: { '@typedhouse/core': [coreTypes.path] },
    ...options.compilerOverrides,
  };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [SCOPE, SCHEMA, QUERY],
    getScriptVersion: path => String(files.get(path)?.version ?? 0),
    getScriptSnapshot: path => {
      const file = files.get(path);
      if (file) return ts.ScriptSnapshot.fromString(file.text);
      if (!ts.sys.fileExists(path)) return undefined;
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(path) ?? '');
    },
    getCurrentDirectory: () => VIRTUAL,
    getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
    fileExists: path => files.has(path) || ts.sys.fileExists(path),
    readFile: path => files.get(path)?.text ?? ts.sys.readFile(path),
    directoryExists: dir => dir === VIRTUAL || dir.startsWith(`${VIRTUAL}/`) || (ts.sys.directoryExists?.(dir) ?? false),
    getDirectories: dir => (dir.startsWith(VIRTUAL) ? [] : ts.sys.getDirectories?.(dir) ?? []),
    realpath: path => (files.has(path) ? path : ts.sys.realpath?.(path) ?? path),
  };
  const registry = ts.createDocumentRegistry();
  const service = ts.createLanguageService(host, registry);

  function setSchema(schema: DatabaseSchema) {
    const { source, bindings } = editorSchema(schema);
    setFile(SCHEMA, source.replace(/^const ([A-Za-z_$][\w$]*) = table\(/gm, 'export const $1 = table('));
    const lines = [
      "import type * as Core from '@typedhouse/core';",
      "import type * as Schema from './schema';",
      'declare global {',
      ...CORE_GLOBALS.map(name => `  const ${name}: typeof Core.${name};`),
      ...[...bindings.values()].map(binding => `  const ${binding}: typeof Schema.${binding};`),
      '  const db: typeof Schema.db;',
      '}',
      'export {};',
    ];
    setFile(SCOPE, lines.join('\n'));
    tableBindings = [...bindings.values()];
    columnTypes = new Map(schema.tables.map(t => [t.name, new Map(t.columns.map(c => [c.name, print(c.type as CHType)]))]));
  }
  setSchema({ tables: [], functions: [] });

  /** Syntax + semantic errors of the editor text, trimmed for display. */
  function diagnostics(source: string): TypeDiagnostic[] {
    return diagnosticsOf(source);
  }
  function diagnosticsOf(source: string): TypeDiagnostic[] {
    setFile(QUERY, source);
    const all = [...service.getSyntacticDiagnostics(QUERY), ...service.getSemanticDiagnostics(QUERY)];
    const file = service.getProgram()?.getSourceFile(QUERY);
    return all.map(d => {
      const start = d.start ?? 0;
      const where = file ? file.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
      const full = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      return {
        from: start, to: start + (d.length ?? 0), line: where.line + 1, column: where.character + 1,
        severity: d.category === ts.DiagnosticCategory.Error ? 'error' as const : 'warning' as const,
        message: shorten(full), full: full.length > 4000 ? `${full.slice(0, 4000)}…` : full,
      };
    });
  }

  /**
   * What the editor shows (R12): TypeScript diagnostics plus the editor contract and the run-time guard.
   * - The query (`export default …`, or a top-level `query`) must be a runnable `Query`: a type-only check
   *   is appended after the editor text (so offsets are unchanged) and its errors are reported on the query.
   * - The eval guard's parse-stage refusals (non-core imports, async code, require, ...) become diagnostics.
   */
  /**
   * The editor contract as a type-only suffix appended after the editor text (offsets unchanged): the
   * query (`export default …` or a top-level `query`) must be runnable. A structural check on `toSQL`
   * keeps it cheap (assignability to the full generic `Query` class costs ~130 ms per check).
   * The same suffix is used for completions and hover, so all editor requests for one text share a program.
   */
  function contractOf(source: string) {
    const ast = ts.createSourceFile('query.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    let anchor: { from: number; to: number } | undefined;
    let target: 'default' | 'query' | undefined;
    for (const statement of ast.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) { target = 'default'; anchor = { from: statement.expression.getStart(ast), to: statement.expression.getEnd() }; }
      else if (!target && ts.isVariableStatement(statement)) {
        const decl = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === 'query');
        if (decl) { target = 'query'; anchor = { from: decl.name.getStart(ast), to: decl.name.getEnd() }; }
      }
    }
    const runnable = 'declare function __studio_runnable(query: { toSQL(): unknown }): void;';
    const suffix = target === 'default' ? `\n;import __studio_default from './query';\n__studio_runnable(__studio_default);\n${runnable}\n`
      : target === 'query' ? `\n;__studio_runnable(query);\n${runnable}\n` : '';
    return { ast, anchor, target, text: source + suffix };
  }

  function check(source: string): TypeDiagnostic[] {
    const { ast, anchor, target, text } = contractOf(source);
    const found = diagnosticsOf(text);
    const own = found.filter(d => d.from < source.length || d.to <= source.length);
    const contract = found.filter(d => d.from >= source.length);
    const out = [...own];
    const position = (from: number, to: number) => { const where = ast.getLineAndCharacterOfPosition(from); return { from, to, line: where.line + 1, column: where.character + 1 }; };
    if (!target) {
      out.push({ ...position(0, Math.min(source.length, 1)), severity: 'error', message: 'No query found: end with `export default <query>` or define `const query = ...`.', full: 'No query found: end with `export default <query>` or define `const query = ...`.' });
    } else if (contract.length && anchor) {
      const program = service.getProgram()!;
      const file = program.getSourceFile(QUERY)!;
      // The query expression in the checked program: the default export, or the `query` declaration.
      let expr: ts.Node | undefined;
      for (const statement of file.statements) {
        if (target === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) expr = statement.expression;
        if (target === 'query' && ts.isVariableStatement(statement)) expr ??= statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === 'query')?.name;
      }
      const checker = program.getTypeChecker();
      const printed = expr ? checker.typeToString(checker.getTypeAtLocation(expr)) : 'something else';
      const typeName = expr && printed === 'any' ? shorten(expr.getText(file), 40) : shorten(printed, 80);
      const grouped = /^GroupedQuery\b/.test(typeName) ? ' Finish .groupBy(...) with .aggregate(...).' : '';
      const message = `The query must be a TypedHouse query (Query), not ${typeName}.${grouped}`;
      out.push({ ...position(anchor.from, anchor.to), severity: 'error', message, full: `${message}\n${contract.map(d => d.full).join('\n')}` });
    }
    // The run-time guard (only when the syntax is fine; otherwise the syntax error says it).
    if (!out.some(d => d.full.startsWith('SyntaxError') || /^'[^']*' expected/.test(d.message))) {
      try { transpile(source); } catch (error) {
        if (error instanceof StudioError) {
          const m = /^(\d+):(\d+) (.*)$/s.exec(error.message);
          const from = m ? Math.min(source.length, ast.getPositionOfLineAndCharacter(Number(m[1]) - 1, Number(m[2]) - 1)) : 0;
          const text = m ? m[3]! : error.message;
          if (!out.some(d => d.message === text)) out.push({ ...position(from, Math.min(source.length, from + 1)), severity: 'error', message: shorten(text), full: text });
        }
      }
    }
    return out;
  }

  /** The ClickHouse type of a column property, read from its declaration in schema.ts (`table("t", { col: … })`). */
  function columnType(symbol: ts.Symbol): string | undefined {
    const decl = symbol.declarations?.[0];
    if (!decl || decl.getSourceFile().fileName !== SCHEMA || !ts.isPropertyAssignment(decl)) return undefined;
    const call = decl.parent?.parent;
    if (!call || !ts.isCallExpression(call) || !ts.isStringLiteral(call.arguments[0]!)) return undefined;
    const name = ts.isIdentifier(decl.name) || ts.isStringLiteral(decl.name) ? decl.name.text : decl.name.getText();
    return columnTypes.get(call.arguments[0].text)?.get(name);
  }

  function completions(source: string, pos: number): { from: number; items: Completion[] } {
    setFile(QUERY, contractOf(source).text);
    const result = service.getCompletionsAtPosition(QUERY, pos, { includeCompletionsWithInsertText: true, includeCompletionsForModuleExports: false });
    let from = pos;
    while (from > 0 && /[\w$]/.test(source[from - 1]!)) from--;
    if (!result) return { from, items: [] };
    const program = service.getProgram()!;
    const checker = program.getTypeChecker();
    const file = program.getSourceFile(QUERY)!;
    // Inside a string: only literal-union suggestions (e.g. an Enum column's values), never identifiers.
    const inString = findToken(file, Math.max(0, pos - 1));
    if (inString && (ts.isStringLiteral(inString) || ts.isNoSubstitutionTemplateLiteral(inString) || ts.isTemplateLiteralToken(inString)) && pos > inString.getStart(file)) {
      const expected = checker.getContextualType(inString as ts.Expression);
      const literalUnion = !!expected && (expected.isUnion() ? expected.types.every(t => t.isStringLiteral()) : expected.isStringLiteral());
      if (!literalUnion) return { from, items: [] };
      return { from, items: result.entries.filter(e => e.kind === ts.ScriptElementKind.string).map(e => ({ label: e.name, kind: 'string', boost: 0 })) };
    }
    // Bracketed members (`["odd-name"]`) replace from the `.`: then every item replaces from there.
    const spanStart = Math.min(from, ...result.entries.flatMap(e => (e.replacementSpan ? [e.replacementSpan.start] : [])));
    const prefix = source.slice(spanStart, from);
    // Member completions: resolve the receiver's properties once to find columns and their CH types.
    const columns = new Map<string, string>();
    if (result.isMemberCompletion) {
      const token = findToken(file, Math.max(0, from - 1));
      const access = token && (ts.isPropertyAccessExpression(token) ? token : token.parent && ts.isPropertyAccessExpression(token.parent) ? token.parent : undefined);
      if (access) {
        for (const prop of checker.getTypeAtLocation(access.expression).getProperties()) {
          const type = columnType(prop);
          if (type) columns.set(prop.name, type);
        }
      }
    }
    const tables = new Set(tableBindings);
    const coreNames = new Set(CORE_GLOBALS);
    const items: Completion[] = [];
    for (const entry of result.entries) {
      if (entry.name.startsWith('__') || entry.name === 'ir' || entry.name === '_rowType') continue;
      const column = columns.get(entry.name);
      // TS sortText: '10' local declarations, '11' location priority (parameters), '15' globals and keywords.
      const local = entry.sortText === '10' || entry.sortText === '11';
      // Members: columns first. Top level: tables, then db, then locals, then core; other lib globals are dropped.
      let boost: number;
      if (result.isMemberCompletion) boost = column ? 2 : 0;
      else if (tables.has(entry.name)) boost = 4;
      else if (entry.name === 'db') boost = 3;
      else if (local) boost = 2;
      else if (coreNames.has(entry.name)) boost = 1;
      else if (entry.kind === ts.ScriptElementKind.keyword) boost = -1;
      else continue;
      items.push({
        label: entry.name,
        kind: column ? 'column' : tables.has(entry.name) && !result.isMemberCompletion ? 'table' : entry.kind,
        ...(column ? { detail: column.length > 40 ? `${column.slice(0, 39)}…` : column } : tables.has(entry.name) && !result.isMemberCompletion ? { detail: 'table' } : {}),
        boost,
        ...(entry.replacementSpan && entry.insertText ? { apply: entry.insertText }
          : entry.insertText && entry.insertText !== entry.name ? { apply: `${prefix}${entry.insertText}` }
          : prefix ? { apply: `${prefix}${entry.name}` } : {}),
      });
    }
    return { from: spanStart, items: items.slice(0, 400) };
  }

  function hover(source: string, pos: number): Hover | undefined {
    setFile(QUERY, contractOf(source).text);
    const info = service.getQuickInfoAtPosition(QUERY, pos);
    if (!info) return undefined;
    const program = service.getProgram()!;
    const file = program.getSourceFile(QUERY)!;
    const token = findToken(file, pos);
    if (token && ts.isIdentifier(token) && ts.isPropertyAccessExpression(token.parent) && token.parent.name === token) {
      const symbol = program.getTypeChecker().getSymbolAtLocation(token);
      const type = symbol && columnType(symbol);
      if (type) return { from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length, text: `(column) ${token.text}: ${type}` };
    }
    const text = ts.displayPartsToString(info.displayParts);
    const doc = ts.displayPartsToString(info.documentation ?? []).split('\n')[0];
    return { from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length, text: `${shorten(text, 200)}${doc ? `\n${shorten(doc, 300)}` : ''}` };
  }

  return {
    core: coreTypes,
    setSchema,
    diagnostics,
    check,
    completions,
    hover,
    /** Load lib + core + schema once so the first keystroke does not pay the cold start. */
    warm() { diagnostics('export default from(db)'); completions('from', 4); },
  };
}
export type TypeService = ReturnType<typeof createTypeService>;

function findToken(file: ts.SourceFile, pos: number): ts.Node | undefined {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (pos < node.getStart(file) || pos >= node.getEnd()) return undefined;
    return ts.forEachChild(node, visit) ?? node;
  };
  return visit(file);
}
