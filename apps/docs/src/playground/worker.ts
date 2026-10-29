import ts from 'typescript';
import * as core from '@chql/core';
import { compile } from '@chql/compiler';
import { formatSql } from './format-sql';

core.registerCompiler(compile);
const send = self.postMessage.bind(self);
const MAX_SOURCE = 32_000;
const MAX_OUTPUT = 100_000;

self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    const source = event.data;
    if (typeof source !== 'string' || source.length > MAX_SOURCE) {
      throw new Error('Source must be text smaller than 32,000 characters.');
    }
    const ast = ts.createSourceFile('query.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const inspect = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) &&
          (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '@chql/core')) {
        throw new Error('Only imports from @chql/core are supported. Define fixture tables in this file.');
      }
      if (ts.isImportEqualsDeclaration(node) ||
          (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
          (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        throw new Error('Dynamic imports, re-exports, and import assignments are not supported.');
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
      fileName: 'query.ts',
    });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    const module = { exports: {} as { default?: unknown } };
    const requireModule = (name: string) => {
      if (name !== '@chql/core') throw new Error(`Unsupported module: ${name}`);
      return core;
    };
    // Only runs in the opaque-origin, network-restricted sandbox worker.
    new Function('require', 'module', 'exports', result.outputText)(requireModule, module, module.exports);
    const query = module.exports.default;
    if (!(query instanceof core.Query)) throw new Error('Export a chql query with: export default query');
    const output = query.toSQL();
    const text = JSON.stringify({ sql: formatSql(output.sql), params: output.params }, (_, value) =>
      typeof value === 'bigint' ? `${value}n` : value);
    if (text.length > MAX_OUTPUT) throw new Error('Generated output exceeds 100,000 characters.');
    send({ ok: true, text });
  } catch (error) {
    send({ ok: false, text: (error instanceof Error ? error.message : 'Compilation failed.').slice(0, 4000) });
  }
};
