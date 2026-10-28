# quorin recipes

Patterns for application code. Every `ts` block in this file is extracted and typechecked against quorin in the quorin repository, so the code compiles as written. Names declared with `declare` stand for your own application code.

## Contents

1. [Validated environment config](#1-validated-environment-config)
2. [HTTP calls with timeouts and safe retries](#2-http-calls-with-timeouts-and-safe-retries)
3. [Cache with request coalescing and stale-while-revalidate](#3-cache-with-request-coalescing-and-stale-while-revalidate)
4. [Request handler boundary](#4-request-handler-boundary)
5. [Bounded fan-out and shared limits](#5-bounded-fan-out-and-shared-limits)
6. [Log-safe output](#6-log-safe-output)
7. [Structural keys and fingerprints](#7-structural-keys-and-fingerprints)
8. [Layered configuration](#8-layered-configuration)
9. [Work queues](#9-work-queues)
10. [Testing code that uses quorin](#10-testing-code-that-uses-quorin)

## 1. Validated environment config

Parse once at startup and export the typed result. Pass the source explicitly so the same code works in Node, Deno, and workers.

```ts
import { z } from 'zod';
import { parseEnv, formatIssues, BoundaryValidationError } from 'quorin/boundary';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  API_TOKEN: z.string().min(20),
});

export type Env = z.infer<typeof EnvSchema>;

export async function loadEnv(source: Record<string, string | undefined>): Promise<Env> {
  try {
    return await parseEnv(EnvSchema, source);
  } catch (error) {
    if (error instanceof BoundaryValidationError) {
      const lines = formatIssues(error).map((group) => `${group.path.join('.') || '(root)'}: ${group.messages.join(', ')}`);
      throw new Error(`Invalid environment:\n${lines.join('\n')}`);
    }
    throw error;
  }
}
```

Issue messages come from the schema, not from the values, so printing them does not leak secrets.

## 2. HTTP calls with timeouts and safe retries

Classify retryable failures yourself. A resolved 503 is a successful `fetch` promise, so turn it into an error; consume or cancel bodies you discard so connections are released. Read the body inside the task so the timeout covers it.

```ts
import { withResilience, parseRetryAfter, isUserAbort, type RunFailure } from 'quorin/resilience';
import type { SafeResult } from 'quorin/result';

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(status: number, retryAfter: string | null) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return RETRYABLE_STATUS.has(error.status);
  return error instanceof TypeError;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<SafeResult<T, RunFailure>> {
  return withResilience(
    async ({ signal: attemptSignal }) => {
      const response = await fetch(url, { signal: attemptSignal, headers: { accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status, response.headers.get('retry-after'));
      }
      return (await response.json()) as T;
    },
    {
      ...(signal === undefined ? {} : { signal }),
      retries: 2,
      retrySafe: true,
      shouldRetry: isRetryable,
      retryDelayMs: ({ error }) => (error instanceof HttpError ? parseRetryAfter(error.retryAfter) : null) ?? 800,
      totalTimeoutMs: 10_000,
    },
  );
}

declare const log: { warn(message: string, data: unknown): void };

export async function loadProfile(id: string, signal?: AbortSignal): Promise<unknown> {
  const result = await getJson<unknown>(`https://api.example.com/profiles/${encodeURIComponent(id)}`, signal);
  if (result.ok) return result.data;
  if (isUserAbort(result)) return undefined;
  const failure = result.error;
  switch (failure.kind) {
    case 'timeout':
      log.warn('profile request timed out', { scope: failure.scope, attempt: failure.attempt });
      break;
    case 'task':
      log.warn('profile request failed', { attempt: failure.attempt });
      break;
    case 'aborted':
      break;
  }
  throw new Error('Profile unavailable');
}
```

Only `GET`-like or idempotency-keyed requests should set `retrySafe: true`. With `exactOptionalPropertyTypes`, spread optional signals as shown instead of passing `signal: undefined`. When the server sends `Retry-After`, honor it with `retryDelayMs` and `parseRetryAfter`: the header delay replaces the jittered curve for that retry and may exceed `maxDelayMs`, while `totalTimeoutMs` still caps the whole run.

## 3. Cache with request coalescing and stale-while-revalidate

Create the cache once. The loader receives a signal that aborts when every waiter leaves or the load is invalidated. Throw from the loader on failure so nothing is cached.

```ts
import { createCache } from 'quorin/cache';
import { withResilience } from 'quorin/resilience';

interface Product {
  readonly id: string;
  readonly price: number;
}

declare function fetchProduct(id: string, signal: AbortSignal): Promise<Product>;

export const products = createCache<string, Product>({
  max: 5_000,
  ttlMs: 60_000,
  swrMs: 5 * 60_000,
  maxInFlight: 64,
  loadTimeoutMs: 8_000,
  load: async (id, { signal }) => {
    const result = await withResilience(({ signal: attemptSignal }) => fetchProduct(id, attemptSignal), {
      signal,
      attemptTimeoutMs: 3_000,
    });
    if (!result.ok) throw result.error;
    return result.data;
  },
  onBackgroundError: (error, id) => console.warn('product refresh failed', id, error),
});

interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export async function handleProductRequest(id: string, request: Request, ctx: WaitUntilContext): Promise<Response> {
  try {
    const product = await products.getOrFetch(id, {
      signal: request.signal,
      onBackgroundTask: (task) => ctx.waitUntil(task),
    });
    return Response.json(product);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'CACHE_BUSY') return new Response('Busy', { status: 503 });
    throw error;
  }
}

export function onProductUpdated(product: Product): void {
  products.set(product.id, product);
}
```

`set` and `delete` invalidate any in-flight load for that key, so an older response can never overwrite newer data. For multi-tenant data, make the key include the tenant: `createCache<string, X>` with keys like `${tenantId}:${id}`, or a separate cache per tenant.

## 4. Request handler boundary

Validate unknown input, then run the handler. Separate invalid input (400) from handler failures (500).

```ts
import * as v from 'valibot';
import { defineBoundary, formatIssues, BoundaryValidationError } from 'quorin/boundary';

declare const db: { insertUser(input: { email: string; name: string }): Promise<{ id: string }> };

const createUser = defineBoundary(
  v.object({
    email: v.pipe(v.string(), v.email()),
    name: v.pipe(v.string(), v.minLength(1)),
  }),
  (input) => db.insertUser(input),
);

export async function postUser(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const result = await createUser(body);
  if (result.ok) return Response.json(result.data, { status: 201 });
  if (result.error instanceof BoundaryValidationError) {
    return Response.json({ errors: formatIssues(result.error).map((group) => ({ path: group.path.map(String), messages: group.messages })) }, { status: 400 });
  }
  return new Response('Internal error', { status: 500 });
}
```

Pass `{ mapError }` as the third argument to get a typed failure instead of `unknown`.

## 5. Bounded fan-out and shared limits

`mapAsync` for one batch; `concurrencyLimit` for a limit shared across many callers, such as a third-party API quota.

```ts
import { concurrencyLimit, mapAsync, QueueError } from 'quorin/async';

declare function resizeImage(url: string, signal: AbortSignal): Promise<Uint8Array>;
declare function callPartnerApi(path: string, signal: AbortSignal): Promise<unknown>;

export function resizeAll(urls: readonly string[], signal?: AbortSignal): Promise<Uint8Array[]> {
  return mapAsync(urls, (url, _index, { signal: itemSignal }) => resizeImage(url, itemSignal), {
    concurrency: 6,
    ...(signal === undefined ? {} : { signal }),
  });
}

const partnerLimit = concurrencyLimit(4, { maxPending: 200 });

export async function partner(path: string, signal: AbortSignal): Promise<unknown> {
  try {
    return await partnerLimit(({ signal: taskSignal }) => callPartnerApi(path, taskSignal), { signal });
  } catch (error) {
    if (error instanceof QueueError && error.code === 'QUEUE_FULL') {
      throw new Error('Partner API is saturated, try again later', { cause: error });
    }
    throw error;
  }
}

export function shutdown(): void {
  partnerLimit.clear(new Error('Shutting down'));
}
```

`mapAsync` fails fast; collect per-item outcomes instead by returning results from the mapper: `mapAsync(items, (item) => trySafe(() => work(item)))`.

## 6. Log-safe output

```ts
import { redact } from 'quorin/state';

export function logEvent(message: string, data: unknown): void {
  const safe = redact(data, {
    keys: ['ssn', /^x-.*-signature$/i],
    paths: [['user', 'email']],
    serializeError: (error) => ({ name: error.name, message: error.message.slice(0, 200) }),
  });
  console.log(JSON.stringify({ message, data: safe }));
}
```

Default keys already cover password, secret, token, authorization, api key, private key, credential, and cookie (substring and case-insensitive). The input is never mutated, and getters are never invoked.

## 7. Structural keys and fingerprints

```ts
import { ValueMap } from 'quorin/struct';
import { stableStringify } from 'quorin/object';
import { fastHash, stringToBytes, toHex } from 'quorin/bytes';

type Query = { readonly filter: { readonly status: string; readonly tags: readonly string[] }; readonly page: number };

const results = new ValueMap<Query, readonly string[]>();
results.set({ page: 1, filter: { tags: ['a'], status: 'open' } }, ['x']);
results.get({ filter: { status: 'open', tags: ['a'] }, page: 1 });

export function etagFor(body: { readonly [key: string]: string | number | boolean | null }): string {
  const hash = fastHash(stringToBytes(stableStringify(body)));
  return `W/"${toHex(new Uint8Array(new Uint32Array([hash]).buffer))}"`;
}
```

`fastHash` is a fast non-cryptographic hash. Use `crypto.subtle.digest` when collisions matter or input is attacker controlled.

## 8. Layered configuration

```ts
import { deepMerge, getPath } from 'quorin/object';

const defaults = { server: { port: 3000, host: '0.0.0.0' }, features: { search: false } } as const;
const fileConfig = JSON.parse('{"server":{"port":8080}}') as { server: { port: number } };

const config = deepMerge(defaults, fileConfig);
export const port: number = config.server.port;
export const searchEnabled = getPath(config, 'features.search', false);
```

`deepMerge` requires JSON records on both sides. Validate parsed files with a schema first when they are untrusted.

## 9. Work queues

```ts
import { Deque } from 'quorin/struct';

interface Job {
  readonly id: string;
  readonly priority: 'high' | 'normal';
}

const jobs = new Deque<Job>();

export function enqueue(job: Job): void {
  if (job.priority === 'high') jobs.unshift(job);
  else jobs.push(job);
}

export function next(): Job | undefined {
  return jobs.shift();
}
```

Do not push or shift while iterating a `Deque`; it throws `CONCURRENT_MODIFICATION`. Drain with `while (jobs.size > 0)` instead.

## 10. Testing code that uses quorin

Drive timing with controlled promises and `AbortController` rather than long sleeps. Assert on result shapes and error codes.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache } from 'quorin/cache';
import { withResilience } from 'quorin/resilience';

test('concurrent misses share one load', async () => {
  let calls = 0;
  let release!: (value: number) => void;
  const cache = createCache<string, number>({
    max: 10,
    load: () => {
      calls++;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    },
  });
  const first = cache.getOrFetch('k');
  const second = cache.getOrFetch('k');
  release(42);
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  assert.equal(calls, 1);
});

test('timeouts are reported as values', async () => {
  const result = await withResilience(() => new Promise<never>(() => {}), { attemptTimeoutMs: 10 });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, 'timeout');
});

test('caller abort reaches the task', async () => {
  const controller = new AbortController();
  let taskSignal: AbortSignal | undefined;
  const run = withResilience(({ signal }) => {
    taskSignal = signal;
    return new Promise<never>(() => {});
  }, { signal: controller.signal });
  controller.abort('stop');
  const result = await run;
  assert.equal(!result.ok && result.error.kind, 'aborted');
  assert.equal(taskSignal?.aborted, true);
});
```
