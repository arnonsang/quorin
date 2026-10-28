# quorin/result

Failures as values: real tuple results and adapters that capture thrown errors.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `SafeResult<T, E>`

A result is a **real, frozen, two-element array** that also carries named fields. You can destructure it like a tuple or narrow it through `ok`.

```ts
import { ok, err, type SafeResult } from 'quorin/result';

function parsePort(text: string): SafeResult<number, string> {
  const port = Number(text);
  return Number.isInteger(port) ? ok(port) : err(`not a port: ${text}`);
}

const result = parsePort('8080');

if (result.ok) {
  result.data;       // number
} else {
  result.error;      // string
}

const [error, data] = result;          // tuple destructuring
Array.isArray(result);                 // true
result.unwrapOr(80);                   // number
result.mapData((port) => port + 1);    // SafeResult<number, never> on success
JSON.stringify(result);                // '[null,8080]'
```

Narrow with `result.ok`. Checking `if (error)` is not reliable because `E` may be `null`, `false`, `0`, or `''`. Native array methods keep their usual meaning and return plain arrays; the custom transformer is called `mapData` so it does not shadow `Array.prototype.map`. The container is frozen, but the payload is not. Results are local containers: JSON and structured cloning keep only the tuple, so rebuild results after transport.

## `trySafe(fn, options?)` and `trySafeSync(fn, options?)`

```ts
import { trySafe, trySafeSync, DefectError } from 'quorin/result';

const parsed = trySafeSync(() => JSON.parse(text)); // SafeResult<any, unknown>

const response = await trySafe(() => fetch(url), {
  mapError: (raw) => ({ kind: 'network', cause: raw }) as const,
});
```

| Option | Description |
| --- | --- |
| `mapError(raw)` | Builds the error type `E`. Without it, the error type is `unknown`. If the mapper throws, that error propagates. |
| `classifyDefect(raw)` | Return `true` to treat a value as a defect. |
| `onDefect(raw)` | Called before a defect is rethrown. |
| `catchDefects` | Set to `true` to capture defects as ordinary failures. |

Only `DefectError` (checked with `isDefect`) and values your `classifyDefect` approves are treated as programming defects and rethrown. Built-in constructors such as `TypeError` and `SyntaxError` are **not** defects by default, because `fetch` uses `TypeError` for network failures and JSON parsing uses `SyntaxError`.

`trySafe` takes a function, not an already started promise, so a synchronous throw is captured too.
