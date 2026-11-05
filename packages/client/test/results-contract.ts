/** Slice 4d contract follow-up (user ruling, spec "Decided, and still open": error contract of the optimizing path).
 * Results-only: when naive succeeds, optimized returns identical rows and types and never fails; when naive fails,
 * optimized may fail or succeed, and if it succeeds its rows (and types) equal the guard-first oracle's (fallible expressions
 * evaluated only on rows that pass the guards, in IR order). Rows are compared as given: callers pass them in a canonical
 * (sorted or ordered) form. Not yet used by the 500-run suites, which still assert equal outcomes. */
export interface QueryOutcome {
  readonly error?: string;
  readonly data?: readonly unknown[];
  readonly meta?: readonly unknown[];
}

export type ContractVerdict =
  | { readonly ok: true; readonly kind: 'equal' | 'both-failed' | 'oracle-rows' }
  | { readonly ok: false; readonly reason: string };

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)) ===
  JSON.stringify(b, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));

/** `oracle` is the guard-first result; it is consulted only when naive fails and optimized succeeds. An oracle that itself
 * fails (no guard keeps the fallible expression from a failing row) admits no optimized rows. */
export function resultsContract(
  optimized: QueryOutcome,
  naive: QueryOutcome,
  oracle?: QueryOutcome,
): ContractVerdict {
  if (naive.error === undefined) {
    if (optimized.error !== undefined)
      return { ok: false, reason: `optimized failed (${optimized.error}) where naive succeeded` };

    if (!same(optimized.data, naive.data))
      return { ok: false, reason: 'optimized rows differ from naive' };

    if (!same(optimized.meta, naive.meta))
      return { ok: false, reason: 'optimized types differ from naive' };

    return { ok: true, kind: 'equal' };
  }

  if (optimized.error !== undefined) return { ok: true, kind: 'both-failed' };

  if (!oracle)
    return {
      ok: false,
      reason: `optimized returned rows where naive failed (${naive.error}) and no guard-first oracle was given`,
    };

  if (oracle.error !== undefined)
    return {
      ok: false,
      reason: `optimized returned rows where naive (${naive.error}) and the guard-first oracle (${oracle.error}) fail`,
    };

  if (!same(optimized.data, oracle.data))
    return { ok: false, reason: 'optimized rows differ from the guard-first oracle' };

  if (oracle.meta !== undefined && !same(optimized.meta, oracle.meta))
    return { ok: false, reason: 'optimized types differ from the guard-first oracle' };

  return { ok: true, kind: 'oracle-rows' };
}
