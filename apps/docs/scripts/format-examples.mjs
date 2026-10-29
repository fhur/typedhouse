import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { formatTypeScriptExample, exampleWidth } from './example-format.mjs';

const root = new URL('../src/content/', import.meta.url);
const check = process.argv.includes('--check');
let examples = 0, changed = 0, longLines = 0;
for (const name of (await readdir(root, { recursive: true })).filter(name => name.endsWith('.md')).sort()) {
  const path = new URL(name, root);
  const markdown = await readFile(path, 'utf8');
  let updated = '', previousEnd = 0;
  for (const match of markdown.matchAll(/^```(ts|typescript)([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)) {
    const formatted = await formatTypeScriptExample(match[3]);
    examples++;
    longLines += formatted.split('\n').filter(line => line.length > exampleWidth).length;
    updated += markdown.slice(previousEnd, match.index) + `\`\`\`${match[1]}${match[2]}\n${formatted}\n\`\`\``;
    previousEnd = match.index + match[0].length;
  }
  updated += markdown.slice(previousEnd);
  if (check) assert.equal(markdown, updated, `${name}: run pnpm --filter @chql/docs format:examples`);
  else if (updated !== markdown) { await writeFile(path, updated); changed++; }
}
console.log(`${check ? 'Verified' : 'Formatted'} ${examples} TypeScript examples at printWidth ${exampleWidth}${check ? '' : ` (${changed} pages changed)`}. SQL and other fences are untouched.`);
if (longLines) console.log(`${longLines} lines remain longer than ${exampleWidth}: Prettier preserves literals, identifiers, and syntax it cannot safely wrap.`);
