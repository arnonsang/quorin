import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { invalidArgument } from '../internal/errors.ts';
import { LinkedQueue, type QueueNode } from '../internal/linked-queue.ts';
import { assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { ChannelError } from './channel-error.ts';
import { QueueError } from './queue-error.ts';
import type { RunOptions } from './types.ts';

export interface ChannelOptions {
  readonly capacity?: number;
  readonly maxPending?: number;
}

/** Result of `tryReceive`: a value, or nothing because the channel is empty or closed and drained. */
export type ChannelReceiveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly closed: boolean };

interface ChannelState {
  readonly capacity: number;
  readonly size: number;
  readonly pendingSends: number;
  readonly pendingReceives: number;
  readonly closed: boolean;
}

/** The sending side of a channel, as returned by `channel.sendOnly()`. */
export interface ChannelSender<T> extends ChannelState {
  send(value: T, options?: RunOptions): Promise<void>;
  trySend(value: T): boolean;
  close(): void;
}

/** The receiving side of a channel, as returned by `channel.receiveOnly()`. It cannot close the channel. */
export interface ChannelReceiver<T> extends ChannelState, AsyncIterable<T> {
  receive(options?: RunOptions): Promise<T>;
  tryReceive(): ChannelReceiveResult<T>;
  values(options?: RunOptions): AsyncGenerator<T, void, undefined>;
}

export interface ReceiveWaiter<T> {
  claim(): boolean;
  deliver(value: T): void;
  close(): void;
}

export interface SendWaiter<T> {
  readonly value: T;
  claim(): boolean;
  delivered(): void;
  close(): void;
}

export function closedError(): ChannelError {
  return new ChannelError('CHANNEL_CLOSED', 'The channel is closed');
}

export class ChannelCore<T> {
  readonly capacity: number;
  readonly maxPending: number;
  readonly buffer: LinkedQueue<T> = new LinkedQueue();
  readonly receivers: LinkedQueue<ReceiveWaiter<T>> = new LinkedQueue();
  readonly senders: LinkedQueue<SendWaiter<T>> = new LinkedQueue();
  closed = false;

  constructor(capacity: number, maxPending: number) {
    this.capacity = capacity;
    this.maxPending = maxPending;
  }

  canReceive(): boolean {
    return this.buffer.size > 0 || this.senders.size > 0 || this.closed;
  }

  canSend(): boolean {
    return this.closed || this.receivers.size > 0 || this.buffer.size < this.capacity;
  }

  pollReceive(): ChannelReceiveResult<T> | undefined {
    if (this.buffer.size > 0) {
      const value = this.buffer.shift() as T;
      while (this.senders.size > 0 && this.buffer.size < this.capacity) {
        const sender = this.senders.shift()!;
        if (!sender.claim()) continue;
        this.buffer.push(sender.value);
        sender.delivered();
      }
      return { ok: true, value };
    }
    while (this.senders.size > 0) {
      const sender = this.senders.shift()!;
      if (!sender.claim()) continue;
      sender.delivered();
      return { ok: true, value: sender.value };
    }
    return this.closed ? { ok: false, closed: true } : undefined;
  }

