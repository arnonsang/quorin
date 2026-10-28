import { onAbort as internalOnAbort, noop, type Unsubscribe } from '../internal/abort.ts';

export type { Unsubscribe };

/**
 * Subscribes a listener to a signal's abort. An already aborted signal invokes the listener
 * synchronously and returns a no-op unsubscribe. The returned unsubscribe is idempotent and
 * removes the listener, so following a subscription to completion cannot leak it.
 */
export function onAbort(signal: AbortSignal | undefined, listener: (reason: unknown) => void): Unsubscribe {
  if (signal?.aborted === true) {
    listener(signal.reason);
    return noop;
  }
  return internalOnAbort(signal, listener);
}
