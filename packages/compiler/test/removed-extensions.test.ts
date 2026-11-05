import { expect, it, vi } from 'vitest';
import * as core from '@typedhouse/core';
import { col, count, from, table, type Rel } from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';

it('does not export custom function declarations or method installers', () => {
  for (const name of [
    'defineFunction',
    'defineAggregate',
    'extendExpr',
    'invoke',
    'aggregateCall',
    'resolveReturn',
    'metadata',
  ])
    expect(core).not.toHaveProperty(name);
});

const source = from(
  table('items', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
);

for (const aggregate of [false, true])
  it(`rejects unsupported user ${aggregate ? 'aggregate' : 'scalar'} IR without calling application code`, () => {
    const query = aggregate
      ? source.aggregate(() => ({ result: count() })).ir
      : source.map(r => ({ result: r.id.plus(1n) })).ir;

    if (query.kind !== 'Aggregate' && query.kind !== 'Project')
      throw new Error('projection expected');

    const node = query.kind === 'Aggregate' ? query.aggs.result! : query.exprs.result!;
    if (node.kind !== 'Call' && node.kind !== 'Agg') throw new Error('call expected');
    const callback = vi.fn(() => col.UInt64.type);

    for (const fn of [
      { ...node.fn, origin: 'user' },
      { ...node.fn, origin: 'user', name: 'custom' },
      { ...node.fn, origin: 'user', name: 'SUM' },
      { ...node.fn, origin: 'user', name: 'bad); SELECT 1' },
      { ...node.fn, origin: 'user', user: { returns: callback, args: [{ match: callback }] } },
      { ...node.fn, user: { returns: callback } },
    ]) {
      const forged = {
        ...query,
        [query.kind === 'Aggregate' ? 'aggs' : 'exprs']: { result: { ...node, fn } },
      } as unknown as Rel;

      for (const emit of [compile, emitNaive]) {
        try {
          emit(forged);
          throw new Error('accepted unsupported user function');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect(error).not.toBeInstanceOf(TypeError);
          expect(String(error)).toContain(aggregate ? 'root.aggs.result' : 'root.exprs.result');
        }
      }
    }

    expect(callback).not.toHaveBeenCalled();
  });
