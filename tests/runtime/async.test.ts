import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concurrencyLimit, mapAsync, QueueError } from '../../src/async/index.ts';
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
