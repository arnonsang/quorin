# quorin/signal

Helpers for subscribing to cancellation and for deadlines that tests can control.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

## `onAbort(signal, listener)`

```ts
import { onAbort } from 'quorin/signal';

const unsubscribe = onAbort(request.signal, (reason) => cleanup());
try {
  await work();
} finally {
  unsubscribe();  // idempotent; cannot leak the listener
}
```

Subscribes to a signal's abort with the reason. An already aborted signal invokes the listener synchronously. The returned unsubscribe is idempotent and removes the listener; the listener also detaches itself after firing once.

## `timeoutSignal(ms, { signal })`

```ts
import { timeoutSignal } from 'quorin/signal';

const deadline = timeoutSignal(5_000, { signal: request.signal });
try {
  await fetch(url, { signal: deadline.signal });
} finally {
  deadline.cancel();  // clears the timer without aborting
}
```

- Aborts with a `TimeoutError` after `ms` on quorin's injected clock, so tests advance fake time instead of waiting (unlike `AbortSignal.timeout`, which only reads the real clock).
- An optional parent `signal` aborts the deadline early with the parent's reason and clears the timer, replacing hand-rolled `AbortSignal.any` composition.
- `cancel()` clears the timer without aborting and is idempotent. A pending timer does not keep the process alive.
- `ms` must be a nonnegative number of milliseconds, at most `2147483647`; anything else throws `INVALID_ARGUMENT`.
