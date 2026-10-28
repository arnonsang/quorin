import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concurrencyLimit, createChannel, mapAsync, ChannelError, QueueError } from '../../src/async/index.ts';
import { deferred, flush, settled } from '../helpers/deferred.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

describe('concurrencyLimit', () => {
  it('runs tasks FIFO within the concurrency ceiling', async () => {
    const limit = concurrencyLimit(2);
    const gates = [deferred(), deferred(), deferred()];
    const order: number[] = [];
    let maxActive = 0;
    const runs = gates.map((gate, index) =>
      limit(async () => {
        order.push(index);
        maxActive = Math.max(maxActive, limit.activeCount);
        await gate.promise;
        return index;
      }),
    );
    assert.equal(limit.activeCount, 2);
    assert.equal(limit.pendingCount, 1);
    gates[1]!.resolve();
    gates[0]!.resolve();
    gates[2]!.resolve();
    assert.deepEqual(await Promise.all(runs), [0, 1, 2]);
    assert.deepEqual(order, [0, 1, 2]);
    assert.equal(maxActive, 2);
    assert.equal(limit.activeCount, 0);
  });

  it('releases the slot when a callback throws synchronously', async () => {
    const limit = concurrencyLimit(1);
    await assert.rejects(limit(() => {
      throw new Error('sync');
    }), /sync/);
    assert.equal(limit.activeCount, 0);
    assert.equal(await limit(() => 'next'), 'next');
  });

  it('rejects when the pending bound is reached', async () => {
    const limit = concurrencyLimit(1, { maxPending: 1 });
    const gate = deferred();
    const first = limit(() => gate.promise);
    const second = limit(() => 'b');
    await assert.rejects(limit(() => 'c'), (error) => error instanceof QueueError && error.code === 'QUEUE_FULL');
    gate.resolve();
    await first;
    assert.equal(await second, 'b');
  });

  it('allows maxPending zero', async () => {
    const limit = concurrencyLimit(1, { maxPending: 0 });
    const gate = deferred();
    const first = limit(() => gate.promise);
    await assert.rejects(limit(() => 1), code('QUEUE_FULL'));
    gate.resolve();
    await first;
  });

  it('removes queued tasks immediately when aborted', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const blocker = limit(() => gate.promise);
    const controller = new AbortController();
    let started = false;
    const queued = limit(() => {
      started = true;
    }, { signal: controller.signal });
    const reason = { custom: true };
    controller.abort(reason);
    await assert.rejects(queued, (error) => error === reason);
    assert.equal(limit.pendingCount, 0);
    gate.resolve();
    await blocker;
    assert.equal(started, false);
  });

  it('rejects immediately for an already aborted signal', async () => {
    const limit = concurrencyLimit(1);
    let started = false;
    await assert.rejects(limit(() => {
      started = true;
    }, { signal: AbortSignal.abort('gone') }), (error) => error === 'gone');
    assert.equal(started, false);
  });

  it('keeps the slot occupied after a running abort until the task settles', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const controller = new AbortController();
    let taskSignal: AbortSignal | undefined;
    const running = limit(({ signal }) => {
      taskSignal = signal;
      return gate.promise;
    }, { signal: controller.signal });
    const next = settled(limit(() => 'next'));
    controller.abort(null);
    await assert.rejects(running, (error) => error === null);
    assert.equal(taskSignal?.aborted, true);
    assert.equal(limit.activeCount, 1);
    await flush();
    assert.equal(next.state, 'pending');
    gate.resolve();
    await flush();
    assert.equal(next.state, 'fulfilled');
    assert.equal(limit.activeCount, 0);
  });

  it('does not leak a late rejection after abort', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const controller = new AbortController();
    const running = limit(() => gate.promise, { signal: controller.signal });
    controller.abort('stop');
    await assert.rejects(running);
    gate.reject(new Error('late'));
    await flush();
    assert.equal(limit.activeCount, 0);
  });

  it('clears pending tasks with a default or custom reason', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const running = limit(() => gate.promise);
    const a = limit(() => 1);
    const b = limit(() => 2);
    limit.clear();
    await assert.rejects(a, code('QUEUE_CLEARED'));
    await assert.rejects(b, code('QUEUE_CLEARED'));
    const c = limit(() => 3);
    limit.clear('custom');
    await assert.rejects(c, (error) => error === 'custom');
    gate.resolve();
    await running;
  });

  it('skips queued tasks whose signal aborted before dequeue', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const running = limit(() => gate.promise);
    const controller = new AbortController();
    const queued = limit(() => 1, { signal: controller.signal });
    const after = limit(() => 2);
    controller.abort('x');
    gate.resolve();
    await running;
    await assert.rejects(queued);
    assert.equal(await after, 2);
  });

  it('validates configuration', async () => {
    assert.throws(() => concurrencyLimit(0), code('INVALID_ARGUMENT'));
    assert.throws(() => concurrencyLimit(1, { maxPending: -1 }), code('INVALID_ARGUMENT'));
    assert.throws(() => concurrencyLimit(1, null as never), code('INVALID_ARGUMENT'));
    const limit = concurrencyLimit(1);
    await assert.rejects(limit('nope' as never), code('INVALID_ARGUMENT'));
    await assert.rejects(limit(() => 1, { signal: {} as AbortSignal }), code('INVALID_ARGUMENT'));
  });
});

