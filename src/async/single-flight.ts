import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
import { unsupportedValue } from '../internal/errors.ts';
import type { JsonValue } from '../internal/json.ts';
import { assertFunction, assertInteger, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { stableStringify } from '../object/stable-stringify.ts';
import { QueueError } from './queue-error.ts';
import type { RunOptions } from './types.ts';

export interface SingleFlightOptions<Args extends readonly unknown[]> {
  readonly key?: (args: Args) => JsonValue;
  readonly maxInFlight?: number;
}

interface Waiter<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  unsubscribe: Unsubscribe;
}

interface Flight<T> {
  readonly waiters: Set<Waiter<T>>;
  readonly controller: AbortController;
}

/**
 * Wraps a function so concurrent calls with the same key share one in-flight invocation.
 * The default key is the stable stringification of the args array, so args must be JSON
 * values; a custom `key` function decides identity itself. Every caller receives the same
 * settled value or rejection, and values pass by reference. Nothing is cached: once the
 * flight settles, the next call starts a new one. The flight's signal aborts when every
 * caller has canceled; one caller canceling only disconnects that caller. At most
 * `maxInFlight` keys run at once (default 1024); beyond that calls reject `QUEUE_FULL`.
 */
export function singleFlight<Args extends readonly unknown[], T>(
  fn: (args: Args, context: { signal: AbortSignal }) => T | PromiseLike<T>,
  options: SingleFlightOptions<Args> = {},
): (args: Args, options?: RunOptions) => Promise<T> {
  assertFunction('fn', fn);
  assertOptionsObject('options', options);
  if (options.key !== undefined) assertFunction('key', options.key);
  const maxInFlight = options.maxInFlight ?? 1024;
  assertInteger('maxInFlight', maxInFlight, 1);
  const flights = new Map<string, Flight<T>>();

  return (args: Args, runOptions: RunOptions = {}): Promise<T> => {
    try {
      assertOptionsObject('options', runOptions);
      assertOptionalSignal('signal', runOptions.signal);
    } catch (error) {
      return Promise.reject(error);
    }
    const signal = runOptions.signal;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    let key: string;
    try {
      key = stableStringify(options.key === undefined ? (args as unknown as JsonValue) : options.key(args));
    } catch {
      return Promise.reject(unsupportedValue('args must be JSON values, or the key function must return one'));
    }
    const existing = flights.get(key);
    if (existing !== undefined) return join(existing, signal);
    if (flights.size >= maxInFlight) {
      return Promise.reject(new QueueError('QUEUE_FULL', 'Too many distinct keys are in flight'));
    }
    const flight: Flight<T> = { waiters: new Set(), controller: new AbortController() };
    flights.set(key, flight);
    new Promise<T>((done) => done(fn(args, { signal: flight.controller.signal }))).then(
      (value) => deliver(flight, key, value, undefined),
      (reason: unknown) => deliver(flight, key, undefined, reason),
    );
    return join(flight, signal);
  };

  function join(flight: Flight<T>, signal: AbortSignal | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, unsubscribe: noop };
      flight.waiters.add(waiter);
      waiter.unsubscribe = onAbort(signal, (reason) => {
        flight.waiters.delete(waiter);
        waiter.unsubscribe();
        reject(reason);
        if (flight.waiters.size === 0) flight.controller.abort();
      });
    });
  }

  function deliver(flight: Flight<T>, key: string, value: T | undefined, reason: unknown): void {
    flights.delete(key);
    for (const waiter of flight.waiters) {
      waiter.unsubscribe();
      if (reason === undefined) waiter.resolve(value as T);
      else waiter.reject(reason);
    }
    flight.waiters.clear();
  }
}
