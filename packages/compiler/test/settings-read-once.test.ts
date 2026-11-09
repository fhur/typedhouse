import { describe, expect, it } from 'vitest';
import { col, from, table, type QuerySettings, type Rel } from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';

const q = from(
  table('t', { id: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] }),
);

const forged = (settings: unknown) =>
  ({ kind: 'Settings', id: 1, input: q.ir, settings, output: q.ir.output }) as unknown as Rel;

describe.each([
  ['compile', compile],
  ['emitNaive', emitNaive],
] as const)('%s', (_name, emit) => {
  it('refuses a non-enumerable allowed key, in the builder and on a node', () => {
    const hidden = () => Object.defineProperty({}, 'max_memory_usage', { value: 1 });

    expect(() => q.settings(hidden() as QuerySettings)).toThrow(
      'invalid_settings at settings.max_memory_usage',
    );

    let error: unknown;

    try {
      emit(forged(hidden()));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ValidationError);
    expect(String(error)).toContain('invalid_settings at root.settings.max_memory_usage');
  });

  it('reads each value once, and renders what it validated', () => {
    let reads = 0;

    const settings = new Proxy(
      { max_threads: 1 },
      {
        get: (target, key) => {
          if (key !== 'max_threads') return Reflect.get(target, key);
          reads++;
          return reads === 1 ? 1 : { toString: () => '1, limit = 2 --' };
        },
      },
    );

    expect(emit(forged(settings)).sql).toBe(`${emit(q.ir).sql} SETTINGS max_threads = 1`);
    expect(reads).toBe(1);
  });

  it('reads the input once from the root', () => {
    let reads = 0;

    const other = from(
      table('other', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
    ).ir;

    const root = new Proxy(forged({}) as object, {
      get: (target, key) => {
        if (key !== 'input') return Reflect.get(target, key);
        return reads++ === 0 ? q.ir : other;
      },
    });

    expect(emit(root as Rel).sql).toBe(emit(q.ir).sql);
    expect(reads).toBe(1);
  });
});
