import { noop, onAbort, type Unsubscribe } from '../internal/abort.ts';
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
  readonly key: string;
  readonly waiters: Set<Waiter<T>>;
  readonly controller: AbortController;
}

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: unknown };

/**
 * Wraps a function so concurrent calls with the same key share one in-flight invocation.
 * The default key is the stable stringification of the args array, so args must be JSON
 * values; a custom `key` function decides identity itself, and its own errors reject the call
 * unchanged. Every caller receives the same settled value or rejection, and values pass by
 * reference. Nothing is cached: once the flight settles, the next call starts a new one. When
 * every caller has canceled, the flight's signal aborts and the next call starts a fresh flight.
 * At most `maxInFlight` invocations run at once (default 1024), counting abandoned ones that have
 * not settled yet; beyond that calls reject `QUEUE_FULL`.
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
  const running = new Set<Flight<T>>();

  const join = (flight: Flight<T>, signal: AbortSignal | undefined): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, unsubscribe: noop };
      flight.waiters.add(waiter);
      waiter.unsubscribe = onAbort(signal, (reason) => {
        flight.waiters.delete(waiter);
        reject(reason);
        if (flight.waiters.size === 0) {
          if (flights.get(flight.key) === flight) flights.delete(flight.key);
          flight.controller.abort();
        }
      });
    });

  const deliver = (flight: Flight<T>, outcome: Outcome<T>): void => {
    running.delete(flight);
    if (flights.get(flight.key) === flight) flights.delete(flight.key);
    for (const waiter of flight.waiters) {
      waiter.unsubscribe();
      if (outcome.ok) waiter.resolve(outcome.value);
      else waiter.reject(outcome.reason);
    }
    flight.waiters.clear();
  };

  return (args: Args, runOptions: RunOptions = {}): Promise<T> => {
    let key: string;
    try {
      assertOptionsObject('options', runOptions);
      assertOptionalSignal('signal', runOptions.signal);
      const signal = runOptions.signal;
      if (signal?.aborted === true) return Promise.reject(signal.reason);
      key = stableStringify(options.key === undefined ? (args as unknown as JsonValue) : options.key(args));
    } catch (error) {
      return Promise.reject(error);
    }
    const signal = runOptions.signal;
    const existing = flights.get(key);
    if (existing !== undefined) return join(existing, signal);
    if (running.size >= maxInFlight) {
      return Promise.reject(new QueueError('QUEUE_FULL', 'Too many single-flight invocations are running'));
    }
    const flight: Flight<T> = { key, waiters: new Set(), controller: new AbortController() };
    flights.set(key, flight);
    running.add(flight);
    new Promise<T>((done) => done(fn(args, { signal: flight.controller.signal }))).then(
      (value) => deliver(flight, { ok: true, value }),
      (reason: unknown) => deliver(flight, { ok: false, reason }),
    );
    return join(flight, signal);
  };
}
