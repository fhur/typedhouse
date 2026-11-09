import { describe, expect, it } from 'vitest';
import { col, from, table, type QuerySettings, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D6 Tester. Regression tests. A settings object must render what was validated: a hidden key is not
 * silently dropped, and a value is not read again after validation. */
const t = table(
  't',
  { id: col.UInt64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const q = from(t);

describe.each([
  ['compile', compile],
  ['emitNaive', emitNaive],
] as const)('%s', (_name, emit) => {
  it('a non-enumerable allowed key is applied or refused, never dropped', () => {
    // settingsIssue walks getOwnPropertyNames; renderSettings walks Object.entries.
    const hidden = Object.defineProperty({}, 'max_memory_usage', {
      enumerable: false,
      value: 1,
    }) as QuerySettings;

    let text: string;

    try {
      text = emit(q.settings(hidden).ir).sql;
    } catch {
      return; // Refusing is acceptable.
    }

    expect(text).toContain('max_memory_usage = 1');
  });

  it('a value read for rendering is the value that was validated', () => {
    // peelSettings validates root.settings, then renderSettings reads it again.
    let reads = 0;

    const lying = new Proxy(
      { max_threads: 1 },
      {
        get: (target, key) =>
          key === 'max_threads'
            ? reads++ === 0
              ? 1
              : { toString: () => '1, limit = 2 --' }
            : Reflect.get(target, key),
      },
    );

    const forged = {
      kind: 'Settings',
      id: 1,
      input: q.ir,
      settings: lying,
      output: q.ir.output,
    } as unknown as Rel;

    let text = '';

    try {
      text = emit(forged).sql;
    } catch {
      return; // Refusing is acceptable.
    }

    expect(text).not.toContain('limit = 2');
  });
});
