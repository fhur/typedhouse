import { expect } from 'vitest';
import { canonicalKey, outputLeaves, type Caps, type Query } from '@chql/core';
import { createClientFromBackend, type Backend } from '../src/index.js';
export async function collect<R>(rows: AsyncIterable<R>): Promise<R[]> {
  const result: R[] = [];
  for await (const row of rows) result.push(row);
  return result;
}
/** Canonicalize leaves of the existing decoded objects; never encode a second
 * row model. Sorting a list of keys (not a Set) preserves duplicate counts.
 */
type Executable<R, C extends Caps> = Pick<Query<R, C>, 'ir' | '_rowType' | 'caps'>;
export function keys<R, C extends Caps>(query: Executable<R, C>, rows: readonly unknown[]): string[] {
  const leaves = outputLeaves(query.ir.output);
  return rows.map(row => leaves.map(leaf => {
    let value: unknown = row;
    for (const key of leaf.path) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('missing decoded path');
      value = (value as Record<string, unknown>)[key];
    }
    return canonicalKey({ value }, [['value', leaf.type]]);
  }).map(key => `${key.length}:${key}`).join('')).sort();
}
/** Reusable plugin harness; native is independent SQL decoded by the fixture. */
export async function verify<R, C extends Caps>(backends: readonly Backend[], query: Executable<R, C>, expected: R[], native: () => Promise<R[]>, ordered = false) {
  const direct = await native();
  expect(direct).toEqual(expected);
  for (const backend of backends) {
    const plan = backend.compile(query.ir);
    const batches = await collect(backend.run(plan));
    const client = createClientFromBackend(backend);
    for (const rows of [batches.flat(), await client.run(query), await collect(client.stream(query))]) {
      expect(keys(query, rows), backend.name).toEqual(keys(query, expected));
      if (ordered) expect(rows, backend.name).toEqual(expected);
    }
  }
}
