# Concurrency

Channels, select, cancellable tasks, task groups, locks, and interval loops. Everything here is exported from `quorin/async`.

Part of the [quorin docs](./README.md). Back to the [project README](../README.md).

These primitives coordinate async work inside one JavaScript isolate. They are cooperative: a task only gives way at an `await`, so a tight synchronous loop still blocks everything else, and nothing here runs on another thread. For CPU-bound work, put a worker pool behind `mapAsync` or `concurrencyLimit`, and the same cancellation and timeout rules still apply around it.

## `Channel<T>`

```ts
import { Channel } from 'quorin/async';

const jobs = new Channel<Job>(16);            // buffers up to 16 values
const handoff = new Channel<string>();         // capacity 0: every send waits for a receive
const bounded = new Channel<Job>({ capacity: 8, maxPending: 64 });

await jobs.send(job, { signal });              // waits when the buffer is full
const next = await jobs.receive({ signal });   // waits when the buffer is empty

if (jobs.trySend(job)) { /* buffered or handed over without waiting */ }
const probe = jobs.tryReceive();               // { ok: true, value } or { ok: false, closed }

jobs.close();                                  // buffered values still drain
for await (const job of jobs) handle(job);     // ends once closed and drained
```

- **Backpressure.** With capacity 0, `send` resolves only once a receiver takes the value. With capacity `n`, up to `n` values wait in the buffer and further sends wait for room.
- **Bounded waiting.** `maxPending` (default 1024) limits sends waiting for room; beyond it `send` rejects with `QueueError` code `QUEUE_FULL`. This keeps a fast producer from growing memory without limit.
- **Order.** Values are received in FIFO order, and waiting sends and receives are served in arrival order.
- **Closing.** `close()` stops new sends, rejects waiting sends and receives with `ChannelError` code `CHANNEL_CLOSED`, and lets buffered values drain. After that, `receive` rejects with `CHANNEL_CLOSED` and iteration ends. Closing twice does nothing.
- **Non-blocking probes.** `trySend` returns false instead of waiting, and throws `CHANNEL_CLOSED` on a closed channel, because a value sent after close is almost always a bug. `tryReceive` returns a discriminated result, so `undefined` is a normal value and never a signal for "empty".
- **Cancellation.** `send`, `receive`, and `values({ signal })` take a signal. Aborting removes the waiting operation and rejects with the signal's reason. A plain `for await (const v of channel)` has no signal; use `channel.values({ signal })` when the loop must be cancellable.
- **Direction views.** `channel.sendOnly()` returns a `ChannelSender<T>` that can send and close, and `channel.receiveOnly()` returns a `ChannelReceiver<T>` that can only receive. Both share the channel's state. Hand them to producers and consumers so each side can only do its own job.
- **Ownership.** Values pass by reference.

Counters: `capacity`, `size` (buffered values), `pendingSends`, `pendingReceives`, `closed`.

## `select(cases, options?)`

Waits for the first of several operations and performs exactly one.

```ts
import { after, receive, select, send, whenAborted } from 'quorin/async';

const [value, index] = await select([
  receive(jobs),        // 0
  receive(quit),        // 1
  after(30_000),        // 2
  whenAborted(signal),  // 3
]);

if (index === 0 && value.ok) await handle(value.value);
if (index === 1 || index === 3) return;
```

| Case | Ready when | Produces |
| --- | --- | --- |
| `receive(channel)` | a value is buffered or a send is waiting, or the channel is closed and drained | `{ ok: true, value }`, or `{ ok: false, closed: true }` |
| `send(channel, value)` | a receive is waiting or the buffer has room | `undefined` (rejects `CHANNEL_CLOSED` on a closed channel) |
| `after(ms)` | `ms` have passed on the injected clock since the select started waiting | `undefined` |
| `whenAborted(signal)` | the signal aborts | the abort reason |

- **Exactly one case wins.** Readiness is checked and committed in one synchronous step. Waiting cases claim their turn before taking a value, so a losing case never consumes anything: no value is lost when two channels become ready in the same tick, which a `Promise.race` over two receives cannot guarantee.
- **Fair choice.** When several cases are ready at once, one is picked at random so no case starves. The randomness comes from the injected clock, so tests stay deterministic.
- **Non-blocking select.** `select(cases, { default: value })` resolves `[value, -1]` when nothing is ready, without waiting.
- **Cleanup.** When a case wins, the other cases are removed from their channels and their timers and abort listeners are released.
- **Cancelling the select.** `select(cases, { signal })` rejects with the signal's reason and releases every case. Use `whenAborted(signal)` instead when cancellation should be a normal outcome.
- **Types.** The result is a union of `[value, index]` pairs, so checking `index` narrows `value` to that case's type.
- Channel views work as cases, and `maxPending` also applies to waiting `send` cases.

