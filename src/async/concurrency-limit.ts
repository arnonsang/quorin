import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { LinkedQueue, type QueueNode } from '../internal/linked-queue.ts';
import { assertFunction, assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { QueueError } from './queue-error.ts';
import type { RunOptions, TaskContext } from './types.ts';

export interface LimitOptions {
  readonly maxPending?: number;
}

export interface Limiter {
  <T>(task: (context: TaskContext) => T | PromiseLike<T>, options?: RunOptions): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  clear(reason?: unknown): void;
}

interface Pending {
  readonly task: (context: TaskContext) => unknown;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  node: QueueNode<Pending> | null;
  unsubscribe: Unsubscribe;
}

export function concurrencyLimit(concurrency: number, options: LimitOptions = {}): Limiter {
  assertInteger('concurrency', concurrency, 1);
  assertOptionsObject('options', options);
  const maxPending = options.maxPending ?? 1024;
  assertInteger('maxPending', maxPending, 0);

  const queue = new LinkedQueue<Pending>();
  let active = 0;

  const release = (): void => {
    active--;
    while (active < concurrency && queue.size > 0) start(queue.shift()!);
  };

  const start = (entry: Pending): void => {
    entry.unsubscribe();
    active++;
    const controller = new AbortController();
    let waiting = true;
    const finish = (settle: () => void): void => {
      if (!waiting) return;
      waiting = false;
      stopListening();
      settle();
    };
    const stopListening = onAbort(entry.signal, (reason) => {
      controller.abort(reason);
      finish(() => entry.reject(reason));
    });
    new Promise((resolve) => resolve(entry.task({ signal: controller.signal }))).then(
      (value) => {
        finish(() => entry.resolve(value));
        release();
      },
      (error: unknown) => {
        finish(() => entry.reject(error));
        release();
      },
    );
  };

  const limiter = (<T>(task: (context: TaskContext) => T | PromiseLike<T>, runOptions: RunOptions = {}): Promise<T> => {
    try {
      assertFunction('task', task);
      assertOptionsObject('options', runOptions);
      assertOptionalSignal('signal', runOptions.signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const signal = runOptions.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    if (active >= concurrency && queue.size >= maxPending) {
      return Promise.reject(new QueueError('QUEUE_FULL', 'The limiter queue is full'));
    }
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        task,
        signal,
        resolve: resolve as (value: unknown) => void,
        reject,
        node: null,
        unsubscribe: noop,
      };
      if (active < concurrency) {
        start(entry);
        return;
      }
      const node = queue.push(entry);
      entry.node = node;
      entry.unsubscribe = onAbort(signal, (reason) => {
        queue.remove(node);
        reject(reason);
      });
    });
  }) as Limiter;

  Object.defineProperties(limiter, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.size },
    clear: {
      value: (reason?: unknown): void => {
        const error = reason === undefined ? new QueueError('QUEUE_CLEARED', 'The limiter queue was cleared') : reason;
        for (const entry of queue.drain()) {
          entry.unsubscribe();
          entry.reject(error);
        }
      },
    },
  });
  return limiter;
}
