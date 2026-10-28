# Changelog

## 0.2.0 (unreleased)

### Concurrency (`quorin/async`)

- **Breaking for pre-release users:** `createChannel` (only in the unpublished `0.1.2-rc.0`) is replaced by the `Channel` class: `new Channel<T>(capacity | { capacity, maxPending })` with `send`, `receive`, `trySend`, `tryReceive`, `close`, `values({ signal })`, async iteration, and `sendOnly()`/`receiveOnly()` views. `tryReceive` returns `{ ok: true, value }` or `{ ok: false, closed }`.
- New `select(cases, { default, signal })` with `receive(channel)`, `send(channel, value)`, `after(ms)`, and `whenAborted(signal)` cases. Exactly one case is performed, losing cases never consume a value, ready cases are chosen at random through the injected clock, and the `[value, index]` result narrows by index.
- New `spawn(fn, { signal })` returning `{ signal, result, cancel }`, where `result` is a `SafeResult`.
- New `createTaskGroup({ concurrency, signal })` with `run`, `wait`, and `cancel`: the first failure cancels the group and `wait` waits for every started task.
- New `Mutex` (`lock`, `tryLock`), `withLock`, `RWMutex` (`lockRead`, `lockWrite`, no writer starvation), and `KeyedMutex` (`with(key, fn)`, idle keys forgotten).
- New `tick(intervalMs, { signal })` interval loops on the injected clock that skip missed ticks.
- New `createRateLimiter({ rate, intervalMs, burst, maxPending })`, a token bucket on the injected clock with strict FIFO acquires, `tryAcquire`, `clear`, and `pendingCount`.
- New `singleFlight(fn, { key, maxInFlight })` for coalescing concurrent identical calls without caching. Abandoned flights are detached, so later calls start fresh.

### Other modules

- `quorin/signal`: new subpath with `onAbort(signal, listener)` and `timeoutSignal(ms, { signal })`.
- `quorin/resilience`: `withResilience` accepts `retryDelayMs(failure)` to override the backoff for a retry, and new `parseRetryAfter(header)` parses `Retry-After` values.

### Docs

- The README is now a short overview; each module has its own page under `docs/`.

## 0.1.1 (2026-10-26)

- Add `typesVersions` so subpath imports such as `quorin/cache` type check under legacy `moduleResolution: "node"` (TypeScript 6 and earlier).
- Test declarations on TypeScript 5.8 as well as 7.0, including CommonJS consumers under `NodeNext`.
- Document TypeScript settings per project type, and align the documented `require` support with the Node 22.19.0 engines floor.

## 0.1.0 (2026-10-26)

First public preview with all nine modules.

- `quorin/struct`: `Deque`, `ValueMap`, `Multimap`
- `quorin/object`: `getPath`, `setPath`, `deepMerge`, `stableStringify`, `SecurityError`
- `quorin/bytes`: `concatBytes`, `equalsBytes`, `stringToBytes`, `bytesToString`, `toHex`, `fromHex`, `toBase64`, `fromBase64`, `fastHash`
- `quorin/async`: `concurrencyLimit`, `mapAsync`, `QueueError`
- `quorin/result`: `ok`, `err`, `trySafe`, `trySafeSync`, `isDefect`, `DefectError`
- `quorin/boundary`: `parseEnv`, `defineBoundary`, `formatIssues`, `BoundaryValidationError`
- `quorin/resilience`: `withResilience`, `isUserAbort`
- `quorin/cache`: `createCache`, `CacheError`
- `quorin/state`: `safeClone`, `isEqual`, `redact`, `CLONE_SYMBOL`, `StateError`
