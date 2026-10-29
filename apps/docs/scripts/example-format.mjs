import { format } from 'prettier';
import ts from 'typescript';

export const exampleWidth = 60;

/** Formatting target, not permission to split identifiers or string literals. */
export async function formatTypeScriptExample(source) {
  const formatted = (await format(source, {
    parser: 'typescript',
    printWidth: exampleWidth,
    tabWidth: 2,
    singleQuote: true,
    trailingComma: 'all',
  })).trimEnd();
  // Prettier leaves prose comments untouched. Locate real comments via the
  // syntax tree so comment-like text inside strings/templates stays intact.
  const tree = ts.createSourceFile('example.ts', formatted, ts.ScriptTarget.Latest, true);
  const comments = new Map();
  function visit(node) {
    for (const range of ts.getLeadingCommentRanges(formatted, node.pos) ?? []) {
      if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) comments.set(range.pos, range);
    }
    // Include closing tokens: comments at the end of an object have no
    // following property node to carry their leading trivia.
    for (const child of node.getChildren(tree)) visit(child);
  }
  visit(tree);
  let result = formatted;
  for (const range of [...comments.values()].sort((a, b) => b.pos - a.pos)) {
    const lineStart = formatted.lastIndexOf('\n', range.pos - 1) + 1;
    const indent = formatted.slice(lineStart, range.pos);
    const comment = formatted.slice(range.pos, range.end);
    if (!/^\s*$/.test(indent) || indent.length + comment.length <= exampleWidth) continue;
    if (/^\/\/\s*(?:@|eslint|prettier|tslint|istanbul|c8|#|<reference)/.test(comment)) continue;
    const prefix = indent + '// ';
    const lines = [];
    let line = prefix;
    for (const word of comment.slice(2).trim().split(/\s+/)) {
      if (line !== prefix && line.length + word.length + 1 > exampleWidth) {
        lines.push(line); line = prefix;
      }
      line += (line === prefix ? '' : ' ') + word;
    }
    lines.push(line);
    result = result.slice(0, lineStart) + lines.join('\n') + result.slice(range.end);
  }
  return result;
}
