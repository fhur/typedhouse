/**
 * A deliberately tiny highlighter for the three languages the site shows next to each other:
 * TypeScript query code, the ClickHouse SQL it compiles to, and the JSON parameters.
 *
 * It exists so one rule holds across all three: values (JS string literals, SQL `{pN:Type}`
 * parameters, JSON parameter values) share the `val` color, so readers can trace data from
 * TypeScript into SQL. Colors come from the `--tk-*` tokens in tokens.css.
 */
export type Lang = 'ts' | 'sql' | 'json';
export type TokenKind = 'plain' | 'kw' | 'fn' | 'val' | 'num' | 'punct' | 'comment';
export interface Token { readonly text: string; readonly kind: TokenKind }
export type Line = readonly Token[];

const TS_KEYWORDS = new Set(['import', 'export', 'const', 'let', 'return', 'type', 'default', 'as', 'async', 'await', 'new', 'true', 'false']);
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'BY', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING', 'AS', 'WITH',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ALL', 'ANY', 'JOIN', 'ARRAY', 'ON', 'USING', 'DESC', 'ASC',
  'UNION', 'DISTINCT', 'IN', 'IS', 'NULL', 'FINAL', 'SAMPLE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
]);

const nextNonSpace = (line: string, from: number) => line.slice(from).trimStart().charAt(0);

function classifyWord(word: string, line: string, end: number, lang: Lang): TokenKind {
  const next = nextNonSpace(line, end);
  if (lang === 'sql') return SQL_KEYWORDS.has(word) ? 'kw' : next === '(' ? 'fn' : 'plain';
  if (lang === 'json') return word === 'true' || word === 'false' || word === 'null' ? 'val' : 'plain';
  // `from` is a keyword in `import { x } from '...'` and a function in `from(table)`.
  if (word === 'from') return next === '(' ? 'fn' : next === "'" || next === '"' ? 'kw' : 'plain';
  if (TS_KEYWORDS.has(word)) return 'kw';
  return next === '(' ? 'fn' : 'plain';
}

const RULES: readonly { readonly langs: readonly Lang[]; readonly re: RegExp; readonly kind: TokenKind | 'word' }[] = [
  { langs: ['ts'], re: /^\/\/.*/, kind: 'comment' },
  { langs: ['sql'], re: /^--.*/, kind: 'comment' },
  { langs: ['ts'], re: /^'(?:[^'\\]|\\.)*'|^"(?:[^"\\]|\\.)*"/, kind: 'val' },
  { langs: ['json'], re: /^"(?:[^"\\]|\\.)*"(?=\s*:)/, kind: 'plain' },
  { langs: ['json'], re: /^"(?:[^"\\]|\\.)*"/, kind: 'val' },
  { langs: ['sql'], re: /^\{[A-Za-z_]\w*:[^}]+\}/, kind: 'val' },
  { langs: ['sql'], re: /^`(?:[^`\\]|\\.)*`/, kind: 'plain' },
  { langs: ['sql'], re: /^'(?:[^'\\]|\\.)*'/, kind: 'val' },
  { langs: ['ts', 'sql', 'json'], re: /^\d[\d_.]*n?\b/, kind: 'num' },
  { langs: ['ts', 'sql', 'json'], re: /^[A-Za-z_$][\w$]*/, kind: 'word' },
  { langs: ['ts', 'sql', 'json'], re: /^\s+/, kind: 'plain' },
];

function lexLine(line: string, lang: Lang): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let matched = false;
    for (const rule of RULES) {
      if (!rule.langs.includes(lang)) continue;
      const m = rule.re.exec(rest);
      if (!m) continue;
      const text = m[0];
      const kind = rule.kind === 'word' ? classifyWord(text, line, i + text.length, lang) : rule.kind;
      push(tokens, text, kind);
      i += text.length;
      matched = true;
      break;
    }
    if (!matched) { push(tokens, rest.charAt(0), 'punct'); i += 1; }
  }
  return tokens;
}

/** Adjacent tokens of the same kind merge so the emitted HTML stays small. */
function push(tokens: Token[], text: string, kind: TokenKind) {
  const last = tokens.at(-1);
  if (last && last.kind === kind) tokens[tokens.length - 1] = { text: last.text + text, kind };
  else tokens.push({ text, kind });
}

export function highlight(source: string, lang: Lang): Line[] {
  return source.replace(/\n$/, '').split('\n').map(line => lexLine(line, lang));
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escaped HTML for a `<code>` element: one `.line` span per source line, plain text left unwrapped. */
export function highlightToHtml(source: string, lang: Lang): string {
  return highlight(source, lang)
    .map(line => `<span class="line">${line.map(({ text, kind }) => kind === 'plain' ? escapeHtml(text) : `<span class="tk-${kind}">${escapeHtml(text)}</span>`).join('')}</span>`)
    .join('\n');
}