describe('mapAsync', () => {
  it('returns results in input order with bounded concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapAsync([30, 10, 20, 0, 5], async (delay, index) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active--;
      return index * 2;
    }, { concurrency: 2 });
    assert.deepEqual(result, [0, 2, 4, 6, 8]);
    assert.equal(maxActive, 2);
  });

  it('accepts synchronous values and throws', async () => {
    assert.deepEqual(await mapAsync([1, 2], (value) => value + 1), [2, 3]);
    await assert.rejects(mapAsync([1], () => {
      throw new Error('sync');
    }), /sync/);
  });

  it('stops starting work after the first failure and aborts running mappers', async () => {
    const started: number[] = [];
    const signals: AbortSignal[] = [];
    const gate = deferred();
    const failure = new Error('fail');
    const run = mapAsync([0, 1, 2, 3], async (value, _index, { signal }) => {
      started.push(value);
      signals.push(signal);
      if (value === 0) throw failure;
      await gate.promise;
      return value;
    }, { concurrency: 2 });
    await assert.rejects(run, (error) => error === failure);
    assert.deepEqual(started, [0, 1]);
    assert.equal(signals[1]?.aborted, true);
    gate.resolve();
    await flush();
    assert.deepEqual(started, [0, 1]);
  });

  it('rejects on caller abort with the original reason', async () => {
    const controller = new AbortController();
    const gate = deferred();
    const run = mapAsync([1, 2], () => gate.promise, { signal: controller.signal });
    controller.abort('cancelled');
    await assert.rejects(run, (error) => error === 'cancelled');
    gate.resolve();
  });

  it('snapshots the input array', async () => {
    const items = [1, 2, 3];
    const gate = deferred();
    const run = mapAsync(items, async (value) => {
      await gate.promise;
      return value;
    }, { concurrency: 1 });
    items.push(4);
    items[1] = 20;
    gate.resolve();
    assert.deepEqual(await run, [1, 2, 3]);
  });

  it('handles empty input, sparse arrays, and pre-aborted signals', async () => {
    assert.deepEqual(await mapAsync([], () => 1), []);
    await assert.rejects(mapAsync([], () => 1, { signal: AbortSignal.abort('x') }), (error) => error === 'x');
    await assert.rejects(mapAsync([1, , 3], () => 1), code('UNSUPPORTED_VALUE'));
    await assert.rejects(mapAsync('abc' as never, () => 1), code('INVALID_ARGUMENT'));
    await assert.rejects(mapAsync([1], () => 1, { concurrency: 0 }), code('INVALID_ARGUMENT'));
  });
});

describe('limiter queue removal', () => {
  it('removes an aborted task from the middle of the queue', async () => {
    const limit = concurrencyLimit(1);
    const gate = deferred();
    const running = limit(() => gate.promise);
    const controller = new AbortController();
    const first = limit(() => 'first');
    const middle = limit(() => 'middle', { signal: controller.signal });
    const last = limit(() => 'last');
    controller.abort('skip');
    await assert.rejects(middle, (error) => error === 'skip');
    assert.equal(limit.pendingCount, 2);
    gate.resolve();
    await running;
    assert.deepEqual(await Promise.all([first, last]), ['first', 'last']);
  });
});

