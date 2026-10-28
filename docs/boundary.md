# quorin/boundary

Validation at the edges of your program with any Standard Schema validator.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

Works with any validator that implements [Standard Schema](https://standardschema.dev) v1, such as Zod, Valibot, and ArkType. The Standard Schema types are vendored, so there is no runtime or type dependency on the spec package.

## `parseEnv(schema, source)`

```ts
import { z } from 'zod';
import { parseEnv } from 'quorin/boundary';

const env = await parseEnv(
  z.object({
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().url(),
  }),
  process.env, // or Deno.env.toObject(), or worker bindings
);
```

The environment source is always passed in explicitly; quorin never reads `process` or `Deno` itself. The source is not mutated. It resolves to the schema **output** (so transforms and defaults apply) or rejects with `BoundaryValidationError`. Async validators are supported. A validator that throws propagates unchanged. Error messages never include environment values.

## `defineBoundary(schema, handler, options?)`

```ts
import * as v from 'valibot';
import { defineBoundary, BoundaryValidationError } from 'quorin/boundary';

const createUser = defineBoundary(
  v.object({ email: v.pipe(v.string(), v.email()) }),
  async (input) => db.users.insert(input),
);

const result = await createUser(await request.json());
if (!result.ok && result.error instanceof BoundaryValidationError) {
  return new Response('Invalid input', { status: 400 });
}
```

Returns `(input: unknown) => Promise<SafeResult<R, E>>`. The handler runs only after validation succeeds and receives the schema output type. Validation issues resolve as a failed result holding `BoundaryValidationError`. Handler failures are captured with the [result module's](./result.md#trysafefn-options-and-trysafesyncfn-options) rules and accept the same options. A validator that throws or rejects is an integration bug and rejects instead of pretending to be invalid user input. An empty `issues` array still counts as a failure.

## `formatIssues(errorOrIssues)` and `BoundaryValidationError`

```ts
formatIssues(error);
// [{ path: ['user', 'email'], messages: ['Invalid email'] }, ...]
```

`BoundaryValidationError` has `code: 'VALIDATION_FAILED'`, `vendor`, and the complete frozen `issues` array. Its message states the vendor and issue count only. `formatIssues` is an opt-in display helper. It groups messages by path in first-seen order and keeps segments typed, so `0` and `'0'`, symbols, dots, and `__proto__` never collide.
