<div align="center">

# quorin

**Small primitives for dependable TypeScript.**

[![npm version](https://img.shields.io/npm/v/quorin.svg)](https://www.npmjs.com/package/quorin)
[![CI](https://github.com/arnonsang/quorin/actions/workflows/ci.yml/badge.svg)](https://github.com/arnonsang/quorin/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/arnonsang/quorin/branch/main/graph/badge.svg)](https://codecov.io/gh/arnonsang/quorin)
[![license](https://img.shields.io/npm/l/quorin.svg)](./LICENSE)
![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

</div>

Quorin (pronounced **KWOR-in**) is a set of modular TypeScript utilities for data structures, bytes, objects, async work, results, validation, retries, caching, and state. It has no runtime dependencies.

Every primitive has a defined input domain, a documented error channel, a clear ownership policy (does it copy, mutate, or return references?), and explicit resource lifetimes. The modules share the same cancellation rules, so composing them does not introduce surprising behavior.

```ts
import { Deque, ok, createCache } from 'quorin';
import { concatBytes } from 'quorin/bytes';
import { defineBoundary } from 'quorin/boundary';
import { withResilience } from 'quorin/resilience';
```

> **Status:** `0.1.0` preview. The API may still change before `1.0`.

## Why quorin

I built quorin because the small utilities I reached for in every TypeScript project each followed their own rules, and the gaps between those rules kept turning into production bugs:

- A timeout written with `Promise.race` stops the caller from waiting, but the request keeps running and its late rejection can go unhandled.
- A concurrency limiter and a cache from two different packages disagree on what an `AbortSignal` means, so cancelling a request frees a slot in one and leaks it in the other.
- Retry helpers retry anything that throws, including requests that are not safe to repeat.
- Treating every `TypeError` as a programming bug also hides network failures, because `fetch` throws `TypeError` too.
- Some caches treat storing `undefined` as a delete, and hand-rolled request coalescing lets a late response overwrite newer data.
- Deep clone helpers return objects that look right but break as soon as a method touches a private field.

Each of these can be fixed on its own. What I wanted was one set of primitives that agree with each other: the same cancellation model everywhere, results you can check without guessing, errors with stable codes, and clear rules about who owns and mutates data. You can adopt a single function without adopting a framework, and the pieces compose without surprises.

quorin is deliberately small. It is not a framework, an HTTP client, a schema library, or a distributed cache. It does a few common jobs carefully and documents exactly where its guarantees stop.

### The name

Quorin (KWOR-in) is a made-up name drawn from *quorum*, the smallest group that has to be present before a body can act. Quorin aims to be that quorum for TypeScript code: a small set of primitives that, together, are enough to make async work, data handling, and failure handling dependable. The opening sound also echoes *core*, which is where these primitives live in a codebase.

## Contents

- [Why quorin](#why-quorin)
- [Install](#install)
- [Quick start](#quick-start)
- [Modules](#modules)
- [quorin/struct](#quorinstruct)
- [quorin/object](#quorinobject)
- [quorin/bytes](#quorinbytes)
- [quorin/async](#quorinasync)
- [quorin/signal](#quorinsignal)
- [quorin/result](#quorinresult)
- [quorin/boundary](#quorinboundary)
- [quorin/resilience](#quorinresilience)
- [quorin/cache](#quorincache)
- [quorin/state](#quorinstate)
- [Errors](#errors)
- [Cancellation model](#cancellation-model)
- [Runtime support](#runtime-support)
- [Agent skill](#agent-skill)
- [Development](#development)
- [License](#license)

## Install

```sh
npm install quorin
```

```sh
pnpm add quorin
yarn add quorin
bun add quorin
```

Quorin ships one ESM build with type declarations and source maps. On every supported Node version (22.19.0 and later) you can also `require('quorin')`, because no module in the graph uses top-level await. CommonJS TypeScript projects need `module: "NodeNext"`; see [TypeScript settings](#typescript-settings).

## Quick start

A profile loader that validates untrusted input, coalesces concurrent requests, serves stale data while it refreshes, and retries transient failures with a bounded deadline:

```ts
import { z } from 'zod';
import { defineBoundary } from 'quorin/boundary';
import { createCache } from 'quorin/cache';
import { withResilience } from 'quorin/resilience';

class TransientReadError extends Error {}

const profiles = createCache<string, Profile>({
  max: 500,
  ttlMs: 30_000,
  swrMs: 10_000,
  load: async (id, { signal }) => {
    const result = await withResilience(
      ({ signal: attemptSignal }) => fetchProfile(id, attemptSignal),
      {
        signal,
        retries: 2,
        retrySafe: true,
        shouldRetry: (error) => error instanceof TransientReadError,
        attemptTimeoutMs: 2_000,
        totalTimeoutMs: 6_000,
      },
    );
    if (!result.ok) throw result.error;
    return result.data;
  },
});

const getProfile = defineBoundary(z.string().uuid(), (id) => profiles.getOrFetch(id));

const outcome = await getProfile(untrustedInput);
if (outcome.ok) {
  const [, profile] = outcome;
  renderProfile(profile);
} else {
  reportFailure(outcome.error);
}
```

## Modules

Import everything from the root, or import one module through its subpath. Both resolve to the same objects, so `instanceof` checks and symbols agree.

| Subpath | Purpose | Exports |
| --- | --- | --- |
| `quorin/struct` | Data structures | `Deque`, `ValueMap`, `Multimap` |
| `quorin/object` | Paths and JSON data | `getPath`, `setPath`, `deepMerge`, `stableStringify`, `SecurityError` |
| `quorin/bytes` | Byte conversion and hashing | `concatBytes`, `equalsBytes`, `stringToBytes`, `bytesToString`, `toHex`, `fromHex`, `toBase64`, `fromBase64`, `fastHash` |
| `quorin/async` | Bounded async execution | `concurrencyLimit`, `mapAsync`, `createChannel`, `createRateLimiter`, `QueueError`, `ChannelError` |
| `quorin/signal` | Cancellation helpers | `onAbort`, `timeoutSignal` |
| `quorin/result` | Explicit outcomes | `ok`, `err`, `trySafe`, `trySafeSync`, `isDefect`, `DefectError` |
| `quorin/boundary` | Standard Schema validation | `parseEnv`, `defineBoundary`, `formatIssues`, `BoundaryValidationError` |
| `quorin/resilience` | Retries and deadlines | `withResilience`, `parseRetryAfter`, `isUserAbort` |
| `quorin/cache` | Bounded local caching | `createCache`, `CacheError` |
| `quorin/state` | Graph copy, compare, redact | `safeClone`, `isEqual`, `redact`, `CLONE_SYMBOL`, `REDACTED`, `TRUNCATED`, `StateError` |

Importing any entry point has no side effects: no timers, no environment access, no DOM access, no network.

---

## quorin/struct

### `Deque<T>`

A double-ended queue on a growable ring buffer. End operations are amortized O(1).

```ts
import { Deque } from 'quorin/struct';

const queue = new Deque<string>(); // initialCapacity defaults to 16
queue.push('b');                    // returns the new size
queue.unshift('a');
queue.peek();                       // 'a'
queue.peekBack();                   // 'b'
queue.shift();                      // 'a'
queue.pop();                        // 'b'
queue.size;                         // 0
```

| Member | Description |
| --- | --- |
| `new Deque(initialCapacity?)` | Capacity is rounded up to a power of two (minimum 8, maximum 2^30). |
| `size` | Number of stored values. |
| `push(value)` / `unshift(value)` | Add at the back or front. Returns the new size. |
| `pop()` / `shift()` | Remove from the back or front. Returns `undefined` when empty. |
| `peek()` / `peekBack()` | Read the front or back without removing. |
| `clear()` | Remove everything and reset to the initial capacity. |
| `[Symbol.iterator]()` | Iterate front to back. |

Empty reads return `undefined`. If you store `undefined`, use `size` to tell the difference. Changing the deque while iterating throws an error with code `CONCURRENT_MODIFICATION`. Removed slots are cleared, so the deque does not retain removed values.

### `ValueMap<K extends JsonValue, V>`

A map whose keys are compared by structure instead of identity.

```ts
import { ValueMap } from 'quorin/struct';

const prices = new ValueMap<{ sku: string; size: string }, number>();
prices.set({ sku: 'tee', size: 'M' }, 20);
prices.get({ size: 'M', sku: 'tee' }); // 20, record key order does not matter
```

- Keys must be [JSON values](#json-values). Unsupported keys throw `UNSUPPORTED_VALUE` in `set`, `get`, `has`, and `delete` alike.
- Record key order is ignored, array order is significant, and `-0` equals `0`.
- Keys are **snapshotted** on `set`. Mutating the original key object afterwards does not affect the map.
- `entries()`, `keys()`, and iteration return detached copies of keys, in insertion order.
- Values are stored by reference.
- Lookup cost grows with key size (the key is traversed and canonicalized).

API: `size`, `set(key, value)` (returns `this`), `get`, `has`, `delete`, `clear`, `entries`, `keys`, `values`.

### `Multimap<K, V>`

A map from each key to an ordered list of values, duplicates included. Keys use native `Map` semantics.

```ts
import { Multimap } from 'quorin/struct';

const tags = new Multimap<string, string>();
tags.add('post-1', 'ts').add('post-1', 'esm');
tags.get('post-1');  // ['ts', 'esm'] (a fresh copy)
tags.get('missing'); // []
tags.size;           // 1 key
tags.valueCount;     // 2 values
```

API: `size`, `valueCount`, `add(key, value)` (returns `this`), `get`, `has`, `delete` (removes the whole key), `clear`, `keys`, `entries`. Arrays returned by `get` and iteration are copies.

---

## quorin/object

### Paths

A path is either an array of segments or a dotted string.

- Array form: `['users', 0, 'name']`. Number segments address array indexes, string segments address record keys.
- Dotted form: `'users.name'`. Every piece is a string segment. Empty pieces are rejected. There is no bracket syntax or escaping, so the literal key `a.b` must be written as `['a.b']`.
- `__proto__`, `constructor`, and `prototype` are rejected anywhere in a path with `SecurityError` (code `UNSAFE_PATH`).

### `getPath(target, path, fallback?)`

```ts
import { getPath } from 'quorin/object';

const config = { server: { port: 8080, host: undefined }, tags: ['a'] };

getPath(config, 'server.port');        // 8080, typed as number
getPath(config, ['tags', 0]);          // 'a'
getPath(config, 'server.timeout', 30); // 30 (missing, so the fallback is used)
getPath(config, 'server.host', 'x');   // undefined (present, so no fallback)
```

Reads only **own data properties**. Inherited properties count as missing, and accessors throw `UNSUPPORTED_VALUE` instead of being invoked. The return type is inferred for literal paths up to eight segments; dynamic paths return `unknown`.

### `setPath(target, path, value)`

```ts
import { setPath } from 'quorin/object';

const settings: Record<string, unknown> = {};
setPath(settings, ['theme', 'colors', 0], '#fff');
// settings.theme is a null-prototype record, settings.theme.colors is ['#fff']
```

- Mutates a plain record or dense array that you own.
- Creates missing branches: null-prototype records for string segments, arrays for number segments.
- Updates an existing array index or appends at `length`. Holes are rejected.
- Refuses to replace an existing primitive branch, to walk through class instances, to invoke setters, or to write read-only or non-extensible targets.
- Validates the whole path first and performs a single write, so a failure leaves the input unchanged.
- For literal paths the value type is checked against the location.

### `deepMerge(left, right)`

```ts
import { deepMerge } from 'quorin/object';

const merged = deepMerge(
  { db: { host: 'localhost', port: 5432 }, flags: ['a'] },
  { db: { port: 6543 }, flags: ['b'] },
);
// { db: { host: 'localhost', port: 6543 }, flags: ['b'] }
```

Returns a newly allocated graph and never mutates its inputs. Records merge recursively; arrays and primitives from `right` replace those from `left` (arrays are cloned, not concatenated). A `null` on the right replaces a record. Both inputs must be JSON records. Unsupported values and forbidden keys anywhere in either input throw. The result type reflects replaced properties correctly instead of using a plain intersection.

### `stableStringify(value, options?)`

```ts
import { stableStringify } from 'quorin/object';

stableStringify({ b: 1, a: [2, { d: 1, c: 0 }] });
// '{"a":[2,{"c":0,"d":1}],"b":1}'
```

Valid JSON with record keys sorted by UTF-16 code unit order. Array order is kept, `-0` becomes `0`, and Unicode is not normalized. Repeated references are serialized by value; cycles throw. This is a stable format for cache keys and fingerprints within its contract, not RFC 8785 or a signature protocol.

### JSON values

`JsonValue` is `null`, booleans, strings, finite numbers, dense arrays of JSON values, and plain records (ordinary or null prototype) whose own enumerable string keys hold JSON values. Accessors, symbols, non-enumerable properties, sparse arrays, functions, `undefined`, `bigint`, cycles, and custom prototypes are outside the domain and are rejected at runtime.

Traversal is bounded. Functions that walk graphs accept `{ maxDepth, maxNodes }` (defaults 128 and 100000) and throw `TRAVERSAL_LIMIT` when exceeded.

---

## quorin/bytes

All functions operate on the visible bytes of a `Uint8Array` (respecting `byteOffset` and `byteLength`), accept Node `Buffer` instances, and return new buffers. Views over `SharedArrayBuffer` and detached buffers are rejected.

```ts
import { concatBytes, toBase64, fromBase64, toHex, fastHash, stringToBytes } from 'quorin/bytes';

const bytes = concatBytes(stringToBytes('hello '), stringToBytes('world'));
toHex(bytes);                                   // '68656c6c6f20776f726c64'
toBase64(bytes, { alphabet: 'base64url', omitPadding: true });
fromBase64('aGk', { padding: 'optional' });     // Uint8Array [104, 105]
fastHash(bytes);                                // unsigned 32-bit FNV-1a
```

| Function | Contract |
| --- | --- |
| `concatBytes(...parts)` | One allocation, copies in order. No input means an empty array. |
| `equalsBytes(a, b)` | Length and content comparison. Exits early, so it is **not** constant time. |
| `stringToBytes(text)` | UTF-8 encode. |
| `bytesToString(bytes, { fatal = true, ignoreBOM = false })` | UTF-8 decode. Invalid input throws `INVALID_ENCODING` unless `fatal` is false. |
| `toHex(bytes)` | Lowercase, no prefix. |
| `fromHex(text)` | Either case. Rejects odd length, whitespace, `0x`, and any non-hex character. |
| `toBase64(bytes, { alphabet, omitPadding })` | `'base64'` (default) or `'base64url'`. Padded by default. |
| `fromBase64(text, { alphabet, padding })` | Strict. `padding` is `'required'` (default), `'optional'`, or `'forbidden'`. Rejects whitespace, the other alphabet, bad padding, impossible lengths, and nonzero pad bits. |
| `fastHash(bytes)` | FNV-1a 32-bit, unsigned. Not for security or for hash tables fed by untrusted input. To hash text, call `fastHash(stringToBytes(text))`. |

Malformed hex, base64, and UTF-8 throw a `SyntaxError` with code `INVALID_ENCODING`. Encoder and decoder instances are created lazily on first use.

---

## quorin/async

### `concurrencyLimit(concurrency, { maxPending = 1024 })`

```ts
import { concurrencyLimit } from 'quorin/async';

const limit = concurrencyLimit(4, { maxPending: 100 });

const body = await limit(async ({ signal }) => {
  const response = await fetch(url, { signal });
  return response.text();
}, { signal: request.signal });

limit.activeCount;  // running underlying tasks
limit.pendingCount; // queued tasks
limit.clear();      // reject queued tasks with QUEUE_CLEARED
```

- Tasks start in FIFO order. Each task receives `{ signal }` and may return a value or a promise.
- When all slots are busy and `maxPending` tasks are queued, new calls reject with `QueueError` code `QUEUE_FULL`.
- A synchronous throw takes the same path as a rejection and releases its slot.
- **Aborting a queued task** removes it and rejects immediately with the signal's reason.
- **Aborting a running task** aborts its `signal` and rejects the caller immediately, but the task keeps its slot until the underlying work actually settles. The concurrency ceiling therefore holds even for tasks that ignore cancellation.
- `clear(reason?)` rejects pending tasks only. Running tasks continue under their own signals.

### `mapAsync(items, mapper, { concurrency = 4, signal })`

```ts
import { mapAsync } from 'quorin/async';

const pages = await mapAsync(urls, async (url, index, { signal }) => {
  const response = await fetch(url, { signal });
  return response.json();
}, { concurrency: 8 });
```

Results are returned in input order. The input array is snapshotted when the call starts, and sparse arrays are rejected. The first mapper failure or a caller abort stops new work, aborts the signal passed to running mappers, and rejects. Work that already started may continue; its settlement is still observed so nothing becomes an unhandled rejection. Result storage is O(n) and scheduling state is O(concurrency). This is an array mapper, not a streaming API.

### `createChannel({ capacity = 0, maxPending = 1024 })`

```ts
import { createChannel } from 'quorin/async';

const channel = createChannel<string>({ capacity: 16 });

await channel.put(delta, { signal });  // waits while the buffer is full: backpressure
const delta = await channel.take({ signal });
channel.close();                       // buffered values stay takeable, then takes reject

for await (const value of channel) {
  render(value);                       // ends after close and drain
}
```

- `capacity` bounds buffered values. The default `0` means every `put` waits for a `take`, so backpressure is immediate and nothing accumulates.
- `maxPending` bounds waiting puts. Beyond it, `put` rejects with `QueueError` code `QUEUE_FULL`, so a producer that cannot await (an event handler) fails loudly instead of growing forever.
- `close()` stops puts, rejects waiting puts and takes with `ChannelError` code `CHANNEL_CLOSED`, and lets buffered values drain first. A `put` after close rejects. Idempotent.
- `put` and `take` accept `{ signal }`. Aborting removes the waiter and rejects with the signal's reason; that is caller cancellation, distinct from closing.
- Values are passed by reference; `undefined` is a valid value. `size`, `pendingPuts`, `pendingTakes`, and `closed` are live counters.
- A waiting put never coexists with a waiting take: an arriving take hands the oldest waiting put straight through without touching the buffer. Order is FIFO on both sides.

Use a channel to bridge a push source (events, SSE frames) to pull-based consumers through a bounded, abort-aware queue. Use `mapAsync` for arrays.

### `createRateLimiter({ rate, intervalMs = 1000, burst = rate, maxPending = 1024 })`

```ts
import { createRateLimiter } from 'quorin/async';

const limiter = createRateLimiter({ rate: 100, intervalMs: 60_000, burst: 25 });

await limiter.acquire({ weight: 1, signal });  // FIFO, waits for refill
if (limiter.tryAcquire(1)) {
  // got tokens at once, and nobody was waiting ahead
}
limiter.tokens;  // current tokens, refilled lazily
```

- Token bucket: `rate` tokens accrue per `intervalMs`, capped at `burst`. The bucket starts full and refills continuously on the injected clock, so tests advance fake time.
- `acquire({ weight, signal })` consumes `weight` tokens (fractional weights fit token-based limits). Waiters are served in strict FIFO order, even when a later waiter needs fewer tokens. Beyond `maxPending` waiting acquires, `acquire` rejects with `QueueError` code `QUEUE_FULL`.
- `tryAcquire(weight)` consumes at once and returns false when the bucket lacks tokens or anyone is waiting, so it never jumps the queue.
- Aborting a waiting `acquire` removes it and rejects with the signal's reason. A `weight` above `burst` throws `INVALID_ARGUMENT` because it could never be satisfied.

Combine with `withResilience`: gate calls with the limiter, and let `retryDelayMs` honor `Retry-After` when the server still answers 429.

---

## quorin/signal

### `onAbort(signal, listener)`

```ts
import { onAbort } from 'quorin/signal';

const unsubscribe = onAbort(request.signal, (reason) => cleanup());
try {
  await work();
} finally {
  unsubscribe();  // idempotent; cannot leak the listener
}
```

Subscribes to a signal's abort with the reason. An already aborted signal invokes the listener synchronously. The returned unsubscribe is idempotent and removes the listener; the listener also detaches itself after firing once.

### `timeoutSignal(ms, { signal })`

```ts
import { timeoutSignal } from 'quorin/signal';

const deadline = timeoutSignal(5_000, { signal: request.signal });
try {
  await fetch(url, { signal: deadline.signal });
} finally {
  deadline.cancel();  // clears the timer without aborting
}
```

- Aborts with a `TimeoutError` after `ms` on quorin's injected clock, so tests advance fake time instead of waiting (unlike `AbortSignal.timeout`, which only reads the real clock).
- An optional parent `signal` aborts the deadline early with the parent's reason and clears the timer, replacing hand-rolled `AbortSignal.any` composition.
- `cancel()` clears the timer without aborting and is idempotent. A pending timer does not keep the process alive.
- `ms` must be a nonnegative number of milliseconds, at most `2147483647`; anything else throws `INVALID_ARGUMENT`.

---

## quorin/result

### `SafeResult<T, E>`

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

### `trySafe(fn, options?)` and `trySafeSync(fn, options?)`

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

---

## quorin/boundary

Works with any validator that implements [Standard Schema](https://standardschema.dev) v1, such as Zod, Valibot, and ArkType. The Standard Schema types are vendored, so there is no runtime or type dependency on the spec package.

### `parseEnv(schema, source)`

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

### `defineBoundary(schema, handler, options?)`

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

Returns `(input: unknown) => Promise<SafeResult<R, E>>`. The handler runs only after validation succeeds and receives the schema output type. Validation issues resolve as a failed result holding `BoundaryValidationError`. Handler failures are captured with the [result module's](#trysafefn-options-and-trysafesyncfn-options) rules and accept the same options. A validator that throws or rejects is an integration bug and rejects instead of pretending to be invalid user input. An empty `issues` array still counts as a failure.

### `formatIssues(errorOrIssues)` and `BoundaryValidationError`

```ts
formatIssues(error);
// [{ path: ['user', 'email'], messages: ['Invalid email'] }, ...]
```

`BoundaryValidationError` has `code: 'VALIDATION_FAILED'`, `vendor`, and the complete frozen `issues` array. Its message states the vendor and issue count only. `formatIssues` is an opt-in display helper. It groups messages by path in first-seen order and keeps segments typed, so `0` and `'0'`, symbols, dots, and `__proto__` never collide.

---

## quorin/resilience

### `withResilience(task, options?)`

```ts
import { withResilience, isUserAbort } from 'quorin/resilience';

const result = await withResilience(
  async ({ signal, attempt }) => {
    const response = await fetch(url, { signal });
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new TransientReadError(response.status);
    }
    return response.json(); // awaited inside, so the timeout covers the body
  },
  {
    retries: 3,
    retrySafe: true,
    shouldRetry: (error) => error instanceof TransientReadError,
    attemptTimeoutMs: 2_000,
    totalTimeoutMs: 8_000,
    signal: request.signal,
  },
);

if (result.ok) {
  use(result.data);
} else if (isUserAbort(result)) {
  // the caller gave up
} else {
  report(result.error); // RunFailure
}
```

Resolves to `SafeResult<T, RunFailure<E>>`:

```ts
type RunFailure<E = unknown> =
  | { kind: 'task'; error: E; attempt: number }
  | { kind: 'timeout'; scope: 'attempt' | 'total'; attempt: number; timeoutMs: number }
  | { kind: 'aborted'; reason: unknown; attempt: number };
```

| Option | Default | Description |
| --- | --- | --- |
| `retries` | `0` | Additional attempts. `retries: 2` means at most three attempts. |
| `retrySafe` | | Must be `true` when `retries > 0`. Confirms that repeating the operation is acceptable. |
| `shouldRetry(error, attempt)` | | Required when `retries > 0`. Must synchronously return a boolean. Nothing is retried by default. |
| `retryDelayMs(failure)` | none | Caller-supplied delay in milliseconds for the next retry, replacing the jittered curve. May return a promise. See `parseRetryAfter`. |
| `attemptTimeoutMs` | none | Per-attempt timeout. `0` expires before the task runs. |
| `totalTimeoutMs` | none | Deadline for the whole run, including backoff. |
| `baseDelayMs` / `maxDelayMs` | `100` / `5000` | Backoff before retry `j` is uniform in `[0, min(max, base * 2^j))`. |
| `signal` | none | Caller cancellation. |
| `mapError`, `classifyDefect`, `onDefect`, `catchDefects` | | Same as the result module. |

Behavior worth knowing:

- Each attempt gets a fresh `AbortSignal` and the task is invoked again; a started promise is never reused.
- **Library timeouts are terminal.** A timeout aborts the attempt signal and returns a timeout failure; it does not start another attempt. This prevents a new attempt from overlapping one that ignored cancellation.
- A retry is skipped when its delay would reach the total deadline. The last task failure is returned instead.
- When `retryDelayMs` is set, its value replaces the jittered delay for that retry, even beyond `maxDelayMs` (a `Retry-After` header is authoritative). The total deadline still applies, and a hook that throws, rejects, or resolves to anything but a nonnegative finite number rejects the run.
- A success observed before a terminal event wins. Late settlements after a terminal event are observed and ignored.
- Defects, invalid options, and errors thrown by hooks reject the returned promise.
- `isUserAbort(value)` recognizes only aborted failures created by this function (or results holding them). An error that happens to be named `AbortError` is not enough.

A resolved HTTP 500 response is a successful promise. Inspect the status and throw your own retryable error, and consume or cancel bodies you discard.

### `parseRetryAfter(header)`

```ts
import { parseRetryAfter } from 'quorin/resilience';

const delayMs = parseRetryAfter(response.headers.get('retry-after')); // number | null

const result = await withResilience(fetchThing, {
  retries: 2,
  retrySafe: true,
  shouldRetry: isRateLimited,
  retryDelayMs: ({ error }) => parseRetryAfter(retryAfterHeaderOf(error)) ?? 800,
});
```

Parses delta seconds (`'120'`) or an IMF-fixdate (`'Wed, 21 Oct 2015 07:28:00 GMT'`, the day of the week is not validated) into whole milliseconds to wait, relative to the injected clock. Dates in the past return `0`. Malformed values, and delays beyond `Number.MAX_SAFE_INTEGER` milliseconds, return `null` so callers can fall back to a default. Never throws.

---

## quorin/cache

### `createCache(options)`

```ts
import { createCache } from 'quorin/cache';

const sessions = createCache<string, Session>({ max: 1_000, ttlMs: 60_000 });
sessions.set('abc', session);
sessions.get('abc');    // fresh value or undefined
sessions.lookup('abc'); // { state: 'fresh' | 'stale', value } or { state: 'miss' }
```

A per-instance **strict LRU**: `size` never exceeds `max`. This bounds the number of entries, not their bytes.

| Option | Default | Description |
| --- | --- | --- |
| `max` | required | Positive integer entry limit. |
| `ttlMs` | `Infinity` | Freshness window, starting when a value is committed. Reads do not extend it. `0` means immediately expired. |
| `swrMs` | `0` | Extra window after `ttlMs` during which a stale value can be served while refreshing. |

| Method | Behavior |
| --- | --- |
| `get(key)` | Fresh value or `undefined`. Touches LRU order on a hit. |
| `has(key)` | Fresh presence. Does not touch LRU order. |
| `lookup(key)` | Discriminated `fresh`, `stale`, or `miss`. Use it to tell a stored `undefined` from a miss. Does not touch LRU order. |
| `set(key, value)` | Stores the value, touches LRU, and invalidates any load in flight for the key. Returns the cache. |
| `delete(key)` | Removes the entry and invalidates its load. Returns whether anything was removed or invalidated. |
| `clear()` | Removes everything and invalidates every load. |

Entries are fresh while `now < expiresAt`, stale while `now < staleUntil`, and expired afterwards. Expired entries are removed when read. `undefined` works as both key and value, with no sentinel. Values are stored and returned by reference.

### Loading caches

Pass a `load` function to get `getOrFetch`. Caches without `load` do not expose `getOrFetch` in their type.

```ts
const users = createCache<string, User>({
  max: 10_000,
  ttlMs: 30_000,
  swrMs: 30_000,
  maxInFlight: 32,
  loadTimeoutMs: 5_000,
  load: (id, { signal }) => fetchUser(id, { signal }),
  onBackgroundError: (error, id) => log.warn({ error }, 'refresh failed'),
});

// Inside a worker request handler:
const user = await users.getOrFetch(id, {
  signal: request.signal,
  onBackgroundTask: (task) => ctx.waitUntil(task),
});
```

| Option | Default | Description |
| --- | --- | --- |
| `load(key, { signal })` | | The one loader for this cache. |
| `maxInFlight` | `32` | Limit on unsettled loader calls, including invalidated loaders that have not settled yet. A new miss beyond the limit rejects with `CACHE_BUSY`; there is no waiting queue. |
| `loadTimeoutMs` | `30000` | Aborts the loader and rejects waiters with `CACHE_LOAD_TIMEOUT`. The slot stays used until the loader settles. |
| `onBackgroundError(error, key)` | | Observer for failed background refreshes. Exceptions it throws are swallowed. |

How `getOrFetch` behaves:

- **Fresh:** returns the value.
- **Stale:** returns the stale value and starts or joins one background refresh. The caller's signal does not cancel the shared refresh. `onBackgroundTask(promise)` is called once with a promise that settles when the loader does, so hosts such as workers can keep it alive.
- **Miss or expired:** starts or joins a single blocking load for the key. Concurrent callers share it.
- A caller abort rejects only that caller. When the last waiter of a load with no background owner leaves, the load is aborted.
- `set`, `delete`, `clear`, and eviction revoke a load's right to write. Its waiters reject with `CACHE_INVALIDATED`, and a late result can never repopulate or overwrite the cache.
- Failures are not cached. A failed refresh keeps the stale value only until its original stale deadline.

Coalescing happens within one cache instance only. It does not prevent stampedes across processes or regions. Include tenant, authorization, locale, and other parameters in the key; the cache does not partition them for you.

---

## quorin/state

### `safeClone(value, options?)`

```ts
import { safeClone, CLONE_SYMBOL, type CloneContext } from 'quorin/state';

const copy = safeClone({ when: new Date(), tags: new Set(['a']), bytes: new Uint8Array(4) });
```

Supported: primitives (including `bigint`), plain records, arrays, `Date`, `RegExp`, `Map`, `Set`, `ArrayBuffer` (including resizable), `DataView`, and typed arrays. Cycles and aliases are preserved, as are sparse holes, symbol keys, property descriptors, `RegExp.lastIndex`, view offsets, and non-extensibility.

Unsupported values throw `StateError` (`UNSUPPORTED_VALUE`): functions, symbol values, accessors, class instances without a clone hook, built-in subclasses, built-ins with extra own properties, promises, weak collections, shared or detached buffers, and objects from other realms. Pass `{ unsupported: 'reference' }` to share such values by reference instead; the result is then not an isolation boundary.

Classes opt in with a clone hook, which lets them rebuild private fields and keep cycles intact:

```ts
class TreeNode {
  #id: string;
  parent: TreeNode | null = null;

  constructor(id: string) {
    this.#id = id;
  }

  [CLONE_SYMBOL](context: CloneContext): TreeNode {
    const copy = context.register(this, new TreeNode(this.#id));
    copy.parent = context.clone(this.parent);
    return copy;
  }
}
```

Register the destination before cloning children. Registering a different destination for the same source throws.

### `isEqual(a, b, options?)`

```ts
import { isEqual } from 'quorin/state';

isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }); // true
isEqual(NaN, NaN);                                   // true
isEqual(0, -0);                                      // false
isEqual(new Set([1, 2]), new Set([2, 1]));           // false: insertion order matters
```

- Primitives use `Object.is`.
- Records and arrays compare prototypes, own keys (including symbols and holes), and property descriptors. Getters are compared by identity and never called.
- Dates compare time values, regular expressions compare source, flags, and `lastIndex`, and buffers and views compare kind, offset, and bytes.
- **Maps and Sets are compared in insertion order.** This is deliberate: it avoids hidden quadratic matching.
- Alias topology matters: `{ a: x, b: x }` is not equal to `{ a: copy1, b: copy2 }`.
- Class instances and other unsupported objects compare by reference.

### `redact(value, options?)`

```ts
import { redact } from 'quorin/state';

logger.info(redact({ user: 'ada', password: 'hunter2', headers: { Authorization: 'Bearer x' } }));
// { user: 'ada', password: '[REDACTED]', headers: { Authorization: '[REDACTED]' } }
```

Returns a JSON projection safe to log and never mutates the input. Getters, `toJSON`, and clone hooks are never invoked.

| Option | Default | Description |
| --- | --- | --- |
| `keys` | `[]` | Extra key matchers (case-insensitive strings or regular expressions). |
| `defaultKeys` | `true` | Match keys containing password, secret, token, authorization, api key, private key, credential, or cookie. |
| `paths` | `[]` | Exact segment paths to mask, such as `['users', 0, 'email']`. |
| `mask` | `'[REDACTED]'` | Replacement text. |
| `serializeError` | | Custom projection for `Error` objects. |
| `maxDepth` / `maxNodes` | `128` / `100000` | Values beyond the limit become `'[TRUNCATED]'`. |

Projection rules: errors become `{ name, error: '[ERROR]' }` (messages, stacks, and causes can contain secrets, so they need `serializeError`), cycles become `'[CIRCULAR]'`, repeated references become `'[REFERENCE]'`, `bigint` becomes `'10n'`, non-finite numbers become strings, dates become ISO strings, maps become entry arrays (string keys are matched too), sets become arrays, buffers become `{ type, byteLength }` without contents, and functions, symbols, accessors, weak collections, and class instances become markers such as `'[FUNCTION]'` and `'[OBJECT]'`.

Redaction is a conservative projection, not proof that every secret was removed. Secrets inside ordinary strings or under unexpected key names remain. Test it against your own data.

---

## Errors

Configuration mistakes and unsupported synchronous input throw. Async entry points reject. Expected operation failures use each API's documented channel. Every library error carries a stable `code`:

| Code | Raised by |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid options or arguments (`TypeError` or `RangeError`). |
| `UNSUPPORTED_VALUE` | Values outside a function's supported domain. |
| `TRAVERSAL_LIMIT` | A graph exceeded `maxDepth` or `maxNodes`. |
| `UNSAFE_PATH` | `SecurityError` for `__proto__`, `constructor`, or `prototype`. |
| `INVALID_ENCODING` | Malformed hex, base64, or UTF-8 (`SyntaxError`). |
| `CAPACITY_EXCEEDED` | A deque or byte concatenation beyond its size limit. |
| `CONCURRENT_MODIFICATION` | A deque changed during iteration. |
| `VALIDATION_FAILED` | `BoundaryValidationError`. |
| `QUEUE_FULL`, `QUEUE_CLEARED` | `QueueError` from `concurrencyLimit`, and `QUEUE_FULL` from `createChannel` when too many puts wait. |
| `CHANNEL_CLOSED` | `ChannelError` from `createChannel` after `close` and drain. |
| `CACHE_BUSY`, `CACHE_INVALIDATED`, `CACHE_LOAD_TIMEOUT` | `CacheError` from loading caches. |

```ts
try {
  fromHex(input);
} catch (error) {
  if ((error as { code?: string }).code === 'INVALID_ENCODING') {
    // handle bad input
  }
}
```

Codes are part of the public API. Messages may improve between minor versions and never contain environment values, object dumps, credentials, or cache keys.

## Cancellation model

Cancellation means two different things, and quorin keeps them apart:

1. **The caller stops waiting.** Quorin rejects or resolves promptly.
2. **The operation is asked to stop.** Quorin aborts the `AbortSignal` it gave the operation.

An `AbortSignal` cannot preempt synchronous code, undo side effects, or force a promise to settle. Work that ignores its signal keeps running, and quorin keeps accounting for it: limiter slots and cache in-flight slots stay occupied until the underlying work settles, and late results are observed so they never become unhandled rejections. Every terminal path removes its listeners and clears its timers. Timeouts run on the event loop, so they cannot interrupt a blocked thread.

## Runtime support

| Runtime | Status |
| --- | --- |
| Node 22.19.0+, 24, 26 | Tested in CI |
| Bun, Deno, Cloudflare workerd, Chromium, Firefox, WebKit | Targets, not yet verified |

Required capabilities: ES2022, `Promise`, `AbortController` and `AbortSignal`, timers, `TextEncoder` and `TextDecoder`, and `performance.now`. The core does not need `fetch`, `crypto`, `structuredClone`, `AbortSignal.any`, or `AbortSignal.timeout`.

### TypeScript settings

TypeScript consumers need TypeScript 5.8 or later. Declarations are tested on TypeScript 5.8 and 7.0 with `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

| Your project | `module` / `moduleResolution` | Result |
| --- | --- | --- |
| ESM (`"type": "module"`) | `NodeNext` or `Node16` | Works |
| Bundled app (Vite, webpack, esbuild, Bun) | `ESNext` + `Bundler` | Works |
| CommonJS | `NodeNext` (TS 5.8+) or `Node20` (TS 5.9+) | Works |
| CommonJS | `Node16` or `Node18` | Error TS1479: TypeScript assumes those Node versions cannot `require` ES modules. Switch to `NodeNext`. |
| Legacy `moduleResolution: "node"` (`node10`) | `CommonJS` + `Node10` | Works through `typesVersions` on TypeScript 6 and earlier. TypeScript 7 removed this mode, so plan to move to `NodeNext` or `Bundler`. |

Zero runtime dependencies reduces supply-chain exposure; it does not remove implementation risk or maintenance cost.

## Agent skill

quorin ships an agent skill that teaches coding agents (Claude Code, Cursor, Codex, and others) how to use the library, how to build packages on top of it, and how to contribute to it. Install it into your project with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add arnonsang/quorin
```

```sh
npx skills add arnonsang/quorin --skill quorin -a claude-code   # one agent only
npx skills add arnonsang/quorin -g                            # available in every project
```

The skill lives in [`skills/quorin`](./skills/quorin). Every code example in its references is typechecked against the library in CI (`npm run check:skill`).

## Development

```sh
npm install
npm run typecheck      # tsc over src and tests, including type-level tests
npm test               # runtime tests on the TypeScript sources
npm run test:coverage  # tests with coverage thresholds, writes coverage/lcov.info
npm run test:package   # builds, packs, installs the tarball, and checks imports, require, and types
npm run check:skill    # typechecks the code examples in the agent skill
npm run check          # all of the above
```

Tests use the built-in `node:test` runner and run the TypeScript sources directly through Node's type stripping. The package test installs the packed tarball into a clean fixture without dev dependencies, imports the root and all nine subpaths, checks that both resolve to the same objects, loads the package with `require`, and type checks a consumer.

The layout:

```
src/
  index.ts          root re-exports
  <module>/         one folder per public subpath
  internal/         shared private helpers (validation, clock, abort, queue, JSON codec)
tests/
  runtime/          behavior and regression tests
  types/            compile-time type tests
  package/          packed tarball tests
skills/quorin/        agent skill (SKILL.md, references, evals)
```

To report coverage to Codecov from CI, add a `CODECOV_TOKEN` repository secret.

### Releasing

Releases are published from CI with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance. Bump the version and push the tag:

```sh
npm version patch   # or minor, major; updates package.json and creates the v* tag
git push --follow-tags
```

The `Release` workflow checks that the tag matches `package.json`, runs `npm run check`, and publishes.

## License

[MIT](./LICENSE). The vendored Standard Schema type declarations are MIT licensed by their authors; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
