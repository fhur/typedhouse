import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { scalars, structured, fixture } from '../../../test/types/ch-types.js';
import { toTypeScript } from '../src/index.js';
import { adversarialMaps } from '../../../test/types/adversarial-maps.js';

it('runtime CHType mappings exactly equal descriptor phantoms under the selected TypeScript compiler', () => {
  // Ephemeral source only: acceptance never overwrites snapshots. Use the CLI rather
  // than the removed legacy compiler API so this gate also runs on TypeScript 7+.
  const directory = mkdtempSync(resolve('test/types/.runtime-mapping-'));
  try {
    const source = [
      "import { expectTypeOf } from 'expect-type';",
      "import type { Infer, Decimal, UUID, IPv4, IPv6, AggregateState } from '@typedhouse/core';",
      "import { scalars, structured, fixture } from '../ch-types.js';",
      "import { adversarialMaps } from '../adversarial-maps.js';",
      ...Object.entries({ scalars, structured, fixture, adversarialMaps }).map(([name, table]) => {
        const shape = `{ ${Object.entries(table.columns).map(([key, type]) => `${JSON.stringify(key)}: ${toTypeScript(type)}`).join('; ')} }`;
        return `expectTypeOf<Infer<typeof ${name}>>().toEqualTypeOf<${shape}>();`;
      }),
    ].join('\n');
    writeFileSync(join(directory, 'mapping.ts'), source);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ extends: '../../../tsconfig.json', include: ['./mapping.ts'] }));
    const version = process.env.TYPEDHOUSE_TYPESCRIPT_VERSION;
    const args = version ? ['--package', `typescript@${version}`, 'dlx', 'tsc'] : ['exec', 'tsc'];
    const result = spawnSync('pnpm', [...args, '--noEmit', '--project', join(directory, 'tsconfig.json')], { encoding: 'utf8', timeout: 60000 });
    expect({ status: result.status, error: result.error?.message, output: result.stdout }).toEqual({ status: 0, error: undefined, output: '' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
