// Only blank lines: Prettier owns every other layout decision. Run through `pnpm format`.
import { readFileSync } from 'node:fs';
import stylistic from '@stylistic/eslint-plugin';
import parser from '@typescript-eslint/parser';

const ignoreFile = new URL('.prettierignore', import.meta.url);

const ignores = readFileSync(ignoreFile, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '' && !line.startsWith('#'))
  .map(line => {
    if (line.startsWith('!')) throw new Error(`.prettierignore: negation is unsupported: ${line}`);

    return line.endsWith('/') ? `${line}**` : line;
  });

// esquery selectors do not allow line breaks, so this one is joined.
const topLevelTypes = [
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSDeclareFunction',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
];

const topLevel = { selector: `Program > :matches(${topLevelTypes.join(', ')})` };

// Re-exports read as a list, like the imports they usually sit beside.
const reExport = {
  selector: 'Program > :matches(ExportAllDeclaration, ExportNamedDeclaration[source])',
};

const exportedOverload = {
  selector: 'Program > ExportNamedDeclaration[declaration.type="TSDeclareFunction"]',
};

const exportedFunction = {
  selector:
    'Program > ExportNamedDeclaration[declaration.type=/^(TSDeclareFunction|FunctionDeclaration)$/]',
};

// `multiline-block-like` only matches statements ending in `}`. `class` only matches a declaration
// whose first token is `class`, so the selector is what covers `abstract class`.
const multilineStatement = {
  selector:
    ':matches(IfStatement, ForStatement, ForOfStatement, ForInStatement, WhileStatement, ThrowStatement, ClassDeclaration)',
  lineMode: 'multiline',
};

const separated = [
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'multiline-block-like',
  'multiline-expression',
  'multiline-const',
  'multiline-let',
  'multiline-var',
  'multiline-return',
  'multiline-export',
  multilineStatement,
];

export default [
  {
    ignores,
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { parser },
    // Comments for rules this config does not load must not fail the run, and nothing may opt out.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterOverload: true }],
      // The last matching entry wins, so the exceptions come after the requirements.
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: separated, next: '*' },
        { blankLine: 'always', prev: '*', next: separated },
        { blankLine: 'always', prev: ['import', topLevel], next: topLevel },
        { blankLine: 'always', prev: topLevel, next: 'import' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'any', prev: ['import', reExport], next: ['import', reExport] },
        // Overload signatures stay attached to their implementation.
        { blankLine: 'any', prev: 'function-overload', next: ['function', 'function-overload'] },
        { blankLine: 'any', prev: exportedOverload, next: exportedFunction },
        // Fall-through labels stay together: `case 'a':` directly above `case 'b': {`.
        { blankLine: 'any', prev: { selector: 'SwitchCase[consequent.length=0]' }, next: '*' },
      ],
    },
  },
];
