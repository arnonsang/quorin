import { assertFunction } from '../internal/validate.ts';
import { isDefect } from './defect.ts';
import { err, ok, type SafeResult } from './result.ts';

export interface CaptureOptions {
  readonly classifyDefect?: (raw: unknown) => boolean;
  readonly onDefect?: (raw: unknown) => void;
  readonly catchDefects?: boolean;
}

export interface MappedCaptureOptions<E> extends CaptureOptions {
  readonly mapError: (raw: unknown) => E;
}

export function validateCaptureOptions(options: CaptureOptions & { mapError?: unknown } | undefined): void {
  if (options === undefined) return;
  if (options.classifyDefect !== undefined) assertFunction('classifyDefect', options.classifyDefect);
  if (options.onDefect !== undefined) assertFunction('onDefect', options.onDefect);
  if (options.mapError !== undefined) assertFunction('mapError', options.mapError);
}

export function captureFailure(raw: unknown, options: CaptureOptions & { mapError?: (raw: unknown) => unknown } | undefined): unknown {
  if (options?.catchDefects !== true && (isDefect(raw) || options?.classifyDefect?.(raw) === true)) {
    options?.onDefect?.(raw);
    throw raw;
  }
  return options?.mapError === undefined ? raw : options.mapError(raw);
}

export function trySafeSync<T, E>(fn: () => T, options: MappedCaptureOptions<E>): SafeResult<T, E>;
export function trySafeSync<T>(fn: () => T, options?: CaptureOptions): SafeResult<T, unknown>;
export function trySafeSync<T>(
  fn: () => T,
  options?: CaptureOptions & { mapError?: (raw: unknown) => unknown },
): SafeResult<T, unknown> {
  assertFunction('fn', fn);
  validateCaptureOptions(options);
  let value: T;
  try {
    value = fn();
  } catch (raw) {
    return err(captureFailure(raw, options));
  }
  return ok(value);
}

export function trySafe<T, E>(fn: () => T | PromiseLike<T>, options: MappedCaptureOptions<E>): Promise<SafeResult<T, E>>;
export function trySafe<T>(fn: () => T | PromiseLike<T>, options?: CaptureOptions): Promise<SafeResult<T, unknown>>;
export async function trySafe<T>(
  fn: () => T | PromiseLike<T>,
  options?: CaptureOptions & { mapError?: (raw: unknown) => unknown },
): Promise<SafeResult<T, unknown>> {
  assertFunction('fn', fn);
  validateCaptureOptions(options);
  let value: T;
  try {
    value = await fn();
  } catch (raw) {
    return err(captureFailure(raw, options));
  }
  return ok(value);
}
