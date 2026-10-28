import { timeoutReason, type Unsubscribe } from '../internal/abort.ts';
import { getClock } from '../internal/clock.ts';
import { invalidRange } from '../internal/errors.ts';
import { assertDuration, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import { onAbort as subscribeParent } from './on-abort.ts';

const MAX_TIMEOUT_MS = 2_147_483_647;

export interface TimeoutSignalOptions {
  readonly signal?: AbortSignal;
}

/** A deadline signal returned by `timeoutSignal`. Canceling clears the timer without aborting. */
export interface TimeoutSignal {
  readonly signal: AbortSignal;
  /** Clears the timer. Idempotent. Does not abort the signal. */
  cancel(): void;
}

/**
 * Creates an AbortSignal that aborts with a `TimeoutError` after `ms` on the injected clock,
 * so tests can advance fake time. Unlike `AbortSignal.timeout`, an optional parent `signal`
 * aborts the deadline early with the parent's reason and clears the timer, and `cancel` clears
 * the timer without aborting. Like `AbortSignal.timeout`, a pending timer does not keep the
 * process alive.
 */
export function timeoutSignal(ms: number, options: TimeoutSignalOptions = {}): TimeoutSignal {
  assertDuration('ms', ms);
  if (ms > MAX_TIMEOUT_MS) throw invalidRange('ms must be at most 2147483647');
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
  const clock = getClock();
  const controller = new AbortController();
  let stopParent: Unsubscribe = () => undefined;
  let done = false;
  const settle = (reason: unknown): void => {
    if (done) return;
    done = true;
    const stop = stopParent;
    stopParent = () => undefined;
    stop();
    clock.clearTimeout(handle);
    controller.abort(reason);
  };
  const handle = clock.setTimeout(() => settle(timeoutReason('The timeout elapsed')), ms);
  (handle as { unref?: () => void }).unref?.();
  stopParent = subscribeParent(options.signal, (reason) => settle(reason));
  return {
    signal: controller.signal,
    cancel: (): void => {
      if (done) return;
      done = true;
      const stop = stopParent;
      stopParent = () => undefined;
      stop();
      clock.clearTimeout(handle);
    },
  };
}
