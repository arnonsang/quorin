---
name: senu
description: Write, review, and extend TypeScript code that uses senu, the zero-dependency library of small primitives (Deque, ValueMap, getPath/setPath, deepMerge, stableStringify, strict hex/base64, concurrencyLimit, mapAsync, SafeResult with ok/err/trySafe, Standard Schema boundaries and parseEnv, withResilience retries and timeouts, LRU createCache with singleflight and stale-while-revalidate, safeClone, isEqual, redact). Use this skill whenever code imports from 'senu' or 'senu/*', when the user wants to add retries, timeouts, request coalescing, bounded concurrency, input validation, env parsing, caching, safe logging, or structural keys to a TypeScript or JavaScript project that has or could add senu, when building a library, SDK, or service layer on top of senu, or when contributing to the senu repository itself. Prefer it over generic advice even if the user only says "add a retry", "cache this fetch", or "validate this request" in a project that depends on senu.
---

# senu

senu (pronounced SEH-noo) is a set of small TypeScript primitives with explicit contracts: every function has a defined input domain, a documented error channel, a clear ownership policy (copy, mutate, or reference), and explicit resource lifetimes. All modules share one cancellation model, so they compose without surprises. Your job when using this skill is to keep those contracts intact in the code you write, because the value of senu comes from callers being able to rely on them.

## Setup

```sh
npm install senu
# not on the registry yet? install from GitHub (builds on install):
npm install github:arnonsang/senu
```

ESM only, with declarations. `require('senu')` also works on Node 22.12+. TypeScript 5.8+ consumers. Zero runtime dependencies.

Import from a subpath when code uses one area (it documents intent and keeps bundles small), or from the root when mixing many. Both resolve to the same objects, so `instanceof` checks agree.

```ts
import { createCache } from 'senu/cache';
import { withResilience } from 'senu/resilience';
import { ok, err, type SafeResult } from 'senu'; // same objects as 'senu/result'
```

If the installed version behaves differently from what is described here, trust its `README.md` and `.d.ts` files in `node_modules/senu`; this skill targets 0.1.x.

## Choose the primitive

| The code needs to... | Use | Module |
| --- | --- | --- |
| Queue or stack with fast both-end operations | `Deque` | struct |
| Map keyed by object or array *values* | `ValueMap` (keys must be JSON values) | struct |
| One key to many values | `Multimap` | struct |
| Read or write nested data by path safely | `getPath`, `setPath` | object |
| Merge config objects without mutation | `deepMerge` | object |
| Deterministic JSON for cache keys or hashes | `stableStringify` | object |
| Bytes, UTF-8, hex, base64/base64url, FNV-1a | `concatBytes`, `stringToBytes`, `toHex`, `fromBase64`, `fastHash`, ... | bytes |
| Run at most N async tasks at once | `concurrencyLimit` | async |
| Map an array with bounded concurrency | `mapAsync` | async |
| Return failures as values instead of throwing | `ok`, `err`, `trySafe`, `trySafeSync` | result |
| Validate untrusted input with Zod, Valibot, ArkType, ... | `defineBoundary`, `formatIssues` | boundary |
| Validate environment variables | `parseEnv(schema, process.env)` | boundary |
| Retries, backoff, attempt and total timeouts | `withResilience` | resilience |
| LRU cache, TTL, stale-while-revalidate, dedupe loads | `createCache` | cache |
| Deep copy, deep equality, log-safe projection | `safeClone`, `isEqual`, `redact` | state |

Full signatures, options, and defaults: [references/api.md](references/api.md). Read the section for the module you are about to use before writing non-trivial code with it.

## Contracts to preserve

These are the rules that make senu dependable. Each one has a reason; breaking it usually reintroduces the bug senu exists to prevent.

