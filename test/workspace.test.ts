import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace boundaries', () => {
  it('keeps core free of runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
