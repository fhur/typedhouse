import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import { controlLayout } from './corpus-control-layout.mjs';

for (const [paths, root, externalTemp] of [
  [win32, 'D:\\repo\\chql', 'C:\\Users\\test\\Temp'],
  [win32, '\\\\server\\share\\repo', 'C:\\Temp'],
  [posix, '/repo/chql', '/tmp'],
]) {
  const layout = controlLayout(root, paths);
  assert.equal(layout.rootDir, root);
  assert.equal(paths.dirname(layout.prefix), root);
  assert.notEqual(paths.dirname(layout.prefix), externalTemp);
  const source = paths.join(`${layout.prefix}unique`, 'control.ts');
  const relative = paths.relative(layout.rootDir, source);
  assert.ok(!paths.isAbsolute(relative) && !relative.startsWith('..'));
  assert.equal(paths.parse(source).root, paths.parse(root).root);
  assert.ok(!relative.split(paths.sep).includes('node_modules'));
  assert.ok(!relative.split(paths.sep).includes('.worktrees'));
  assert.match(relative, /^\.chql-corpus-control-/);
}
console.log('Corpus control layout: distinct Windows drives, UNC and POSIX remain inside explicit repository rootDir.');
