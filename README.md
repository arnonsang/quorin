<div align="center">

<img src="https://arnonsang.github.io/quorin/logo.svg" alt="" width="120" height="120">

# quorin

**Small primitives for dependable TypeScript.**

[![npm version](https://img.shields.io/npm/v/quorin.svg)](https://www.npmjs.com/package/quorin)
[![CI](https://github.com/arnonsang/quorin/actions/workflows/ci.yml/badge.svg)](https://github.com/arnonsang/quorin/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/arnonsang/quorin/branch/main/graph/badge.svg)](https://codecov.io/gh/arnonsang/quorin)
[![license](https://img.shields.io/npm/l/quorin.svg)](./LICENSE)
![runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

</div>

Quorin (pronounced **KWOR-in**) is the set of TypeScript utilities I use on almost every project: data structures, bytes, safe object access, bounded async work and channels, explicit results, validation, retries, caching, and log-safe state. Zero runtime dependencies, and every module plays by the same rules.

```ts
import { Channel, select } from 'quorin/async';
import { createCache } from 'quorin/cache';
import { withResilience } from 'quorin/resilience';
```

> **Status:** `0.2.0` preview. The API may still change before `1.0`.

See each primitive in motion, next to the quick version it replaces, on the [visualizer site](https://arnonsang.github.io/quorin/).

## Why I built it

Quorin is the toolkit I kept rewriting. Whatever the project, an API, a background worker, or an app talking to flaky services, I end up building the same pieces before I can get to the actual product: a timeout that really cancels, a retry that only retries what is safe, a cache that collapses a burst of identical requests, a queue that pushes back instead of growing forever, validation at the edges, and a way to log objects without leaking tokens.

The quick versions always came with the same bugs:

- A `Promise.race` timeout stops waiting, but the request keeps running and its late rejection goes unhandled.
- Helpers from different packages disagree on what an `AbortSignal` means, so cancelling frees a slot in one and leaks it in another.
- Retries fire on anything that throws, including requests that are not safe to repeat.
- Treating every `TypeError` as a bug also hides network failures, because `fetch` throws `TypeError` too.
- An unbounded in-memory queue quietly grows until the process falls over.
- A late response overwrites newer cached data, and deep clones break the moment a method touches a private field.

So I pulled the versions I trust out of my day-to-day work into one library, gave them one set of rules, and tested them hard enough that I stop thinking about them:

- **One cancellation model.** Every async API takes an `AbortSignal`, stops waiting promptly, and still accounts for work that ignores the signal.
- **Failures you can check.** Results are real `[error, data]` tuples with `.ok`, and every library error has a stable `code`.
- **Clear ownership.** Each function says whether it copies, mutates, or returns references.
- **Bounded by default.** Queues, caches, and in-flight work all have limits.
- **Testable time.** Timers run on an injectable clock, so tests advance fake time instead of sleeping.

The name comes from *quorum*, the smallest group that has to be present before a body can act: just enough primitives to make async work, data handling, and failure handling dependable.

## Install

```sh
npm install quorin
```

One ESM build with type declarations. `require('quorin')` also works on every supported Node version. See [compatibility](./docs/compatibility.md) for runtimes and TypeScript settings.

## Quick start

A profile loader that validates input, coalesces concurrent requests, serves stale data while refreshing, and retries transient failures within a deadline:

```ts
import { z } from 'zod';
import { defineBoundary } from 'quorin/boundary';
import { createCache } from 'quorin/cache';
import { withResilience } from 'quorin/resilience';

const profiles = createCache<string, Profile>({
  max: 500,
  ttlMs: 30_000,
  swrMs: 10_000,
  load: async (id, { signal }) => {
    const result = await withResilience(({ signal }) => fetchProfile(id, signal), {
      signal,
      retries: 2,
      retrySafe: true,
      shouldRetry: (error) => error instanceof TransientError,
      attemptTimeoutMs: 2_000,
      totalTimeoutMs: 6_000,
    });
    if (!result.ok) throw result.error;
    return result.data;
  },
});

const getProfile = defineBoundary(z.string().uuid(), (id) => profiles.getOrFetch(id));

const outcome = await getProfile(untrustedInput);
if (outcome.ok) render(outcome.data);
else report(outcome.error);
```

A worker pool fed by a bounded channel, where the first failure cancels the rest:

```ts
import { Channel, createTaskGroup } from 'quorin/async';

const jobs = new Channel<Job>(32);
const workers = createTaskGroup({ signal });

for (let i = 0; i < 4; i++) {
  workers.run(async ({ signal }) => {
    for await (const job of jobs.values({ signal })) await handle(job, signal);
  });
}

for (const job of await loadJobs()) await jobs.send(job, { signal });
jobs.close();

const result = await workers.wait();
```

## Modules

Import from the root or from a subpath. Both resolve to the same objects, and importing has no side effects.

| Subpath | Use it for | Docs |
| --- | --- | --- |
| `quorin/struct` | `Deque`, `ValueMap` (structural keys), `Multimap` | [struct](./docs/struct.md) |
| `quorin/object` | Safe `getPath`/`setPath`, `deepMerge`, `stableStringify` | [object](./docs/object.md) |
| `quorin/bytes` | UTF-8, strict hex and base64, `fastHash` | [bytes](./docs/bytes.md) |
| `quorin/async` | Concurrency limits, `mapAsync`, rate limiting, `singleFlight` | [async](./docs/async.md) |
| `quorin/async` | `Channel`, `select`, `spawn`, task groups, mutexes, `tick` | [concurrency](./docs/concurrency.md) |
| `quorin/signal` | `onAbort`, `timeoutSignal` | [signal](./docs/signal.md) |
| `quorin/result` | `SafeResult`, `ok`, `err`, `trySafe` | [result](./docs/result.md) |
| `quorin/boundary` | Standard Schema validation: `parseEnv`, `defineBoundary` | [boundary](./docs/boundary.md) |
| `quorin/resilience` | `withResilience` retries and deadlines, `parseRetryAfter` | [resilience](./docs/resilience.md) |
| `quorin/cache` | LRU cache with TTL, stale-while-revalidate, coalesced loads | [cache](./docs/cache.md) |
| `quorin/state` | `safeClone`, `isEqual`, `redact` | [state](./docs/state.md) |

Shared behavior is documented once: [errors and cancellation](./docs/errors-and-cancellation.md).

## Agent skill

Quorin ships an agent skill that teaches coding agents how to use it, build on it, and contribute to it. Install it with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add arnonsang/quorin
```

## Contributing

`npm run check` runs typechecking, the skill examples, tests with coverage thresholds, and packed-package tests. See [development](./docs/development.md) for the layout and release process.

## License

[MIT](./LICENSE). The vendored Standard Schema type declarations are MIT licensed by their authors; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
