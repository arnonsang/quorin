# quorin/cache

A strict LRU cache with TTL, stale-while-revalidate, and coalesced loading.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `createCache(options)`

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

## Loading caches

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
