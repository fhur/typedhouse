import { expect } from 'vitest';
import { canonicalKey, outputLeaves, type Caps, type Query } from '@typedhouse/core';
import { createClientFromBackend, type Backend, type Plan } from '../src/index.js';
export function decodedRecord(row: unknown): Record<string, unknown> {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('expected decoded row object');
  return Object.fromEntries(Object.entries(row));
}
export function multiplicityDiff(left: readonly string[], right: readonly string[]) {
  const counts = new Map<string, [number, number]>();
  for (const [side, values] of [left, right].entries()) for (const key of values) {
    const pair = counts.get(key) ?? [0, 0];
    if (side === 0) pair[0]++; else pair[1]++;
    counts.set(key, pair);
  }
  return [...counts].filter(([, [a, b]]) => a !== b);
}
/** Both plans are prepared before execution so server failures retain both SQLs.
 * Caller adds fast-check seed/path and the minimized serializable recipe.
 */
export async function differential(backends: readonly Backend[], query: { ir: Query<unknown>['ir'] }, ordered = false) {
  const plans: { backend: Backend; plan?: Plan; error?: unknown }[] = backends.map(backend => {
    try { return { backend, plan: backend.compile(query.ir) }; }
    catch (error) { return { backend, error }; }
  });
  const diagnostics = plans.map(({ backend, plan, error }) => ({ backend: backend.name, sql: plan?.compiled.sql, params: plan?.compiled.params, compileError: error && String(error) }));
  try {
    const results: unknown[][] = [];
    for (const { backend, plan, error } of plans) {
      if (!plan) throw new Error(`${backend.name}: ${String(error)}`);
      try { results.push((await collect(backend.run(plan))).flat()); }
      catch (cause) { throw new Error(`${backend.name}: ${String(cause)}`, { cause }); }
    }
    const first = plans[0]?.plan;
    if (!first) throw new Error('no backends');
    const rowKeys = (rows: unknown[]) => rows.map(row => canonicalKey(decodedRecord(row), Object.entries(first.compiled.columns)));
    for (let i = 1; i < results.length; i++) {
      expect(plans[i]?.plan?.compiled.columns, 'output descriptors').toEqual(first.compiled.columns);
      const diff = multiplicityDiff(rowKeys(results[0]!), rowKeys(results[i]!));
      if (diff.length) throw new Error(`multiplicity diff ${JSON.stringify(diff)}`);
      if (ordered) expect(rowKeys(results[i]!), 'ordered sequence').toEqual(rowKeys(results[0]!));
    }
    return results[0]!;
  } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(diagnostics)}`, { cause }); }
}
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
