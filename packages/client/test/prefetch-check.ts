import fc from 'fast-check';

/** Slice 4d item 0 (generalises slice 4b's aggregate-union prefetch). GitHub runners (4 vCPU, two integration files and
 * two ClickHouse servers at once) run the 500-run differentials ~2x slower than a developer box, and each run's IO used
 * to wait for the previous one. The campaign itself is unchanged: an always-true synchronous `fc.assert` pass over the
 * same arbitrary and options records exactly the values `fc.check` then generates (pinned Docker-free for the 4b
 * arbitrary in `slice4b-adversarial.integration.ts`), their `evaluate` (all compile/IO work, no assertions) runs
 * `concurrency` at a time, and the real property asserts each cached evaluation in generation order. A value seen a second
 * time, and every shrink or replay (`path` set), evaluates live. An `evaluate` rejection is rethrown by the property, so a
 * failure surfaces exactly as it would live. Returns `prefetched`, the number of runs served from the cache. */
export async function prefetchedCheck<T, E>(arbitrary: fc.Arbitrary<T>, options: fc.Parameters<[T]>,
  evaluate: (value: T) => Promise<E>, property: (value: T, evaluation: E) => void | Promise<void>, concurrency = 8) {
  type Settled = { ok: true; value: E } | { ok: false; cause: unknown };
  const settle = async (value: T): Promise<Settled> => { try { return { ok: true, value: await evaluate(value) }; } catch (cause) { return { ok: false, cause }; } };
  const cache = new Map<string, Promise<Settled>>();
  let stopped = false, prefetched = 0;
  if (options.path === undefined) {
    const planned: T[] = [];
    fc.assert(fc.property(arbitrary, value => { planned.push(value); }), options);
    const first: { value: T; resolve: (s: Settled) => void }[] = [];
    for (const value of planned) {
      const key = fc.stringify(value);
      if (!cache.has(key)) cache.set(key, new Promise<Settled>(resolve => { first.push({ value, resolve }); }));
    }
    let next = 0;
    // Stops at the first property failure: shrinking evaluates live, nothing else needs the cache.
    const worker = async () => { while (next < first.length && !stopped) { const job = first[next++]!; job.resolve(await settle(job.value)); } };
    void Promise.all(Array.from({ length: concurrency }, worker));
  }
  try {
    const result = await fc.check(fc.asyncProperty(arbitrary, async value => {
      const key = fc.stringify(value), cached = stopped ? undefined : cache.get(key);
      // A value is consumed once; after the first failure (shrinking) every value evaluates live.
      if (cached) { cache.delete(key); prefetched++; }
      const settled = await (cached ?? settle(value));
      if (!settled.ok) { stopped = true; throw settled.cause; }
      try { await property(value, settled.value); } catch (cause) { stopped = true; throw cause; }
    }), options);
    return { result, prefetched };
  } finally { stopped = true; }
}

/** Slice 4d item 0: the explicit limit of a long differential on a CI runner. Recorded GitHub per-test times (runs
 * 41216932321/41216934562 at 0106121 and 41220998418 at f73b234, 4 vCPU, `maxWorkers: 2`) were 0.9-2.2x this
 * repository's local times for the same tests, with one aggregate-union outlier above 3.8x (the 180 s timeout of
 * 41216934562). Under `CI=true` the limit doubles: with prefetching, the slowest such test (aggregate-union, ~47 s locally)
 * then times out only past ~7.6x its local time. Locally the limit is unchanged, so a local slowdown still shows. */
export const ciLimit = (ms: number): number => process.env.CI === 'true' ? 2 * ms : ms; // GitHub sets CI=true exactly (Tester m2)