## `spawn(fn, options?)`

Starts a cancellable task and returns a handle, so a background task cannot quietly lose its error.

```ts
import { spawn } from 'quorin/async';

const task = spawn(({ signal }) => syncInventory(signal), { signal: shutdown });

task.cancel('no longer needed');   // aborts task.signal
const result = await task.result;  // SafeResult, never an unhandled rejection
if (!result.ok) log.warn('inventory sync failed', result.error);
```

- `fn` starts immediately with its own `signal`, linked to the optional parent `signal`.
- `result` settles when `fn` settles, as a `SafeResult`. Ordinary failures are values; defects (`DefectError`, or what your `classifyDefect` approves) still reject, so bugs stay loud. `mapError`, `classifyDefect`, `onDefect`, and `catchDefects` work as in [`trySafe`](./result.md#trysafefn-options-and-trysafesyncfn-options).
- `cancel(reason?)` only asks the task to stop. `result` still reflects what the function actually did.
- If the parent signal is already aborted, `fn` is not called and `result` holds the abort reason.

## `createTaskGroup(options?)`

Runs related tasks under one signal and waits for all of them.

```ts
import { createTaskGroup } from 'quorin/async';

const group = createTaskGroup<Report>({ concurrency: 4, signal });
for (const region of regions) {
  group.run(({ signal }) => buildReport(region, signal));
}
const result = await group.wait();
if (result.ok) publish(result.data);  // values in run order
else log.error('report failed', result.error);
```

- **Fail fast, wait fully.** The first failure, `cancel(reason)`, or an abort of the parent `signal` stops the group: queued tasks are dropped, and running tasks see `group.signal` abort with that reason. `wait()` still waits until every started task has settled, so nothing outlives the group unobserved.
- **Results.** `wait()` resolves `ok(values)` in `run` order, or `err(firstFailure)`. A defect rejects `wait()` instead. Calling `wait()` again returns the same promise.
- **Concurrency.** `concurrency` caps running tasks (default unlimited); the rest wait in FIFO order.
- **Dynamic work.** Tasks may call `group.run` to add more work. Once the group is stopping, new `run` calls are ignored; after `wait()` has settled, `run` throws `INVALID_ARGUMENT`.
- Counters: `activeCount`, `pendingCount`, and the shared `signal`.

## `Mutex` and `withLock(mutex, fn, options?)`

```ts
import { Mutex, withLock } from 'quorin/async';

const mutex = new Mutex();

await withLock(mutex, async () => {
  const balance = await readBalance();
  await writeBalance(balance - amount);
});

const release = await mutex.lock({ signal });  // lower level
try {
  await critical();
} finally {
  release();
}
```

- `withLock` is the default: it always releases, even when `fn` throws.
- `lock({ signal })` resolves with a release function. Releasing twice does nothing. Waiters are served in FIFO order, and an aborted waiter leaves the queue with the signal's reason.
- `tryLock()` returns a release function if the lock is free, or `null`.
- Counters: `locked`, `pendingCount`.

## `RWMutex`

```ts
import { RWMutex } from 'quorin/async';

const config = new RWMutex();

const releaseRead = await config.lockRead();   // many readers at once
const releaseWrite = await config.lockWrite(); // one writer, no readers
```

- Requests are served in arrival order. Readers at the front of the queue are admitted together; a waiting writer holds back readers that arrive after it, so a steady stream of readers cannot starve writers.
- Both methods accept `{ signal }`. Counters: `readers`, `writing`, `pendingCount`.

## `KeyedMutex`

Serializes work per key, such as a user, session, or file, while different keys run concurrently.

```ts
import { KeyedMutex } from 'quorin/async';

const perUser = new KeyedMutex();

await perUser.with(`user:${id}`, () => applyCredit(id, amount), { signal });
```

- Keys are strings.
- A key is forgotten as soon as nobody holds or waits for it, so memory stays bounded by the work in progress (`size` reports the tracked keys).

## `tick(intervalMs, options?)`

An interval loop on the injected clock.

```ts
import { tick } from 'quorin/async';

for await (const n of tick(5_000, { signal })) {
  await poll();
}
```

- Yields tick numbers counted from the call: 1, 2, 3, ...
- Ticks never pile up. If the loop body takes longer than the interval, the next value is the latest due tick, so the numbers skip the ones that were missed.
- The timer only runs while the loop waits for the next tick, and breaking out of the loop leaves nothing behind.
- Aborting the signal ends the loop by throwing the abort reason.
