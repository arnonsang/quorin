import type { StandardSchemaV1 } from '../../src/boundary/index.ts';

export function fakeSchema<O>(
  validate: (value: unknown) => StandardSchemaV1.Result<O> | Promise<StandardSchemaV1.Result<O>>,
  vendor = 'fake',
): StandardSchemaV1<unknown, O> {
  return { '~standard': { version: 1, vendor, validate } };
}
