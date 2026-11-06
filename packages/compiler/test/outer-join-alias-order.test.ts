import { describe, expect, it } from 'vitest';
import {
  col,
  from,
  fullJoin,
  leftJoin,
  outputLeaves,
  print,
  rightJoin,
  table,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const a = table('a', { id: col.UInt32 }, opts);

const b = table('b', { id: col.UInt32 }, opts);

type Built = { readonly ir: Rel };

const build = (f: unknown, left: string, right: string): Built =>
  (f as (...args: unknown[]) => { on(g: (r: any) => unknown): Built })(
    { [left]: from(a) },
    { [right]: from(b) },
  ).on((r: any) => r[left].id.eq(r[right].id));

const declared = (rel: Built, alias: string) =>
  outputLeaves(rel.ir.output)
    .filter(l => l.path[0] === alias)
    .map(l => print(l.type));

const kinds = [
  { name: 'leftJoin', f: leftJoin, keyword: 'LEFT ALL JOIN', extended: 'right' },
  { name: 'rightJoin', f: rightJoin, keyword: 'RIGHT ALL JOIN', extended: 'left' },
  { name: 'fullJoin', f: fullJoin, keyword: 'FULL ALL JOIN', extended: 'both' },
] as const;

/** Pairs where a merged record would sort the right argument first. */
const reordering = [
  ['2', '1'],
  ['10', '9'],
  ['x', '1'],
] as const;

describe.each(kinds)('$name keeps argument order', ({ f, keyword, extended }) => {
  it.each(reordering)('aliases %s and %s', (left, right) => {
    const q = build(f, left, right);

    expect((q.ir as Extract<Rel, { kind: 'Join' }>).inputs.map(([alias]) => alias)).toEqual([
      left,
      right,
    ]);

    expect(
      (q.ir.output as Extract<Rel['output'], { shape: 'nested' }>).inputs.map(([alias]) => alias),
    ).toEqual([left, right]);

    // The side the kind extends, by argument position, is what the descriptor says.
    expect(declared(q, left)).toEqual([
      extended === 'left' || extended === 'both' ? 'Nullable(UInt32)' : 'UInt32',
    ]);

    expect(declared(q, right)).toEqual([
      extended === 'right' || extended === 'both' ? 'Nullable(UInt32)' : 'UInt32',
    ]);

    for (const emit of [compile, emitNaive]) {
      const { sql } = emit(q.ir);
      expect(sql.indexOf(`\`${left}\``)).toBeLessThan(sql.indexOf(keyword));
      expect(sql).toContain('join_use_nulls = 1');
    }

    expect(compile(q.ir).sql).toMatch(
      new RegExp(`FROM \`a\` AS \`${left}\`\\s+${keyword} \`b\` AS \`${right}\``),
    );
  });

  it('ordinary aliases keep the order they already had, sorted or not', () => {
    for (const [left, right] of [
      ['l', 'r'],
      ['r', 'l'],
    ] as const) {
      const q = build(f, left, right);

      expect(compile(q.ir).sql).toMatch(
        new RegExp(`FROM \`a\` AS \`${left}\`\\s+${keyword} \`b\` AS \`${right}\``),
      );
    }
  });
});