1. **Narrow results with `result.ok`.** `SafeResult` is a frozen `[error, data]` array that also has `.ok`, `.error`, `.data`. `if (error)` is wrong when the error could be `null`, `0`, `''`, or `false`. Destructuring is fine after narrowing: `if (r.ok) { const [, data] = r; }`.
2. **Thread the signal all the way down.** Every senu callback receives `{ signal }`. Pass it to `fetch`, database drivers, child calls, and nested senu calls. Cancellation is cooperative: senu stops *waiting* immediately, but only your code can stop the *work*. Work that ignores its signal keeps holding its limiter or cache slot until it settles; that is deliberate, so concurrency limits stay honest.
3. **Retries are opt-in and explicit.** `withResilience` with `retries > 0` requires `retrySafe: true` and a `shouldRetry` predicate. Only retry operations that are safe to repeat, and classify retryable errors yourself (for example a `TransientError` class or HTTP 429/503). There are no defaults based on error constructors, because `fetch` throws `TypeError` for network failures and that says nothing about safety.
4. **Library timeouts are terminal.** A senu timeout aborts the attempt and returns `{ kind: 'timeout' }`; it never starts another attempt, so a slow attempt that ignores its signal cannot overlap a retry.
5. **Defects are explicit.** Only `DefectError` (or what your `classifyDefect` returns true for) escapes `trySafe`, `defineBoundary`, and `withResilience` as a throw. Do not use `TypeError` or `SyntaxError` to signal bugs.
6. **Discriminate errors by `code`, not message.** Codes are stable API (`INVALID_ARGUMENT`, `UNSUPPORTED_VALUE`, `TRAVERSAL_LIMIT`, `UNSAFE_PATH`, `INVALID_ENCODING`, `QUEUE_FULL`, `CACHE_BUSY`, `CACHE_INVALIDATED`, `CACHE_LOAD_TIMEOUT`, ...). Messages can change and never contain user data.
7. **Know who owns the data.** Cache values, result payloads, and `Multimap` values are references; clone them yourself if callers may mutate them. `setPath` mutates its target; `deepMerge`, `safeClone`, and `redact` never mutate input.
8. **Cache keys must include everything that changes the answer.** Tenant, user or authorization scope, locale, and query parameters belong in the key. Coalescing is per cache instance, not across processes.
9. **Stay inside the JSON domain where required.** `ValueMap` keys, `stableStringify`, and `deepMerge` accept only JSON values (no `undefined`, `Date`, `Map`, class instances, sparse arrays, or cycles) and throw `UNSUPPORTED_VALUE` otherwise. Convert first, for example dates to ISO strings.
10. **Inject the environment.** `parseEnv(schema, source)` never reads globals; pass `process.env`, `Deno.env.toObject()`, or worker bindings.

## Workflow for application code

1. Find the boundary: where untrusted data enters (request body, queue message, env) and where slow or flaky I/O leaves (HTTP, database).
2. Validate at the entry with `defineBoundary` or `parseEnv`. Handlers then receive the schema's output type.
3. Wrap outbound I/O with `withResilience` (timeouts always, retries only when safe), and put `createCache` with a `load` function in front of it when results are reusable.
4. Bound fan-out with `mapAsync` or `concurrencyLimit` instead of `Promise.all` over unbounded arrays.
5. Return `SafeResult` across module boundaries where failure is expected, and handle every `RunFailure.kind` (`task`, `timeout`, `aborted`). Use `isUserAbort(result)` to skip logging caller cancellations.
6. Log with `redact(value)` so tokens, passwords, and authorization headers are masked.

Worked, typechecked examples of each step: [references/recipes.md](references/recipes.md).

## Building on top of senu

When writing a library, SDK, framework adapter, or shared service layer that uses senu, read [references/building-on-senu.md](references/building-on-senu.md). It covers dependency versus peer dependency, re-exporting types, mapping senu failures into your own error types, keeping your public API cancellation-aware, writing Standard Schema adapters, clone hooks for your classes, and testing code built on senu.

## Contributing to senu itself

When the working directory is the senu repository (package name `senu` with `src/<module>/` folders), read [references/contributing.md](references/contributing.md) for the layout, the scripts that must pass, and the conventions new code follows.

## Common mistakes

- `Promise.race([work(), timeout])` instead of `withResilience({ attemptTimeoutMs })`: the losing work is never aborted and its rejection may go unhandled.
- Creating a cache per request. A cache only coalesces and reuses within one instance; create it once at module or service scope.
- Expecting `get` to return stale values. `get` and `has` only see fresh entries; use `lookup` to see stale ones, or `getOrFetch` to serve stale data while refreshing.
- Passing an already-started promise where senu wants a function (`trySafe(fetch(url))`). Pass `() => fetch(url)` so synchronous throws are captured and retries can call it again.
- Using `isEqual` for unordered set equality. Map and Set entries compare in insertion order.
- Treating `redact` as a guarantee. It masks known keys and paths; secrets embedded in free text are not detected.
