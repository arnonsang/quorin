# Errors and cancellation

How every quorin module reports failures and treats `AbortSignal`.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

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
| `QUEUE_FULL`, `QUEUE_CLEARED` | `QueueError` when a bounded queue is full or cleared: `concurrencyLimit`, `createRateLimiter`, `singleFlight`, and `Channel` sends. |
| `CHANNEL_CLOSED` | `ChannelError` from a `Channel` or `select` after `close`. |
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

An `AbortSignal` cannot preempt synchronous code, undo side effects, or force a promise to settle. Work that ignores its signal keeps running, and quorin keeps accounting for it: limiter slots, single-flight and cache in-flight slots, and task group slots stay occupied until the underlying work settles, and late results are observed so they never become unhandled rejections. Every terminal path removes its listeners and clears its timers. Timeouts run on the event loop, so they cannot interrupt a blocked thread.
