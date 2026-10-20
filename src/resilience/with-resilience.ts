import { noop, onAbort, timeoutReason } from '../internal/abort.ts';
import { getClock, schedule } from '../internal/clock.ts';
import { invalidArgument, invalidRange } from '../internal/errors.ts';
import {
  assertDuration,
  assertFunction,
  assertInteger,
  assertOptionalSignal,
  assertOptionsObject,
} from '../internal/validate.ts';
import { err, ok, type SafeResult } from '../result/result.ts';
import { captureFailure, validateCaptureOptions, type CaptureOptions } from '../result/try.ts';

export interface AttemptContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
}

export type RunFailure<E = unknown> =
  | { readonly kind: 'task'; readonly error: E; readonly attempt: number }
  | { readonly kind: 'timeout'; readonly scope: 'attempt' | 'total'; readonly attempt: number; readonly timeoutMs: number }
  | { readonly kind: 'aborted'; readonly reason: unknown; readonly attempt: number };

export interface ResilienceOptions<E = unknown> extends CaptureOptions {
  readonly signal?: AbortSignal;
  readonly retries?: number;
  readonly retrySafe?: boolean;
  readonly shouldRetry?: (error: E, attempt: number) => boolean;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly mapError?: (raw: unknown) => E;
}

const abortedEnvelopes = new WeakSet<object>();

export function isUserAbort(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as { ok?: unknown; error?: unknown };
  const candidate = Array.isArray(value) && result.ok === false ? result.error : value;
  return typeof candidate === 'object' && candidate !== null && abortedEnvelopes.has(candidate);
}

function failure<E>(value: RunFailure<E>): SafeResult<never, RunFailure<E>> {
  const envelope = Object.freeze(value);
  if (envelope.kind === 'aborted') abortedEnvelopes.add(envelope);
  return err(envelope);
}

function validate(options: ResilienceOptions<unknown>): void {
  assertOptionsObject('options', options);
  assertOptionalSignal('signal', options.signal);
  validateCaptureOptions(options);
  const retries = options.retries ?? 0;
  assertInteger('retries', retries, 0);
  if (retries > 0) {
    if (options.retrySafe !== true) throw invalidArgument('retries require retrySafe: true');
    assertFunction('shouldRetry', options.shouldRetry);
  }
  if (options.attemptTimeoutMs !== undefined) assertDuration('attemptTimeoutMs', options.attemptTimeoutMs);
  if (options.totalTimeoutMs !== undefined) assertDuration('totalTimeoutMs', options.totalTimeoutMs);
  const base = options.baseDelayMs ?? 100;
  const max = options.maxDelayMs ?? 5000;
  assertDuration('baseDelayMs', base);
  assertDuration('maxDelayMs', max);
  if (max < base) throw invalidRange('maxDelayMs must be at least baseDelayMs');
}

export function withResilience<T, E>(
  task: (context: AttemptContext) => T | PromiseLike<T>,
  options: ResilienceOptions<E> & { readonly mapError: (raw: unknown) => E },
): Promise<SafeResult<T, RunFailure<E>>>;
export function withResilience<T>(
  task: (context: AttemptContext) => T | PromiseLike<T>,
  options?: ResilienceOptions<unknown>,
): Promise<SafeResult<T, RunFailure<unknown>>>;
export async function withResilience<T>(
  task: (context: AttemptContext) => T | PromiseLike<T>,
  options: ResilienceOptions<unknown> = {},
): Promise<SafeResult<T, RunFailure<unknown>>> {
  assertFunction('task', task);
  validate(options);
  const clock = getClock();
  const retries = options.retries ?? 0;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const { signal, attemptTimeoutMs, totalTimeoutMs } = options;
  const startedAt = clock.now();

  return new Promise((resolve, reject) => {
    let terminal = false;
    let attempt = 0;
    let controller: AbortController | undefined;
    let cancelAttemptTimer = noop;
    let cancelBackoff = noop;
    let cancelTotalTimer = noop;

    const cleanup = (): void => {
      terminal = true;
      stopListening();
      cancelAttemptTimer();
      cancelBackoff();
      cancelTotalTimer();
    };
    const finish = (outcome: SafeResult<T, RunFailure<unknown>>, abort = false, reason?: unknown): void => {
      if (terminal) return;
      cleanup();
      if (abort) controller?.abort(reason);
      resolve(outcome);
    };
    const fail = (error: unknown): void => {
      if (terminal) return;
      cleanup();
      controller?.abort(error);
      reject(error);
    };
    const stopListening = onAbort(signal, (reason) => {
      finish(failure({ kind: 'aborted', reason, attempt }), true, reason);
    });
    const timeout = (scope: 'attempt' | 'total', timeoutMs: number): void => {
      finish(failure({ kind: 'timeout', scope, attempt, timeoutMs }), true, timeoutReason(`The ${scope} timeout elapsed`));
    };

    const handleFailure = (raw: unknown): void => {
      cancelAttemptTimer();
      let error: unknown;
      let retry = false;
      try {
        error = captureFailure(raw, options);
        if (attempt <= retries) {
          const decision = options.shouldRetry!(error, attempt);
          if (typeof decision !== 'boolean') throw invalidArgument('shouldRetry must return a boolean');
          retry = decision;
        }
      } catch (hookError) {
        fail(hookError);
        return;
      }
      if (!retry) {
        finish(failure({ kind: 'task', error, attempt }));
        return;
      }
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = clock.random() * cap;
      if (totalTimeoutMs !== undefined && clock.now() - startedAt + delay >= totalTimeoutMs) {
        finish(failure({ kind: 'task', error, attempt }));
        return;
      }
      cancelBackoff = schedule(clock, delay, () => {
        cancelBackoff = noop;
        run();
      });
    };

    const run = (): void => {
      if (terminal) return;
      attempt++;
      controller = new AbortController();
      if (attemptTimeoutMs === 0) {
        timeout('attempt', 0);
        return;
      }
      if (attemptTimeoutMs !== undefined) {
        cancelAttemptTimer = schedule(clock, attemptTimeoutMs, () => timeout('attempt', attemptTimeoutMs));
      }
      const current = attempt;
      new Promise<T>((done) => done(task({ signal: controller!.signal, attempt: current }))).then(
        (value) => finish(ok(value)),
        (raw: unknown) => {
          if (!terminal) handleFailure(raw);
        },
      );
    };

    if (signal?.aborted === true) {
      finish(failure({ kind: 'aborted', reason: signal.reason, attempt }));
      return;
    }
    if (totalTimeoutMs === 0) {
      timeout('total', 0);
      return;
    }
    if (totalTimeoutMs !== undefined) {
      cancelTotalTimer = schedule(clock, totalTimeoutMs, () => timeout('total', totalTimeoutMs));
    }
    run();
  });
}
