import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Count production TypeScript under packages/*/src (including generated source).
// Lines are physical lines, including comments and blank lines.
const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

const excludedDirectories = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  'fixtures',
  '__fixtures__',
  'node_modules',
  'dist',
  'coverage',
]);

const typescriptFile = /\.(?:ts|tsx|mts|cts)$/;

const testFile = /\.(?:test|spec|integration)\.(?:ts|tsx|mts|cts)$/;

async function countDirectory(directory) {
  const count = { files: 0, lines: 0 };

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
      const nested = await countDirectory(path);
      count.files += nested.files;
      count.lines += nested.lines;
    } else if (entry.isFile() && typescriptFile.test(entry.name) && !testFile.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      count.files += 1;

      count.lines +=
        text === '' ? 0 : text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0);
    }
  }

  return count;
}

const rows = [];

const packages = (await readdir(packagesDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));

for (const entry of packages) {
  const directory = join(packagesDir, entry.name);
  const children = await readdir(directory, { withFileTypes: true });
  if (!children.some(child => child.name === 'src' && child.isDirectory())) continue;
  rows.push({ package: entry.name, ...(await countDirectory(join(directory, 'src'))) });
}

const total = rows.reduce(
  (sum, row) => ({ package: 'TOTAL', files: sum.files + row.files, lines: sum.lines + row.lines }),
  { package: 'TOTAL', files: 0, lines: 0 },
);

console.log(
  'packages/*/src TypeScript; tests excluded; generated source, comments and blank lines included.',
);

console.table([...rows, total]);
