import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { getClock, schedule, type Clock } from '../internal/clock.ts';
import { LinkedQueue, type QueueNode } from '../internal/linked-queue.ts';
import { invalidArgument, invalidRange } from '../internal/errors.ts';
import { assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { QueueError } from './queue-error.ts';

export interface RateLimiterOptions {
  readonly rate: number;
  readonly intervalMs?: number;
  readonly burst?: number;
  readonly maxPending?: number;
}

export interface AcquireOptions {
  readonly weight?: number;
  readonly signal?: AbortSignal;
}

/** A token bucket returned by `createRateLimiter`. */
export interface RateLimiter {
  /** Resolves once `weight` tokens are consumed. Waiters are served strictly FIFO. */
  acquire(options?: AcquireOptions): Promise<void>;
  /** Consumes tokens at once when the bucket has them and no one is waiting. */
  tryAcquire(weight?: number): boolean;
  readonly tokens: number;
}

interface Waiting {
  readonly weight: number;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  node: QueueNode<Waiting> | null;
  unsubscribe: Unsubscribe;
}

function assertWeight(name: string, weight: unknown, burst: number): void {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) {
    throw invalidArgument(`${name} must be a finite number of tokens`);
  }
  if (weight <= 0) throw invalidRange(`${name} must be positive`);
  if (weight > burst) throw invalidRange(`${name} must be at most the burst size`);
}

/**
 * Creates a token bucket that refills `rate` tokens every `intervalMs` (default 1000) on the
 * injected clock, up to `burst` (default `rate`). Acquires wait in strict FIFO order and are
 * bounded by `maxPending` (default 1024); beyond that `acquire` rejects `QUEUE_FULL`.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  assertOptionsObject('options', options);
  if (typeof options.rate !== 'number' || !Number.isFinite(options.rate) || options.rate <= 0) {
    throw invalidArgument('rate must be a positive finite number');
  }
  const intervalMs = options.intervalMs ?? 1000;
  assertInteger('intervalMs', intervalMs, 1);
  const burst = options.burst ?? options.rate;
  const rate = options.rate;
  if (typeof burst !== 'number' || !Number.isFinite(burst) || burst <= 0) {
    throw invalidArgument('burst must be a positive finite number');
  }
  const maxPending = options.maxPending ?? 1024;
  assertInteger('maxPending', maxPending, 0);

  const clock: Clock = getClock();
  const waiters = new LinkedQueue<Waiting>();
  let tokens = burst;
  let last = clock.now();
  let cancelTimer = noop;

  const refill = (): void => {
    const now = clock.now();
    tokens = Math.min(burst, tokens + ((now - last) / intervalMs) * rate);
    last = now;
  };

  const arm = (): void => {
    cancelTimer();
    refill();
    const head = waiters.peek()!;
    const ms = ((head.weight - tokens) / rate) * intervalMs;
    cancelTimer = schedule(clock, ms, () => {
      cancelTimer = noop;
      pump();
    });
  };

  const pump = (): void => {
    refill();
    while (waiters.size > 0 && tokens >= (waiters.peek() as Waiting).weight) {
      const waiter = waiters.shift()!;
      if (waiter.node !== null) waiters.remove(waiter.node);
      waiter.unsubscribe();
      tokens -= waiter.weight;
      waiter.resolve();
    }
    if (waiters.size > 0) arm();
  };

  const limiter: RateLimiter = {
    acquire(acquireOptions: AcquireOptions = {}): Promise<void> {
      try {
        assertOptionsObject('options', acquireOptions);
        assertWeight('weight', acquireOptions.weight ?? 1, burst);
        assertOptionalSignal('signal', acquireOptions.signal);
      } catch (error) {
        return Promise.reject(error);
      }
      const weight = acquireOptions.weight ?? 1;
      const signal = acquireOptions.signal;
      if (signal?.aborted === true) return Promise.reject(signal.reason);
      refill();
      if (waiters.size === 0 && tokens >= weight) {
        tokens -= weight;
        return Promise.resolve();
      }
      if (waiters.size >= maxPending) {
        return Promise.reject(new QueueError('QUEUE_FULL', 'Too many acquires are waiting for tokens'));
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiting = { weight, resolve, reject, node: null, unsubscribe: noop };
        waiter.node = waiters.push(waiter);
        waiter.unsubscribe = onAbort(signal, (reason) => {
          if (waiter.node !== null) waiters.remove(waiter.node);
          waiter.node = null;
          waiter.unsubscribe();
          reject(reason);
          if (waiters.size === 0) {
            cancelTimer();
            cancelTimer = noop;
          } else {
            arm();
          }
        });
        if (waiters.size === 1) arm();
      });
    },

    tryAcquire(weight = 1): boolean {
      assertWeight('weight', weight, burst);
      refill();
      if (waiters.size > 0 || tokens < weight) return false;
      tokens -= weight;
      return true;
    },

    get tokens(): number {
      refill();
      return tokens;
    },
  };
  return limiter;
}
