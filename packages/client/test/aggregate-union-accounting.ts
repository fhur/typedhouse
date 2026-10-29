import { expect } from 'vitest';

/** A path resumes fast-check's shrink stream, not a full random campaign. */
export function assertAggregateUnionAccounting(
  runs: number,
  path: string | undefined,
  coverage: { shapes: number; agg: number; union: number },
): 'replay-only' | 'full-500' {
  if (path) {
    expect(Number.isInteger(runs)).toBe(true);
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThanOrEqual(500);
    return 'replay-only';
  }
  expect(runs).toBe(500);
  expect(coverage.shapes).toBeGreaterThan(100);
  expect(coverage.agg).toBeGreaterThanOrEqual(500);
  expect(coverage.union).toBeGreaterThan(100);
  return 'full-500';
}
