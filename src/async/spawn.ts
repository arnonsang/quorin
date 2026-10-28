import { onAbort } from '../internal/abort.ts';
import { assertFunction, assertOptionalSignal, assertOptionsObject } from '../internal/validate.ts';
import type { SafeResult } from '../result/result.ts';
import { trySafe, type CaptureOptions } from '../result/try.ts';
import type { TaskContext } from './types.ts';

export interface SpawnOptions extends CaptureOptions {
  readonly signal?: AbortSignal;
}

/** A running task started by `spawn`. */
export interface SpawnedTask<T, E = unknown> {
  /** The task's own signal. It aborts on `cancel` or when the parent signal aborts. */
  readonly signal: AbortSignal;
  /** Settles when the task does: its value or captured failure. Defects reject. */
  readonly result: Promise<SafeResult<T, E>>;
  /** Asks the task to stop by aborting its signal. Idempotent. */
  cancel(reason?: unknown): void;
}

/**
 * Starts `fn` right away as a cancellable task and returns a handle instead of a bare promise.
 * The task receives its own signal, linked to the optional parent `signal`. `result` settles
 * with a `SafeResult` when the function settles, so ordinary failures never become unhandled
 * rejections; defects still reject. A parent signal that is already aborted resolves `result`
 * with the abort reason without calling `fn`.
 */
export function spawn<T, E>(
  fn: (context: TaskContext) => T | PromiseLike<T>,
  options: SpawnOptions & { readonly mapError: (raw: unknown) => E },
): SpawnedTask<T, E>;
export function spawn<T>(fn: (context: TaskContext) => T | PromiseLike<T>, options?: SpawnOptions): SpawnedTask<T, unknown>;
export function spawn<T>(
  fn: (context: TaskContext) => T | PromiseLike<T>,
  options: SpawnOptions & { readonly mapError?: (raw: unknown) => unknown } = {},
): SpawnedTask<T, unknown> {
  assertFunction('fn', fn);
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
  const controller = new AbortController();
  const parent = options.signal;
  if (parent?.aborted === true) controller.abort(parent.reason);
  const stop = onAbort(parent, (reason) => controller.abort(reason));
  const signal = controller.signal;
  const result = trySafe(() => {
    if (signal.aborted) throw signal.reason;
    return fn({ signal });
  }, options as CaptureOptions);
  result.then(stop, stop);
  return Object.freeze({
    signal,
    result,
    cancel: (reason?: unknown): void => {
      controller.abort(reason);
    },
  });
}
