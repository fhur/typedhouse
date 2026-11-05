import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, expectTypeOf, it } from 'vitest';
import { concurrentReads } from './concurrent-reads.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function observe(promise: Promise<unknown>) {
  let settled = false;

  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  return async () => {
    // Let all queued promise reactions run without a wall-clock delay.
    await nextTurn();
    expect(settled).toBe(false);
  };
}

it('starts exactly three overlapping reads and preserves heterogeneous input order', async () => {
  const first = deferred<number>();
  const second = deferred<string>();
  const third = deferred<boolean>();
  const starts: number[] = [];

  const result = concurrentReads([
    () => {
      starts.push(0);
      return first.promise;
    },
    () => {
      starts.push(1);
      return second.promise;
    },
    () => {
      starts.push(2);
      return third.promise;
    },
  ]);

  expectTypeOf(result).toEqualTypeOf<Promise<[number, string, boolean]>>();
  const expectPending = observe(result);
  await expectPending();
  expect(starts).toEqual([0, 1, 2]);
  third.resolve(true);
  second.resolve('second');
  await expectPending();
  first.resolve(42);
  await expect(result).resolves.toEqual([42, 'second', true]);
  expect(starts).toEqual([0, 1, 2]);
});

it.each(['synchronous', 'asynchronous'] as const)(
  'waits for both siblings after a %s factory failure',
  async mode => {
    const failure = new Error(mode);
    const failed = deferred<never>();
    const second = deferred<number>();
    const third = deferred<string>();
    const starts: number[] = [];

    const result = concurrentReads([
      () => {
        starts.push(0);
        if (mode === 'synchronous') throw failure;
        return failed.promise;
      },
      () => {
        starts.push(1);
        return second.promise;
      },
      () => {
        starts.push(2);
        return third.promise;
      },
    ]);

    const expectPending = observe(result);
    await expectPending();
    expect(starts).toEqual([0, 1, 2]);
    if (mode === 'asynchronous') failed.reject(failure);
    await expectPending();
    second.resolve(1);
    await expectPending();
    third.resolve('done');
    await expect(result).rejects.toBe(failure);
  },
);

it('selects the first input-order failure even when failures complete in reverse order', async () => {
  const first = deferred<number>();
  const second = deferred<string>();
  const third = deferred<boolean>();
  const firstFailure = new Error('first');
  const secondFailure = new Error('second');
  const result = concurrentReads([() => first.promise, () => second.promise, () => third.promise]);
  const expectPending = observe(result);
  second.reject(secondFailure);
  await expectPending();
  first.reject(firstFailure);
  await expectPending();
  third.resolve(true);
  await expect(result).rejects.toBe(firstFailure);
});

it('fully awaits async iterator cleanup before rejecting', async () => {
  const failure = new Error('read failed');
  const cleanupStarted = deferred<void>();
  const cleanupAllowed = deferred<void>();
  let cleanedUp = false;

  async function* rows() {
    try {
      yield 1;
    } finally {
      cleanupStarted.resolve(undefined);
      await cleanupAllowed.promise;
      cleanedUp = true;
    }
  }

  const result = concurrentReads([
    () => {
      throw failure;
    },
    async () => {
      for await (const row of rows()) {
        expect(row).toBe(1);
        break;
      }
    },
    async () => 'third',
  ]);

  const expectPending = observe(result);
  await cleanupStarted.promise;
  await expectPending();
  expect(cleanedUp).toBe(false);
  cleanupAllowed.resolve(undefined);
  await expect(result).rejects.toBe(failure);
  expect(cleanedUp).toBe(true);
});
