# quorin/async

Bounded async execution: concurrency limits, bounded mapping, rate limiting, and call coalescing. Channels, select, task groups, and locks live in the same subpath and are documented in [concurrency](./concurrency.md).

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `concurrencyLimit(concurrency, { maxPending = 1024 })`

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

## `mapAsync(items, mapper, { concurrency = 4, signal })`

```ts
import { mapAsync } from 'quorin/async';

const pages = await mapAsync(urls, async (url, index, { signal }) => {
  const response = await fetch(url, { signal });
  return response.json();
}, { concurrency: 8 });
```

Results are returned in input order. The input array is snapshotted when the call starts, and sparse arrays are rejected. The first mapper failure or a caller abort stops new work, aborts the signal passed to running mappers, and rejects. Work that already started may continue; its settlement is still observed so nothing becomes an unhandled rejection. Result storage is O(n) and scheduling state is O(concurrency). This is an array mapper, not a streaming API.

## `createRateLimiter({ rate, intervalMs = 1000, burst = rate, maxPending = 1024 })`

```ts
import { createRateLimiter } from 'quorin/async';

const limiter = createRateLimiter({ rate: 100, intervalMs: 60_000, burst: 25 });

await limiter.acquire({ weight: 1, signal });  // FIFO, waits for refill
if (limiter.tryAcquire(1)) {
  // got tokens at once, and nobody was waiting ahead
}
limiter.tokens;        // current tokens, refilled lazily
limiter.pendingCount;  // waiting acquires
limiter.clear();       // reject every waiting acquire (QUEUE_CLEARED)
```

- Token bucket: `rate` tokens accrue per `intervalMs`, capped at `burst`. The bucket starts full and refills continuously on the injected clock, so tests advance fake time.
- `acquire({ weight, signal })` consumes `weight` tokens (fractional weights fit token-based limits). Waiters are served in strict FIFO order, even when a later waiter needs fewer tokens. Beyond `maxPending` waiting acquires, `acquire` rejects with `QueueError` code `QUEUE_FULL`.
- `tryAcquire(weight)` consumes at once and returns false when the bucket lacks tokens or anyone is waiting, so it never jumps the queue.
- Aborting a waiting `acquire` removes it and rejects with the signal's reason; the next waiter is served at once if the bucket already covers it. A `weight` above `burst` throws `INVALID_ARGUMENT` because it could never be satisfied.
- `clear(reason?)` rejects every waiting acquire with `reason`, or `QueueError` code `QUEUE_CLEARED`, and keeps the tokens already in the bucket.

Combine with `withResilience`: gate calls with the limiter, and let `retryDelayMs` honor `Retry-After` when the server still answers 429.

## `singleFlight(fn, { key, maxInFlight = 1024 })`

```ts
import { singleFlight } from 'quorin/async';

const loadProfile = singleFlight(
  async (args: readonly [id: string], { signal }) => fetchProfile(args[0], signal),
);

const [a, b] = await Promise.all([loadProfile(['u1']), loadProfile(['u1'])]);
// one fetchProfile call serves both, a === b
```

- Concurrent calls with the same key share one in-flight invocation; every caller receives the same settled value (by reference) or the same rejection. Once the flight settles, nothing is cached: the next call starts a new one.
- The default key is `stableStringify(args)`, so args must be JSON values; a custom `key(args)` decides identity itself. Non-JSON keys reject with `UNSUPPORTED_VALUE`, and errors thrown by `key` reject the call unchanged.
- The wrapped function receives `{ signal }`. One caller aborting only disconnects that caller. Once every caller has canceled, the flight's signal aborts so work nobody waits for can stop, and the next call starts a fresh flight instead of joining the canceled one.
- At most `maxInFlight` invocations run at once, counting abandoned ones that have not settled yet; beyond that calls reject with `QueueError` code `QUEUE_FULL`.

Use `createCache` when results should outlive the call; use `singleFlight` to collapse a burst into one call and nothing more.
