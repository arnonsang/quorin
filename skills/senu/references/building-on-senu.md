# Building on top of senu

Guidance for libraries, SDKs, framework adapters, and shared service layers that use senu internally or expose it. Every `ts` block here is typechecked against senu in the senu repository.

## Contents

1. [Dependency or peer dependency](#1-dependency-or-peer-dependency)
2. [Shape your public API](#2-shape-your-public-api)
3. [Map senu failures into your own errors](#3-map-senu-failures-into-your-own-errors)
4. [A reusable resource factory](#4-a-reusable-resource-factory)
5. [Your own Standard Schema validator](#5-your-own-standard-schema-validator)
6. [Clone hooks for your classes](#6-clone-hooks-for-your-classes)
7. [Testing a package built on senu](#7-testing-a-package-built-on-senu)
8. [Checklist](#8-checklist)

## 1. Dependency or peer dependency

Some senu values carry identity that only works within one installed copy: `DefectError` and the error classes (`instanceof`), `CLONE_SYMBOL`, and the envelopes `isUserAbort` recognizes. If two copies of senu end up in an application, a `DefectError` thrown by one is not recognized by the other.

- Your **public types or behavior expose senu** (you return `SafeResult`, accept `RunFailure`, ask users to throw `DefectError`, or document `CLONE_SYMBOL`): make senu a `peerDependency` with a compatible range, and also list it in `devDependencies` for your own tests. The application then installs one copy that everyone shares.
- senu is a **private implementation detail** (you return plain promises and your own error types): a regular `dependency` is fine.

```json
{
  "peerDependencies": { "senu": "^0.1.0" },
  "devDependencies": { "senu": "^0.1.0" }
}
```

While senu is below 1.0, minor versions may contain breaking changes, so keep the range to one minor (`^0.1.0` already does that).

Import subpaths (`senu/cache`, `senu/resilience`) in library code. It documents what you depend on and keeps your consumers' bundles small. Never import from `senu/dist/...`; only the root and the nine subpaths are public.

## 2. Shape your public API

Follow the same contracts senu follows, so your users get the same guarantees one layer up:

- Accept an optional `signal` on every async operation and pass it down. Never swallow it.
- Decide per function whether failures are thrown or returned as `SafeResult`, document it, and do not mix both for the same failure.
- Give your errors stable `code` values and keep the original error as `cause`.
- Do not put user data, tokens, or cache keys in error messages.
- Re-export the senu types that appear in your signatures, so users do not need a direct import for type annotations.

```ts
export type { SafeResult } from 'senu/result';
export type { RunFailure } from 'senu/resilience';
```

## 3. Map senu failures into your own errors

Translate `RunFailure` once, at your package boundary, into an error union your users can switch on.

```ts
import type { RunFailure } from 'senu/resilience';

export type ClientErrorCode = 'TIMEOUT' | 'ABORTED' | 'UPSTREAM' | 'RATE_LIMITED';

export class ClientError extends Error {
  readonly code: ClientErrorCode;
  constructor(code: ClientErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClientError';
    this.code = code;
  }
}

export class UpstreamStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Upstream responded with ${status}`);
    this.status = status;
  }
}

export function toClientError(failure: RunFailure): ClientError {
  switch (failure.kind) {
    case 'timeout':
      return new ClientError('TIMEOUT', `Request timed out (${failure.scope})`);
    case 'aborted':
      return new ClientError('ABORTED', 'Request was cancelled', { cause: failure.reason });
    case 'task': {
      const error = failure.error;
      if (error instanceof UpstreamStatusError && error.status === 429) {
        return new ClientError('RATE_LIMITED', 'Rate limited by upstream', { cause: error });
      }
      return new ClientError('UPSTREAM', 'Upstream request failed', { cause: error });
    }
  }
}
```

## 4. A reusable resource factory

Package the common combination (bounded cache, coalesced loads, timeouts, safe retries) behind one small API. Keep the senu objects private and expose only what your users need.

```ts
import { createCache } from 'senu/cache';
import { withResilience } from 'senu/resilience';

export interface ResourceOptions<K, V> {
  readonly fetch: (key: K, signal: AbortSignal) => Promise<V>;
  readonly isTransient: (error: unknown) => boolean;
  readonly max?: number;
  readonly ttlMs?: number;
  readonly swrMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly retries?: number;
}

export interface Resource<K, V> {
  get(key: K, options?: { signal?: AbortSignal; waitUntil?: (task: Promise<void>) => void }): Promise<V>;
  invalidate(key: K): void;
  prime(key: K, value: V): void;
}

export function defineResource<K, V>(options: ResourceOptions<K, V>): Resource<K, V> {
  const cache = createCache<K, V>({
    max: options.max ?? 1_000,
    ttlMs: options.ttlMs ?? 30_000,
    swrMs: options.swrMs ?? 0,
    load: async (key, { signal }) => {
      const result = await withResilience(({ signal: attemptSignal }) => options.fetch(key, attemptSignal), {
        signal,
        attemptTimeoutMs: options.attemptTimeoutMs ?? 5_000,
        retries: options.retries ?? 2,
        retrySafe: true,
        shouldRetry: options.isTransient,
      });
      if (!result.ok) throw result.error;
      return result.data;
    },
  });

  return {
    get: (key, getOptions = {}) =>
      cache.getOrFetch(key, {
        ...(getOptions.signal === undefined ? {} : { signal: getOptions.signal }),
        ...(getOptions.waitUntil === undefined ? {} : { onBackgroundTask: getOptions.waitUntil }),
      }),
    invalidate: (key) => {
      cache.delete(key);
    },
    prime: (key, value) => {
      cache.set(key, value);
    },
  };
}
```

`retrySafe: true` is hard-coded here because the factory is for reads. A factory for writes should not retry unless the caller supplies an idempotency key.

## 5. Your own Standard Schema validator

`senu/boundary` accepts anything implementing Standard Schema v1. A hand-written validator only needs the `~standard` property. Return `{ value }` on success and `{ issues }` on failure; `issues` present (even empty) means failure.

```ts
import { defineBoundary, type StandardSchemaV1 } from 'senu/boundary';

export function positiveInt(): StandardSchemaV1<unknown, number> {
  return {
    '~standard': {
      version: 1,
      vendor: 'my-lib',
      validate: (value) =>
        typeof value === 'number' && Number.isInteger(value) && value > 0
          ? { value }
          : { issues: [{ message: 'Expected a positive integer' }] },
    },
  };
}

export const double = defineBoundary(positiveInt(), (count) => count * 2);
```

Keep `validate` free of side effects and never throw from it for invalid input: senu treats a throw as an integration bug and rejects instead of returning a validation failure.

## 6. Clone hooks for your classes

`safeClone` refuses class instances it cannot rebuild correctly. Implement `[CLONE_SYMBOL]` to opt in. Register the copy before cloning children so cycles and shared references work.

```ts
import { CLONE_SYMBOL, safeClone, type CloneContext } from 'senu/state';

export class Session {
  #token: string;
  readonly scopes: Set<string>;
  parent: Session | null = null;

  constructor(token: string, scopes: Iterable<string>) {
    this.#token = token;
    this.scopes = new Set(scopes);
  }

  hasToken(): boolean {
    return this.#token.length > 0;
  }

  [CLONE_SYMBOL](context: CloneContext): Session {
    const copy = context.register(this, new Session(this.#token, []));
    for (const scope of this.scopes) copy.scopes.add(scope);
    copy.parent = context.clone(this.parent);
    return copy;
  }
}

const original = new Session('abc', ['read']);
export const copy = safeClone(original);
```

Hooks are trusted code. Keep them free of I/O, and make sure the returned object is fully valid on its own.

## 7. Testing a package built on senu

- Use controlled promises (resolve or reject them from the test) to order events deterministically.
- Use `AbortController` to test cancellation, and assert that your code passed the signal down (`taskSignal.aborted === true`).
- Assert on `code` and `kind`, not on messages.
- Use short real timeouts (10 to 50 ms) for timeout paths, or inject your own clock at your layer. senu does not expose a clock hook.
- Install senu from the registry in tests, the same way your users will, so you test against the published contract.

## 8. Checklist

- [ ] senu is a peer dependency if any senu type, class, or symbol is part of your API
- [ ] Every async entry point accepts and forwards `signal`
- [ ] Retries are enabled only for repeatable operations, with an explicit `shouldRetry`
- [ ] Failures are translated once into your own coded errors with `cause`
- [ ] Cache keys include tenant, auth scope, and every parameter that changes the result
- [ ] Logged data goes through `redact`
- [ ] Imports use `senu/<module>` subpaths, never `senu/dist`
