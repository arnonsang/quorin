import { onAbort as internalOnAbort, noop, type Unsubscribe } from '../internal/abort.ts';
import { assertFunction, assertOptionalSignal } from '../internal/validate.ts';

export type { Unsubscribe };

/**
 * Subscribes a listener to a signal's abort. An already aborted signal invokes the listener
 * synchronously and returns a no-op unsubscribe. The returned unsubscribe is idempotent and
 * removes the listener, so following a subscription to completion cannot leak it. Keep listeners
 * from throwing: on an already aborted signal the error reaches the caller, while on a later
 * abort the platform reports it as an uncaught listener error.
 */
export function onAbort(signal: AbortSignal | undefined, listener: (reason: unknown) => void): Unsubscribe {
  assertOptionalSignal('signal', signal);
  assertFunction('listener', listener);
  if (signal?.aborted === true) {
    listener(signal.reason);
    return noop;
  }
  return internalOnAbort(signal, listener);
}
