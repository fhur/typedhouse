// `pnpm format [paths]` rewrites in place; `pnpm format:check [paths]` only reads. Scope is the globs
// below minus .prettierignore. See "Formatting" in CLAUDE.md.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const MAX_PASSES = 5;

const EXTENSIONS = '*.{ts,tsx,js,mjs}';

const ROOTS = ['packages', 'scripts', 'apps/docs', 'test/types'];

const root = resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);

const check = args.includes('--check');

const paths = args.filter(arg => arg !== '--check' && arg !== '--');

const targets = paths.length > 0 ? paths : ROOTS.map(dir => `${dir}/**/${EXTENSIONS}`);

function run(tool, flags, quiet) {
  const result = spawnSync(resolve(root, 'node_modules/.bin', tool), [...flags, ...targets], {
    cwd: root,
    stdio: quiet ? 'ignore' : 'inherit',
  });

  if (result.error) throw result.error;

  return result.status === 0;
}

const prettier = (mode, quiet = false) =>
  run('prettier', [mode, '--log-level', quiet ? 'silent' : 'warn'], quiet);

const eslint = (flags = [], quiet = false) =>
  run('eslint', ['--quiet', '--no-warn-ignored', ...flags], quiet);

if (check) {
  // Both always run, so one report shows every kind of deviation.
  const formatted = prettier('--check');
  const padded = eslint();

  if (!formatted || !padded) {
    console.error('Formatting differs. Run: pnpm format');
    process.exit(1);
  }

  console.log('Formatting is clean.');
  process.exit(0);
}

// One pass is not enough: Prettier can need a second run on its own output, and wrapping a statement
// can make it multi-line, which then needs blank lines around it.
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  if (!prettier('--write') || !eslint(['--fix'])) process.exit(1);

  if (prettier('--check', true) && eslint([], true)) {
    console.log(`Formatted in ${pass} pass${pass === 1 ? '' : 'es'}.`);
    process.exit(0);
  }
}

console.error(`Formatting did not settle after ${MAX_PASSES} passes.`);
process.exit(1);