  pollSend(value: T): boolean {
    while (this.receivers.size > 0) {
      const receiver = this.receivers.shift()!;
      if (!receiver.claim()) continue;
      receiver.deliver(value);
      return true;
    }
    if (this.buffer.size < this.capacity) {
      this.buffer.push(value);
      return true;
    }
    return false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sender of this.senders.drain()) if (sender.claim()) sender.close();
    for (const receiver of this.receivers.drain()) if (receiver.claim()) receiver.close();
  }

  send(value: T, options: RunOptions): Promise<void> {
    try {
      assertOptionsObject('options', options);
      assertOptionalSignal('signal', options.signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const signal = options.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    if (this.closed) return Promise.reject(closedError());
    if (this.pollSend(value)) return Promise.resolve();
    if (this.senders.size >= this.maxPending) {
      return Promise.reject(new QueueError('QUEUE_FULL', 'Too many sends are waiting for capacity'));
    }
    return new Promise<void>((resolve, reject) => {
      let claimed = false;
      let unsubscribe: Unsubscribe = noop;
      const waiter: SendWaiter<T> = {
        value,
        claim: () => {
          if (claimed) return false;
          claimed = true;
          unsubscribe();
          return true;
        },
        delivered: resolve,
        close: () => reject(closedError()),
      };
      const node = this.senders.push(waiter);
      unsubscribe = onAbort(signal, (reason) => {
        if (claimed) return;
        claimed = true;
        this.senders.remove(node);
        reject(reason);
      });
    });
  }

  receive(options: RunOptions): Promise<T> {
    try {
      assertOptionsObject('options', options);
      assertOptionalSignal('signal', options.signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const signal = options.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    const ready = this.pollReceive();
    if (ready !== undefined) return ready.ok ? Promise.resolve(ready.value) : Promise.reject(closedError());
    return new Promise<T>((resolve, reject) => {
      let claimed = false;
      let unsubscribe: Unsubscribe = noop;
      const waiter: ReceiveWaiter<T> = {
        claim: () => {
          if (claimed) return false;
          claimed = true;
          unsubscribe();
          return true;
        },
        deliver: resolve,
        close: () => reject(closedError()),
      };
      const node: QueueNode<ReceiveWaiter<T>> = this.receivers.push(waiter);
      unsubscribe = onAbort(signal, (reason) => {
        if (claimed) return;
        claimed = true;
        this.receivers.remove(node);
        reject(reason);
      });
    });
  }

  trySend(value: T): boolean {
    if (this.closed) throw closedError();
    return this.pollSend(value);
  }

  tryReceive(): ChannelReceiveResult<T> {
    return this.pollReceive() ?? { ok: false, closed: false };
  }

  async *values(options: RunOptions): AsyncGenerator<T, void, undefined> {
    for (;;) {
      let value: T;
      try {
        value = await this.receive(options);
      } catch (error) {
        if (error instanceof ChannelError && error.code === 'CHANNEL_CLOSED') return;
        throw error;
      }
      yield value;
    }
  }
}

const cores = new WeakMap<object, ChannelCore<unknown>>();

export function coreOf<T>(channel: unknown): ChannelCore<T> {
  const core = typeof channel === 'object' && channel !== null ? cores.get(channel) : undefined;
  if (core === undefined) throw invalidArgument('Expected a Channel or one of its views');
  return core as ChannelCore<T>;
}

function stateOf(core: ChannelCore<unknown>): PropertyDescriptorMap {
  return {
    capacity: { get: () => core.capacity, enumerable: true },
    size: { get: () => core.buffer.size, enumerable: true },
    pendingSends: { get: () => core.senders.size, enumerable: true },
    pendingReceives: { get: () => core.receivers.size, enumerable: true },
    closed: { get: () => core.closed, enumerable: true },
  };
}

/**
 * A FIFO channel for handing values between async producers and consumers. Capacity 0 (the
 * default) makes every `send` wait until a `receive` takes the value; a positive capacity buffers
 * that many values. `maxPending` (default 1024) bounds waiting sends. After `close`, sends fail,
 * buffered values still drain, and then receives fail with `CHANNEL_CLOSED`. Values pass by
 * reference, and `undefined` is a valid value.
 */
export class Channel<T> implements ChannelSender<T>, ChannelReceiver<T> {
  readonly #core: ChannelCore<T>;
  #sender: ChannelSender<T> | undefined;
  #receiver: ChannelReceiver<T> | undefined;

  constructor(options: number | ChannelOptions = 0) {
    const settings: ChannelOptions = typeof options === 'number' ? { capacity: options } : options;
    assertOptionsObject('options', settings);
    const capacity = settings.capacity ?? 0;
    assertInteger('capacity', capacity, 0);
    const maxPending = settings.maxPending ?? 1024;
    assertInteger('maxPending', maxPending, 0);
    this.#core = new ChannelCore<T>(capacity, maxPending);
    cores.set(this, this.#core as ChannelCore<unknown>);
  }

  /** Maximum number of buffered values. */
  get capacity(): number {
    return this.#core.capacity;
  }

  /** Number of buffered values. */
  get size(): number {
    return this.#core.buffer.size;
  }

  /** Number of sends waiting for a receiver or buffer space. */
  get pendingSends(): number {
    return this.#core.senders.size;
  }

  /** Number of receives waiting for a value. */
  get pendingReceives(): number {
    return this.#core.receivers.size;
  }

  get closed(): boolean {
    return this.#core.closed;
  }

  /** Resolves once the value is buffered or handed to a receiver. Rejects when closed, when `maxPending` sends already wait (`QUEUE_FULL`), or on abort. */
  send(value: T, options: RunOptions = {}): Promise<void> {
    return this.#core.send(value, options);
  }

  /** Resolves with the next value in FIFO order. Rejects with `ChannelError` `CHANNEL_CLOSED` once closed and drained, or on abort. */
  receive(options: RunOptions = {}): Promise<T> {
    return this.#core.receive(options);
  }

  /** Sends without waiting. Returns false when the value would have to wait. Throws `CHANNEL_CLOSED` on a closed channel. */
  trySend(value: T): boolean {
    return this.#core.trySend(value);
  }

  /** Receives without waiting: `{ ok: true, value }`, or `{ ok: false, closed }` when nothing is available. */
  tryReceive(): ChannelReceiveResult<T> {
    return this.#core.tryReceive();
  }

  /** Stops accepting sends and rejects waiting sends and receives. Buffered values remain receivable. Idempotent. */
  close(): void {
    this.#core.close();
  }

  /** Iterates received values until the channel is closed and drained. The signal cancels a waiting receive. */
  values(options: RunOptions = {}): AsyncGenerator<T, void, undefined> {
    return this.#core.values(options);
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    return this.#core.values({});
  }

  /** A view that can send and close but not receive. Views share this channel's state. */
  sendOnly(): ChannelSender<T> {
    if (this.#sender === undefined) {
      const core = this.#core;
      this.#sender = Object.freeze(
        Object.create(null, {
          ...stateOf(core as ChannelCore<unknown>),
          send: { value: (value: T, options: RunOptions = {}) => core.send(value, options) },
          trySend: { value: (value: T) => core.trySend(value) },
          close: { value: () => core.close() },
        }),
      ) as ChannelSender<T>;
      cores.set(this.#sender, core as ChannelCore<unknown>);
    }
    return this.#sender;
  }

  /** A view that can receive but not send or close. Views share this channel's state. */
  receiveOnly(): ChannelReceiver<T> {
    if (this.#receiver === undefined) {
      const core = this.#core;
      this.#receiver = Object.freeze(
        Object.create(null, {
          ...stateOf(core as ChannelCore<unknown>),
          receive: { value: (options: RunOptions = {}) => core.receive(options) },
          tryReceive: { value: () => core.tryReceive() },
          values: { value: (options: RunOptions = {}) => core.values(options) },
          [Symbol.asyncIterator]: { value: () => core.values({}) },
        }),
      ) as ChannelReceiver<T>;
      cores.set(this.#receiver, core as ChannelCore<unknown>);
    }
    return this.#receiver;
  }
}
