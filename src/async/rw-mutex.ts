import { noop } from '../internal/abort.ts';
import { LinkedQueue } from '../internal/linked-queue.ts';
import { once, validateLockOptions, waitForLock, type LockWaiter, type Release } from './mutex.ts';
import type { RunOptions } from './types.ts';

interface RWWaiter extends LockWaiter {
  readonly write: boolean;
}

/**
 * A read-write lock: many readers or one writer. Requests are served in arrival order; readers
 * at the front of the queue are admitted together, and a waiting writer holds back readers that
 * arrive after it, so a steady stream of readers cannot starve writers.
 */
export class RWMutex {
  #readers = 0;
  #writing = false;
  readonly #waiters = new LinkedQueue<RWWaiter>();

  /** Number of readers currently holding the lock. */
  get readers(): number {
    return this.#readers;
  }

  /** Whether a writer currently holds the lock. */
  get writing(): boolean {
    return this.#writing;
  }

  /** Number of callers waiting to read or write. */
  get pendingCount(): number {
    return this.#waiters.size;
  }

  /** Resolves with a release function once a read lock is held. */
  lockRead(options: RunOptions = {}): Promise<Release> {
    return this.#lock(false, options);
  }

  /** Resolves with a release function once the write lock is held. */
  lockWrite(options: RunOptions = {}): Promise<Release> {
    return this.#lock(true, options);
  }

  #lock(write: boolean, options: RunOptions): Promise<Release> {
    try {
      validateLockOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    if (options.signal?.aborted === true) return Promise.reject(options.signal.reason);
    if (this.#waiters.size === 0 && this.#canAdmit(write)) return Promise.resolve(this.#admit(write));
    return waitForLock(
      this.#waiters,
      options,
      (resolve, reject) => ({ write, resolve, reject, unsubscribe: noop }),
      () => this.#grant(),
    );
  }

  #canAdmit(write: boolean): boolean {
    return write ? !this.#writing && this.#readers === 0 : !this.#writing;
  }

  #admit(write: boolean): Release {
    if (write) {
      this.#writing = true;
      return once(() => {
        this.#writing = false;
        this.#grant();
      });
    }
    this.#readers++;
    return once(() => {
      this.#readers--;
      this.#grant();
    });
  }

  #grant(): void {
    for (;;) {
      const head = this.#waiters.peek();
      if (head === undefined || !this.#canAdmit(head.write)) return;
      this.#waiters.shift();
      head.unsubscribe();
      head.resolve(this.#admit(head.write));
      if (head.write) return;
    }
  }
}
