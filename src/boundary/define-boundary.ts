import { err, type SafeResult } from '../result/result.ts';
import { trySafe, validateCaptureOptions, type CaptureOptions, type MappedCaptureOptions } from '../result/try.ts';
import { assertFunction, assertOptionsObject } from '../internal/validate.ts';
import type { BoundaryValidationError } from './boundary-validation-error.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';
import { assertSchema, runSchema } from './validate.ts';

export type Boundary<R, E> = (input: unknown) => Promise<SafeResult<R, E>>;

/**
 * Wraps a handler so its input is validated first. Validation issues and handler failures
 * resolve as failed results; validator crashes and defects reject.
 */
export function defineBoundary<S extends StandardSchemaV1, R, E>(
  schema: S,
  handler: (input: StandardSchemaV1.InferOutput<S>) => R | PromiseLike<R>,
  options: MappedCaptureOptions<E>,
): Boundary<R, BoundaryValidationError | E>;
export function defineBoundary<S extends StandardSchemaV1, R>(
  schema: S,
  handler: (input: StandardSchemaV1.InferOutput<S>) => R | PromiseLike<R>,
  options?: CaptureOptions,
): Boundary<R, unknown>;
export function defineBoundary(
  schema: StandardSchemaV1,
  handler: (input: unknown) => unknown,
  options?: CaptureOptions & { mapError?: (raw: unknown) => unknown },
): Boundary<unknown, unknown> {
  assertSchema(schema);
  assertFunction('handler', handler);
  assertOptionsObject('options', options);
  validateCaptureOptions(options);
  return async (input: unknown) => {
    const validation = await runSchema(schema, input);
    if (!validation.ok) return err(validation.error);
    return trySafe(() => handler(validation.value), options as CaptureOptions);
  };
}
