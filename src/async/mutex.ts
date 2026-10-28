import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { invalidArgument } from '../internal/errors.ts';
import { LinkedQueue, type QueueNode } from '../internal/linked-queue.ts';
import { assertFunction, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import type { RunOptions } from './types.ts';

/** Releases a held lock. Calling it again does nothing. */
export type Release = () => void;

export interface LockWaiter {
  readonly resolve: (release: Release) => void;
  readonly reject: (reason: unknown) => void;
  unsubscribe: Unsubscribe;
}

export function once(fn: () => void): Release {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

export function waitForLock<W extends LockWaiter>(
  queue: LinkedQueue<W>,
  options: RunOptions,
  make: (resolve: (release: Release) => void, reject: (reason: unknown) => void) => W,
  onRemoved: () => void,
): Promise<Release> {
  return new Promise<Release>((resolve, reject) => {
    const waiter = make(resolve, reject);
    const node: QueueNode<W> = queue.push(waiter);
    waiter.unsubscribe = onAbort(options.signal, (reason) => {
      queue.remove(node);
      reject(reason);
      onRemoved();
    });
  });
}

export function validateLockOptions(options: RunOptions): void {
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
}

/**
 * A mutual-exclusion lock for async code. `lock` resolves with a release function once the
 * lock is held; waiters are served in FIFO order and an aborted waiter leaves the queue.
 * Prefer `withLock`, which always releases.
 */
export class Mutex {
  #locked = false;
  readonly #waiters = new LinkedQueue<LockWaiter>();

  get locked(): boolean {
    return this.#locked;
  }

  /** Number of callers waiting for the lock. */
  get pendingCount(): number {
    return this.#waiters.size;
  }

  /** Resolves with a release function once the lock is held. Rejects with the signal's reason on abort. */
  lock(options: RunOptions = {}): Promise<Release> {
    try {
      validateLockOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    if (options.signal?.aborted === true) return Promise.reject(options.signal.reason);
    if (!this.#locked) {
      this.#locked = true;
      return Promise.resolve(this.#release());
    }
    return waitForLock(this.#waiters, options, (resolve, reject) => ({ resolve, reject, unsubscribe: noop }), noop);
  }

  /** Takes the lock only if it is free, returning a release function, or null. */
  tryLock(): Release | null {
    if (this.#locked) return null;
    this.#locked = true;
    return this.#release();
  }

  #release(): Release {
    return once(() => {
      const next = this.#waiters.shift();
      if (next === undefined) {
        this.#locked = false;
        return;
      }
      next.unsubscribe();
      next.resolve(this.#release());
    });
  }
}

/** Runs `fn` while holding `mutex` and always releases it, even when `fn` throws or rejects. */
export async function withLock<T>(mutex: Mutex, fn: () => T | PromiseLike<T>, options: RunOptions = {}): Promise<T> {
  if (!(mutex instanceof Mutex)) throw invalidArgument('mutex must be a Mutex');
  assertFunction('fn', fn);
  const release = await mutex.lock(options);
  try {
    return await fn();
  } finally {
    release();
  }
}
