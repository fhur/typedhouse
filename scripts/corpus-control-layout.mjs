import path from 'node:path';

// Controls import repository fixtures, so put their source/config on that same
// filesystem. OS temp may be on another Windows drive: no common ancestor exists.
// A root-level directory also stays outside the root tsconfig's include globs.
export function controlLayout(root, paths = path) {
  return { rootDir: root, prefix: paths.join(root, '.chql-corpus-control-') };
}
