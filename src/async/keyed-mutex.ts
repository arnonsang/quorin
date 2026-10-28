import { invalidArgument } from '../internal/errors.ts';
import { assertFunction } from '../internal/validate.ts';
import { Mutex, type Release } from './mutex.ts';
import type { RunOptions } from './types.ts';

/**
 * Serializes work per string key, such as a user id, session, or file path. Work under
 * different keys runs concurrently. A key's lock is dropped as soon as nobody holds or waits
 * for it, so the number of tracked keys stays bounded by the work in progress.
 */
export class KeyedMutex {
  readonly #locks = new Map<string, Mutex>();

  /** Number of keys currently held or waited for. */
  get size(): number {
    return this.#locks.size;
  }

  /** Runs `fn` while holding the lock for `key`, and always releases it. */
  async with<T>(key: string, fn: () => T | PromiseLike<T>, options: RunOptions = {}): Promise<T> {
    if (typeof key !== 'string') throw invalidArgument('key must be a string');
    assertFunction('fn', fn);
    let mutex = this.#locks.get(key);
    if (mutex === undefined) {
      mutex = new Mutex();
      this.#locks.set(key, mutex);
    }
    let release: Release;
    try {
      release = await mutex.lock(options);
    } catch (error) {
      this.#forget(key, mutex);
      throw error;
    }
    try {
      return await fn();
    } finally {
      release();
      this.#forget(key, mutex);
    }
  }

  #forget(key: string, mutex: Mutex): void {
    if (!mutex.locked && mutex.pendingCount === 0 && this.#locks.get(key) === mutex) this.#locks.delete(key);
  }
}
