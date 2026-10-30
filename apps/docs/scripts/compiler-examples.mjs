import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { format } from 'sql-formatter';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const section = process.argv.includes('--readme') ? 'readme'
  : process.argv.includes('--guides') ? 'guides'
  : process.argv.includes('--functions') ? 'functions'
  : process.argv.includes('--query-builder') ? 'query-builder' : 'compiler';
const directory = section === 'readme'
  ? new URL('../../../', import.meta.url)
  : new URL(`../src/content/docs/docs/${section === 'guides' ? '' : `${section}/`}`, import.meta.url);
const check = process.argv.includes('--check');
const cache = new URL(`../node_modules/.cache/typedhouse-${section}-examples/`, import.meta.url);
await mkdir(cache, { recursive: true });
const files = [];
const names = section === 'readme' ? ['README.md'] : section === 'guides'
  ? ['getting-started.md', 'tutorials/composition.md', 'tutorials/advanced-example.md']
  : (await readdir(directory)).sort();
for (const name of names) {
  if (!name.endsWith('.md')) continue;
  const path = new URL(name, directory);
  const markdown = await readFile(path, 'utf8');
  // Each SQL marker closes an independent example, including its collapsed setup.
  const marker = /<!-- generated-sql:start -->[\s\S]*?<!-- generated-sql:end -->/g;
  let updated = '', previousEnd = 0, exampleIndex = 0;
  let firstExampleSource;
  for (const match of markdown.matchAll(marker)) {
    const introduction = markdown.slice(previousEnd, match.index);
    const snippets = [...introduction.matchAll(/```ts\n([\s\S]*?)\n```/g)];
    assert.ok(snippets.length, `${name}: SQL block must follow a TypeScript example`);
    const source = snippets.map(snippet => snippet[1]).join('\n\n');
    firstExampleSource ??= source;
    const sourcePath = new URL(name.replaceAll('/', '-').replace(/\.md$/, `-${exampleIndex++}.ts`), cache);
    await writeFile(sourcePath, source);
    files.push(fileURLToPath(sourcePath));
    const result = await build({
      stdin: { contents: source, loader: 'ts', resolveDir: root },
      bundle: true, write: false, format: 'esm', platform: 'node',
      alias: {
        '@typedhouse/core': `${root}packages/core/src/index.ts`,
        '@typedhouse/compiler': `${root}packages/compiler/src/index.ts`,
      },
    });
    let compiled;
    try {
      ({ default: compiled } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`));
    } catch (error) {
      // Avoid dumping a whole bundled data URL in a failed example's stack trace.
      throw new Error(`${section}/${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert.equal(typeof compiled.sql, 'string', `${name}: export default compile(query.ir)`);
    const output = `<!-- generated-sql:start -->\n\nFinal SQL:\n\n\`\`\`sql\n${format(compiled.sql, { language: 'clickhouse' })}\n\`\`\`\n\nParameters:\n\n\`\`\`json\n${JSON.stringify(compiled.params, null, 2)}\n\`\`\`\n\n<!-- generated-sql:end -->`;
    updated += introduction + output;
    previousEnd = match.index + match[0].length;
  }
  // Explicit typecheck-only blocks extend the first complete example. They may
  // use server APIs but are never bundled or executed by this documentation test.
  const typecheckOnly = [...markdown.matchAll(/```ts typecheck-only\n([\s\S]*?)\n```/g)];
  if (typecheckOnly.length) {
    assert.ok(firstExampleSource, `${name}: typecheck-only blocks require a compiled example`);
    const sourcePath = new URL(name.replaceAll('/', '-').replace(/\.md$/, '-typecheck.ts'), cache);
    await writeFile(sourcePath, [firstExampleSource, ...typecheckOnly.map(match => match[1])].join('\n\n'));
    files.push(fileURLToPath(sourcePath));
  }
  if (section === 'guides' || section === 'readme') assert.ok(exampleIndex, `${name}: must contain an executable checkpoint`);
  const trailing = markdown.slice(previousEnd);
  assert.ok(!/```ts\n/.test(trailing), `${name}: TypeScript example is missing output markers`);
  if (!exampleIndex) continue;
  updated += trailing;
  if (check) assert.equal(markdown, updated, `${name}: run pnpm --filter @typedhouse/docs examples:${section}`);
  else await writeFile(path, updated);
  console.log(`${check ? 'Verified' : 'Generated'} ${name}`);
}
const program = ts.createProgram(files, {
  strict: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  paths: {
    '@typedhouse/core': [`${root}packages/core/src/index.ts`],
    '@typedhouse/compiler': [`${root}packages/compiler/src/index.ts`],
    '@typedhouse/client': [`${root}packages/client/src/index.ts`],
  },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => '\n',
}));
console.log(`All ${section} examples typecheck.`);
