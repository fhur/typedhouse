export async function concurrentReads<A, B, C>(
  tasks: readonly [() => Promise<A>, () => Promise<B>, () => Promise<C>],
): Promise<[A, B, C]> {
  const pending = [
    Promise.resolve().then(tasks[0]),
    Promise.resolve().then(tasks[1]),
    Promise.resolve().then(tasks[2]),
  ] as const;
  // Drain every read (including iterator cleanup) before propagating the first input-order failure.
  await Promise.allSettled(pending);
  return Promise.all(pending);
}
