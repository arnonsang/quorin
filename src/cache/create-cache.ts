import { onAbort, type Unsubscribe } from '../internal/abort.ts';
import { getClock, schedule, type Clock } from '../internal/clock.ts';
import { invalidArgument } from '../internal/errors.ts';
import { assertDuration, assertFunction, assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { CacheError } from './cache-error.ts';
import type { Cache, CacheLookup, CacheOptions, GetOrFetchOptions, LoadingCache, LoadingCacheOptions } from './types.ts';

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
  readonly staleUntil: number;
}

interface Waiter<V> {
  readonly resolve: (value: V) => void;
  readonly reject: (reason: unknown) => void;
  unsubscribe: Unsubscribe;
}

interface Flight<K, V> {
  readonly key: K;
  readonly controller: AbortController;
  readonly waiters: Set<Waiter<V>>;
  readonly settledPromise: Promise<void>;
  markSettled: () => void;
  background: boolean;
  canCommit: boolean;
  cancelTimeout: () => void;
}

type State = 'fresh' | 'stale' | 'expired';

class LruCache<K, V> implements LoadingCache<K, V> {
  readonly max: number;
  readonly #ttlMs: number;
  readonly #swrMs: number;
  readonly #clock: Clock = getClock();
  readonly #entries = new Map<K, Entry<V>>();
  readonly #flights = new Map<K, Flight<K, V>>();
  readonly #unsettled = new Set<Flight<K, V>>();
  readonly #load: LoadingCacheOptions<K, V>['load'] | undefined;
  readonly #maxInFlight: number;
  readonly #loadTimeoutMs: number;
  readonly #onBackgroundError: LoadingCacheOptions<K, V>['onBackgroundError'];

