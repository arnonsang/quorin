import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { LinkedQueue, type QueueNode } from '../internal/linked-queue.ts';
import { assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { ChannelError } from './channel-error.ts';
import { QueueError } from './queue-error.ts';
import type { RunOptions } from './types.ts';

export interface ChannelOptions {
  readonly capacity?: number;
  readonly maxPending?: number;
}

/** A bounded FIFO channel returned by `createChannel`. Values are references; `undefined` is a valid value. */
export interface Channel<T> {
  /** Resolves when the value is buffered or handed to a waiting take. Rejects when closed, the queue of waiting puts is full, or the signal aborts. */
  put(value: T, options?: RunOptions): Promise<void>;
  /** Resolves with the next value in FIFO order. Rejects with `ChannelError` when the channel is closed and drained, or when the signal aborts. */
  take(options?: RunOptions): Promise<T>;
  /** Stops accepting puts, rejects waiting puts and takes, and lets buffered values drain before takes fail. Idempotent. */
  close(): void;
  readonly size: number;
  readonly pendingPuts: number;
  readonly pendingTakes: number;
  readonly closed: boolean;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

interface WaitingPut<T> {
  readonly value: T;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  node: QueueNode<WaitingPut<T>> | null;
  unsubscribe: Unsubscribe;
}

interface WaitingTake<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  node: QueueNode<WaitingTake<T>> | null;
  unsubscribe: Unsubscribe;
}

function closedError(): ChannelError {
  return new ChannelError('CHANNEL_CLOSED', 'The channel is closed');
}

/**
 * Creates a bounded FIFO channel for streaming work between producers and consumers.
 * `capacity` bounds buffered values (default 0: every put waits for a take, so backpressure
 * is immediate); `maxPending` bounds waiting puts (default 1024). Buffered values remain
 * takeable after `close` until drained.
 */
export function createChannel<T>(options: ChannelOptions = {}): Channel<T> {
  assertOptionsObject('options', options);
  const capacity = options.capacity ?? 0;
  assertInteger('capacity', capacity, 0);
  const maxPending = options.maxPending ?? 1024;
  assertInteger('maxPending', maxPending, 0);

  const buffer = new LinkedQueue<T>();
  const puts = new LinkedQueue<WaitingPut<T>>();
  const takes = new LinkedQueue<WaitingTake<T>>();
  let isClosed = false;

  const settlePut = (entry: WaitingPut<T>): void => {
    if (entry.node !== null) puts.remove(entry.node);
    entry.unsubscribe();
  };

  const settleTake = (entry: WaitingTake<T>): void => {
    if (entry.node !== null) takes.remove(entry.node);
    entry.unsubscribe();
  };

  const channel: Channel<T> = {
    put(value: T, putOptions: RunOptions = {}): Promise<void> {
      try {
        assertOptionsObject('options', putOptions);
        assertOptionalSignal('signal', putOptions.signal);
      } catch (error) {
        return Promise.reject(error);
      }
      const signal = putOptions.signal;
      if (signal?.aborted === true) return Promise.reject(signal.reason);
      if (isClosed) return Promise.reject(closedError());
      return new Promise<void>((resolve, reject) => {
        if (takes.size > 0) {
          const taker = takes.shift()!;
          settleTake(taker);
          taker.resolve(value);
          resolve();
          return;
        }
        if (buffer.size < capacity) {
          buffer.push(value);
          resolve();
          return;
        }
        if (puts.size >= maxPending) {
          reject(new QueueError('QUEUE_FULL', 'Too many puts are waiting for capacity'));
          return;
        }
        const entry: WaitingPut<T> = { value, resolve, reject, node: null, unsubscribe: noop };
        entry.node = puts.push(entry);
        entry.unsubscribe = onAbort(signal, (reason) => {
          settlePut(entry);
          reject(reason);
        });
      });
    },
    take(takeOptions: RunOptions = {}): Promise<T> {
      try {
        assertOptionsObject('options', takeOptions);
        assertOptionalSignal('signal', takeOptions.signal);
      } catch (error) {
        return Promise.reject(error);
      }
      const signal = takeOptions.signal;
      if (signal?.aborted === true) return Promise.reject(signal.reason);
      return new Promise<T>((resolve, reject) => {
        if (buffer.size > 0) {
          const value = buffer.shift()!;
          if (puts.size > 0) {
            const putter = puts.shift()!;
            settlePut(putter);
            buffer.push(putter.value);
            putter.resolve();
          }
          resolve(value);
          return;
        }
        if (puts.size > 0) {
          const putter = puts.shift()!;
          settlePut(putter);
          putter.resolve();
          resolve(putter.value);
          return;
        }
        if (isClosed) {
          reject(closedError());
          return;
        }
        const entry: WaitingTake<T> = { resolve, reject, node: null, unsubscribe: noop };
        entry.node = takes.push(entry);
        entry.unsubscribe = onAbort(signal, (reason) => {
          settleTake(entry);
          reject(reason);
        });
      });
    },

    close(): void {
      if (isClosed) return;
      isClosed = true;
      while (puts.size > 0) {
        const putter = puts.shift()!;
        settlePut(putter);
        putter.reject(closedError());
      }
      while (takes.size > 0) {
        const taker = takes.shift()!;
        settleTake(taker);
        taker.reject(closedError());
      }
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> =>
          channel.take().then(
            (value: T) => ({ done: false as const, value }),
            (error: unknown) => {
              if (error instanceof ChannelError && error.code === 'CHANNEL_CLOSED') {
                return { done: true, value: undefined };
              }
              throw error;
            },
          ),
      };
    },

    get size(): number {
      return buffer.size;
    },
    get pendingPuts(): number {
      return puts.size;
    },
    get pendingTakes(): number {
      return takes.size;
    },
    get closed(): boolean {
      return isClosed;
    },
  };
  return channel;
}
