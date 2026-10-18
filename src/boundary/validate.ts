import { invalidArgument } from '../internal/errors.ts';
import { BoundaryValidationError } from './boundary-validation-error.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';

export function assertSchema(schema: unknown): asserts schema is StandardSchemaV1 {
  const props = (schema as Partial<StandardSchemaV1> | null)?.['~standard'];
  if ((typeof schema !== 'object' && typeof schema !== 'function') || schema === null || props === undefined) {
    throw invalidArgument('schema must implement Standard Schema');
  }
  if (props.version !== 1) throw invalidArgument('Only Standard Schema version 1 is supported');
  if (typeof props.validate !== 'function') throw invalidArgument('schema validate must be a function');
}

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: BoundaryValidationError };

export async function runSchema<S extends StandardSchemaV1>(
  schema: S,
  input: unknown,
): Promise<Validation<StandardSchemaV1.InferOutput<S>>> {
  const props = schema['~standard'];
  const result = await props.validate(input);
  if (typeof result !== 'object' || result === null) throw invalidArgument('schema returned an invalid result');
  if (result.issues !== undefined) return { ok: false, error: new BoundaryValidationError(props.vendor, result.issues) };
  return { ok: true, value: (result as StandardSchemaV1.SuccessResult<StandardSchemaV1.InferOutput<S>>).value };
}
