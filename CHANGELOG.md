# Changelog

## 0.1.2-rc.0 (2026-10-28)

- `quorin/resilience`: `withResilience` accepts an optional `retryDelayMs(failure)` hook whose value replaces the jittered backoff for that retry (for example a server's `Retry-After`). Caller delays may exceed `maxDelayMs`; `totalTimeoutMs` still caps the run; hook errors reject.
- `quorin/resilience`: new `parseRetryAfter(header)` parses delta seconds or an IMF-fixdate into whole milliseconds. Past dates return `0`, malformed values return `null`, and it never throws.
- `quorin/async`: new `createChannel({ capacity, maxPending })`, a bounded FIFO async queue with abort-aware `put`/`take`, drain-first idempotent `close`, and async iteration. Default `capacity: 0` gives immediate backpressure; waiting puts beyond `maxPending` reject `QUEUE_FULL`; closed behavior rejects `ChannelError` code `CHANNEL_CLOSED`.
- `quorin/signal`: new subpath with `onAbort(signal, listener)` (already aborted signals fire the listener synchronously; idempotent unsubscribe) and `timeoutSignal(ms, { signal })` (TimeoutError deadline on the injected clock, optional parent aborts early, `cancel()` clears the timer, pending timers do not keep the process alive).
- `quorin/async`: new `createRateLimiter({ rate, intervalMs, burst, maxPending })`, a token bucket on the injected clock. Acquires wait in strict FIFO order with fractional weights, `tryAcquire` never jumps the queue, and waiting acquires beyond `maxPending` reject `QUEUE_FULL`.
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