describe('createChannel', () => {

  it('hands a value straight to a waiting take without buffering', async () => {
    const channel = createChannel<string>();
    const take = channel.take();
    await flush();
    assert.equal(channel.pendingTakes, 1);
    await channel.put('direct');
    assert.equal(channel.size, 0);
    assert.equal(await take, 'direct');
  });

  it('waits for a take with the default zero capacity and hands the value over', async () => {
    const channel = createChannel<string>();
    const put = channel.put('a');
    await flush();
    assert.equal(channel.pendingPuts, 1);
    assert.equal(channel.size, 0);
    assert.equal(await channel.take(), 'a');
    await put;
    assert.equal(channel.pendingPuts, 0);
  });

  it('buffers up to capacity and promotes a waiting put on take', async () => {
    const channel = createChannel<number>({ capacity: 2 });
    await channel.put(1);
    await channel.put(2);
    assert.equal(channel.size, 2);
    const third = channel.put(3);
    await flush();
    assert.equal(channel.pendingPuts, 1);
    assert.equal(await channel.take(), 1);
    await third;
    assert.equal(channel.size, 2);
    assert.deepEqual([await channel.take(), await channel.take()], [2, 3]);
  });

  it('serves waiting puts to arriving takes in FIFO order', async () => {
    const channel = createChannel<string>();
    const puts = ['x', 'y', 'z'].map((value) => channel.put(value));
    const order: string[] = [];
    for (let index = 0; index < 3; index++) order.push(await channel.take());
    await Promise.all(puts);
    assert.deepEqual(order, ['x', 'y', 'z']);
  });

  it('rejects puts beyond maxPending with QUEUE_FULL', async () => {
    const channel = createChannel<number>({ maxPending: 1 });
    const first = channel.put(1);
    const second = channel.put(2);
    await assert.rejects(second, (error: unknown) => error instanceof QueueError && error.code === 'QUEUE_FULL');
    assert.equal(await channel.take(), 1);
    await first;
  });

  it('keeps buffered values takeable after close and then rejects with CHANNEL_CLOSED', async () => {
    const channel = createChannel<number>({ capacity: 1 });
    await channel.put(9);
    channel.close();
    channel.close();
    assert.equal(channel.closed, true);
    assert.equal(await channel.take(), 9);
    await assert.rejects(channel.take(), (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED');
    await assert.rejects(channel.put(1), (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED');
  });

  it('rejects waiting takes and waiting puts when closing', async () => {
    const takeChannel = createChannel<number>();
    const waitingTake = takeChannel.take();
    takeChannel.close();
    await assert.rejects(waitingTake, (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED');
    const putChannel = createChannel<number>();
    const waitingPut = putChannel.put(1);
    putChannel.close();
    await assert.rejects(waitingPut, (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED');
    assert.equal(putChannel.pendingPuts, 0);
  });

  it('rejects waiting puts and takes on abort and removes them from the queues', async () => {
    const channel = createChannel<number>();
    const takeController = new AbortController();
    const waitingTake = channel.take({ signal: takeController.signal });
    takeController.abort('nope');
    await assert.rejects(waitingTake, (reason: unknown) => reason === 'nope');
    assert.equal(channel.pendingTakes, 0);
    const putController = new AbortController();
    const waitingPut = channel.put(1, { signal: putController.signal });
    putController.abort('stop');
    await assert.rejects(waitingPut, (reason: unknown) => reason === 'stop');
    assert.equal(channel.pendingPuts, 0);
  });

  it('rejects immediately on already aborted signals', async () => {
    const channel = createChannel<number>();
    await assert.rejects(channel.put(1, { signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
    await assert.rejects(channel.take({ signal: AbortSignal.abort('early') }), (reason: unknown) => reason === 'early');
  });

  it('iterates values in order and ends when the channel closes', async () => {
    const channel = createChannel<number>({ capacity: 4 });
    await channel.put(1);
    await channel.put(2);
    channel.close();
    await assert.rejects(channel.put(3), (error: unknown) => error instanceof ChannelError && error.code === 'CHANNEL_CLOSED');
    const seen: number[] = [];
    for await (const value of channel) seen.push(value);
    assert.deepEqual(seen, [1, 2]);
  });

  it('supports one producer and many sequential takes while open', async () => {
    const channel = createChannel<number>({ capacity: 3 });
    await channel.put(10);
    await channel.put(20);
    assert.equal(await channel.take(), 10);
    await channel.put(30);
    assert.deepEqual([await channel.take(), await channel.take()], [20, 30]);
    assert.equal(channel.size, 0);
  });

  it('passes values by reference, including undefined', async () => {
    const channel = createChannel<{ tag: string } | undefined>({ capacity: 2 });
    const value = { tag: 'same' };
    await channel.put(value);
    assert.equal(await channel.take(), value);
    const empty = channel.put(undefined);
    assert.equal(await channel.take(), undefined);
    await empty;
  });

  it('validates options and arguments', async () => {
    assert.throws(() => createChannel({ capacity: -1 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createChannel({ maxPending: 1.5 }), code('INVALID_ARGUMENT'));
    assert.throws(() => createChannel('x' as never), code('INVALID_ARGUMENT'));
    const channel = createChannel<number>();
    await assert.rejects(channel.put(1, { signal: 'x' as never }), code('INVALID_ARGUMENT'));
    await assert.rejects(channel.take({ signal: 'x' as never }), code('INVALID_ARGUMENT'));
    await assert.rejects(channel.put(1, null as never), code('INVALID_ARGUMENT'));
  });
});
