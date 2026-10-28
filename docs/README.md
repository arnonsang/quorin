# quorin docs

Back to the [project README](../README.md).

## Modules

| Page | Subpath | What it covers |
| --- | --- | --- |
| [struct](./struct.md) | `quorin/struct` | `Deque`, `ValueMap`, `Multimap` |
| [object](./object.md) | `quorin/object` | `getPath`, `setPath`, `deepMerge`, `stableStringify`, JSON values |
| [bytes](./bytes.md) | `quorin/bytes` | UTF-8, hex, base64 and base64url, `fastHash` |
| [async](./async.md) | `quorin/async` | `concurrencyLimit`, `mapAsync`, `createRateLimiter`, `singleFlight` |
| [concurrency](./concurrency.md) | `quorin/async` | `Channel`, `select`, `spawn`, `createTaskGroup`, `Mutex`, `RWMutex`, `KeyedMutex`, `tick` |
| [signal](./signal.md) | `quorin/signal` | `onAbort`, `timeoutSignal` |
| [result](./result.md) | `quorin/result` | `SafeResult`, `ok`, `err`, `trySafe`, `trySafeSync`, defects |
| [boundary](./boundary.md) | `quorin/boundary` | `parseEnv`, `defineBoundary`, `formatIssues` |
| [resilience](./resilience.md) | `quorin/resilience` | `withResilience`, `parseRetryAfter`, `isUserAbort` |
| [cache](./cache.md) | `quorin/cache` | `createCache`, loading caches, stale-while-revalidate |
| [state](./state.md) | `quorin/state` | `safeClone`, `isEqual`, `redact` |

## Across modules

- [Errors and cancellation](./errors-and-cancellation.md): error codes and how every module treats `AbortSignal`.
- [Compatibility](./compatibility.md): tested runtimes and TypeScript settings.
- [Development](./development.md): scripts, layout, and releases.
