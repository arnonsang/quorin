import { invalidArgument } from '../internal/errors.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';
import { assertSchema, runSchema } from './validate.ts';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export async function parseEnv<S extends StandardSchemaV1>(
  schema: S,
  source: EnvSource,
): Promise<StandardSchemaV1.InferOutput<S>> {
  assertSchema(schema);
  if (typeof source !== 'object' || source === null) throw invalidArgument('source must be an environment record');
  const result = await runSchema(schema, { ...source });
  if (!result.ok) throw result.error;
  return result.value;
}
