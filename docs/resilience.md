# quorin/resilience

Retries with backoff, attempt and total timeouts, and Retry-After support.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `withResilience(task, options?)`

```ts
import { withResilience, isUserAbort } from 'quorin/resilience';

const result = await withResilience(
  async ({ signal, attempt }) => {
    const response = await fetch(url, { signal });
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new TransientReadError(response.status);
    }
    return response.json(); // awaited inside, so the timeout covers the body
  },
  {
    retries: 3,
    retrySafe: true,
    shouldRetry: (error) => error instanceof TransientReadError,
    attemptTimeoutMs: 2_000,
    totalTimeoutMs: 8_000,
    signal: request.signal,
  },
);

if (result.ok) {
  use(result.data);
} else if (isUserAbort(result)) {
  // the caller gave up
} else {
  report(result.error); // RunFailure
}
```

Resolves to `SafeResult<T, RunFailure<E>>`:

```ts
type RunFailure<E = unknown> =
  | { kind: 'task'; error: E; attempt: number }
  | { kind: 'timeout'; scope: 'attempt' | 'total'; attempt: number; timeoutMs: number }
  | { kind: 'aborted'; reason: unknown; attempt: number };
```

| Option | Default | Description |
| --- | --- | --- |
| `retries` | `0` | Additional attempts. `retries: 2` means at most three attempts. |
| `retrySafe` | | Must be `true` when `retries > 0`. Confirms that repeating the operation is acceptable. |
| `shouldRetry(error, attempt)` | | Required when `retries > 0`. Must synchronously return a boolean. Nothing is retried by default. |
| `retryDelayMs(failure)` | none | Caller-supplied delay in milliseconds for the next retry, replacing the jittered curve. May return a promise. See `parseRetryAfter`. |
| `attemptTimeoutMs` | none | Per-attempt timeout. `0` expires before the task runs. |
| `totalTimeoutMs` | none | Deadline for the whole run, including backoff. |
| `baseDelayMs` / `maxDelayMs` | `100` / `5000` | Backoff before retry `j` is uniform in `[0, min(max, base * 2^j))`. |
| `signal` | none | Caller cancellation. |
| `mapError`, `classifyDefect`, `onDefect`, `catchDefects` | | Same as the result module. |

Behavior worth knowing:

- Each attempt gets a fresh `AbortSignal` and the task is invoked again; a started promise is never reused.
- **Library timeouts are terminal.** A timeout aborts the attempt signal and returns a timeout failure; it does not start another attempt. This prevents a new attempt from overlapping one that ignored cancellation.
- A retry is skipped when its delay would reach the total deadline. The last task failure is returned instead.
- When `retryDelayMs` is set, its value replaces the jittered delay for that retry, even beyond `maxDelayMs` (a `Retry-After` header is authoritative). The total deadline still applies, and a hook that throws, rejects, or resolves to anything but a nonnegative finite number rejects the run.
- A success observed before a terminal event wins. Late settlements after a terminal event are observed and ignored.
- Defects, invalid options, and errors thrown by hooks reject the returned promise.
- `isUserAbort(value)` recognizes only aborted failures created by this function (or results holding them). An error that happens to be named `AbortError` is not enough.

A resolved HTTP 500 response is a successful promise. Inspect the status and throw your own retryable error, and consume or cancel bodies you discard.

## `parseRetryAfter(header)`

```ts
import { parseRetryAfter } from 'quorin/resilience';

const delayMs = parseRetryAfter(response.headers.get('retry-after')); // number | null

const result = await withResilience(fetchThing, {
  retries: 2,
  retrySafe: true,
  shouldRetry: isRateLimited,
  retryDelayMs: ({ error }) => parseRetryAfter(retryAfterHeaderOf(error)) ?? 800,
});
```

Parses delta seconds (`'120'`) or an IMF-fixdate (`'Wed, 21 Oct 2015 07:28:00 GMT'`, the day of the week is not validated) into whole milliseconds to wait, relative to the injected clock. Dates in the past return `0`. Malformed values, and delays beyond `Number.MAX_SAFE_INTEGER` milliseconds, return `null` so callers can fall back to a default. Never throws.