  constructor(options: Partial<LoadingCacheOptions<K, V>> & CacheOptions) {
    assertInteger('max', options.max, 1);
    this.max = options.max;
    this.#ttlMs = options.ttlMs ?? Infinity;
    assertDuration('ttlMs', this.#ttlMs, true);
    this.#swrMs = options.swrMs ?? 0;
    assertDuration('swrMs', this.#swrMs);
    this.#load = options.load;
    if (this.#load !== undefined) assertFunction('load', this.#load);
    this.#maxInFlight = options.maxInFlight ?? 32;
    assertInteger('maxInFlight', this.#maxInFlight, 1);
    this.#loadTimeoutMs = options.loadTimeoutMs ?? 30_000;
    assertDuration('loadTimeoutMs', this.#loadTimeoutMs, true);
    this.#onBackgroundError = options.onBackgroundError;
    if (this.#onBackgroundError !== undefined) assertFunction('onBackgroundError', this.#onBackgroundError);
  }

  get size(): number {
    return this.#entries.size;
  }

  get inFlightCount(): number {
    return this.#unsettled.size;
  }

  #state(entry: Entry<V>): State {
    const now = this.#clock.now();
    if (now < entry.expiresAt) return 'fresh';
    if (now < entry.staleUntil) return 'stale';
    return 'expired';
  }

  #read(key: K): { entry: Entry<V>; state: 'fresh' | 'stale' } | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    const state = this.#state(entry);
    if (state === 'expired') {
      this.#entries.delete(key);
      return undefined;
    }
    return { entry, state };
  }

  #touch(key: K, entry: Entry<V>): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  #store(key: K, value: V): void {
    const expiresAt = this.#clock.now() + this.#ttlMs;
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt, staleUntil: expiresAt + this.#swrMs });
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
      this.#invalidate(oldest.value);
    }
  }

  get(key: K): V | undefined {
    const found = this.#read(key);
    if (found === undefined || found.state !== 'fresh') return undefined;
    this.#touch(key, found.entry);
    return found.entry.value;
  }

  has(key: K): boolean {
    return this.#read(key)?.state === 'fresh';
  }

  lookup(key: K): CacheLookup<V> {
    const found = this.#read(key);
    if (found === undefined) return { state: 'miss' };
    return { state: found.state, value: found.entry.value };
  }

  set(key: K, value: V): this {
    this.#invalidate(key);
    this.#store(key, value);
    return this;
  }

  delete(key: K): boolean {
    const removed = this.#entries.delete(key);
    return this.#invalidate(key) || removed;
  }

  clear(): void {
    const flights = [...this.#flights.values()];
    this.#flights.clear();
    this.#entries.clear();
    for (const flight of flights) this.#revoke(flight, new CacheError('CACHE_INVALIDATED', 'The cache was cleared'));
  }

  getOrFetch(key: K, options: GetOrFetchOptions = {}): Promise<V> {
    try {
      assertOptionsObject('options', options);
      assertOptionalSignal('signal', options.signal);
      if (options.onBackgroundTask !== undefined) assertFunction('onBackgroundTask', options.onBackgroundTask);
    } catch (error) {
      return Promise.reject(error);
    }
    const { signal, onBackgroundTask } = options;
    if (this.#load === undefined) return Promise.reject(invalidArgument('getOrFetch requires a cache created with load'));
    if (signal?.aborted === true) return Promise.reject(signal.reason);

    const found = this.#read(key);
    if (found !== undefined) {
      this.#touch(key, found.entry);
      if (found.state === 'stale') {
        const flight = this.#backgroundFlight(key);
        if (flight !== undefined && onBackgroundTask !== undefined) isolate(() => onBackgroundTask(flight.settledPromise));
      }
      return Promise.resolve(found.entry.value);
    }

    let flight = this.#flights.get(key);
    if (flight === undefined) {
      if (this.#unsettled.size >= this.#maxInFlight) {
        return Promise.reject(new CacheError('CACHE_BUSY', 'Too many loads are in flight'));
      }
      flight = this.#start(key, false);
    }
    return this.#join(flight, signal);
  }

  #backgroundFlight(key: K): Flight<K, V> | undefined {
    const existing = this.#flights.get(key);
    if (existing !== undefined) {
      existing.background = true;
      return existing;
    }
    if (this.#unsettled.size >= this.#maxInFlight) return undefined;
    return this.#start(key, true);
  }

  #start(key: K, background: boolean): Flight<K, V> {
    let markSettled!: () => void;
    const settledPromise = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const flight: Flight<K, V> = {
      key,
      controller: new AbortController(),
      waiters: new Set(),
      settledPromise,
      markSettled,
      background,
      canCommit: true,
      cancelTimeout: () => {},
    };
    this.#flights.set(key, flight);
    this.#unsettled.add(flight);
    if (this.#loadTimeoutMs !== Infinity) {
      flight.cancelTimeout = schedule(this.#clock, this.#loadTimeoutMs, () => {
        const error = new CacheError('CACHE_LOAD_TIMEOUT', 'The load timed out');
        this.#detach(flight);
        this.#revoke(flight, error);
        if (flight.background) this.#reportBackground(error, key);
      });
    }
    const load = this.#load!;
    new Promise<V>((resolve) => resolve(load(key, { signal: flight.controller.signal }))).then(
      (value) => this.#settle(flight, true, value),
      (error: unknown) => this.#settle(flight, false, error),
    );
    return flight;
  }

  #settle(flight: Flight<K, V>, success: boolean, outcome: unknown): void {
    this.#unsettled.delete(flight);
    flight.cancelTimeout();
    flight.markSettled();
    const current = this.#flights.get(flight.key) === flight;
    if (current) this.#flights.delete(flight.key);
    if (!current || !flight.canCommit) return;
    flight.canCommit = false;
    const waiters = [...flight.waiters];
    flight.waiters.clear();
    if (success) {
      this.#store(flight.key, outcome as V);
      for (const waiter of waiters) settleWaiter(waiter, () => waiter.resolve(outcome as V));
    } else {
      for (const waiter of waiters) settleWaiter(waiter, () => waiter.reject(outcome));
      if (flight.background) this.#reportBackground(outcome, flight.key);
    }
  }

  #join(flight: Flight<K, V>, signal: AbortSignal | undefined): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      const waiter: Waiter<V> = { resolve, reject, unsubscribe: () => {} };
      flight.waiters.add(waiter);
      waiter.unsubscribe = onAbort(signal, (reason) => {
        flight.waiters.delete(waiter);
        reject(reason);
        if (flight.waiters.size === 0 && !flight.background && this.#flights.get(flight.key) === flight) {
          this.#detach(flight);
          this.#revoke(flight, reason);
        }
      });
    });
  }

  #invalidate(key: K): boolean {
    const flight = this.#flights.get(key);
    if (flight === undefined) return false;
    this.#detach(flight);
    this.#revoke(flight, new CacheError('CACHE_INVALIDATED', 'The cache entry was invalidated'));
    return true;
  }

  #detach(flight: Flight<K, V>): void {
    if (this.#flights.get(flight.key) === flight) this.#flights.delete(flight.key);
  }

  #revoke(flight: Flight<K, V>, reason: unknown): void {
    flight.canCommit = false;
    flight.cancelTimeout();
    flight.controller.abort(reason);
    const waiters = [...flight.waiters];
    flight.waiters.clear();
    for (const waiter of waiters) settleWaiter(waiter, () => waiter.reject(reason));
  }

  #reportBackground(error: unknown, key: K): void {
    const observer = this.#onBackgroundError;
    if (observer !== undefined) isolate(() => observer(error, key));
  }
}

function settleWaiter<V>(waiter: Waiter<V>, settle: () => void): void {
  waiter.unsubscribe();
  settle();
}

function isolate(callback: () => void): void {
  try {
    callback();
  } catch {
    return;
  }
}

/**
 * Creates a per-instance LRU cache bounded to `max` entries.
 * Passing `load` adds `getOrFetch` with singleflight loading.
 */
export function createCache<K, V>(options: LoadingCacheOptions<K, V>): LoadingCache<K, V>;
export function createCache<K, V>(options: CacheOptions): Cache<K, V>;
export function createCache<K, V>(options: CacheOptions | LoadingCacheOptions<K, V>): Cache<K, V> | LoadingCache<K, V> {
  if (typeof options !== 'object' || options === null) throw invalidArgument('options must be an object');
  return new LruCache<K, V>(options);
}
