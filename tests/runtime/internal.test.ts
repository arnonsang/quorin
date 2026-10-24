import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { onAbort, timeoutReason } from '../../src/internal/abort.ts';
import { schedule, systemClock } from '../../src/internal/clock.ts';
import { LinkedQueue } from '../../src/internal/linked-queue.ts';
import { withResilience } from '../../src/resilience/index.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

describe('internal helpers', () => {
  it('creates a timeout reason without DOMException', () => {
    const original = globalThis.DOMException;
    try {
      Reflect.deleteProperty(globalThis, 'DOMException');
      const reason = timeoutReason('late') as Error;
      assert.ok(reason instanceof Error);
      assert.equal(reason.name, 'TimeoutError');
    } finally {
      globalThis.DOMException = original;
    }
    assert.equal((timeoutReason('late') as DOMException).name, 'TimeoutError');
  });

  it('unsubscribes abort listeners once', () => {
    const controller = new AbortController();
    let calls = 0;
    const stop = onAbort(controller.signal, () => calls++);
    stop();
    stop();
    controller.abort();
    assert.equal(calls, 0);
    assert.equal(onAbort(undefined, () => calls++)(), undefined);
  });

  it('chunks very long timer delays', async () => {
    const clock = new FakeClock();
    let fired = false;
    schedule(clock, 2 ** 31 + 10, () => {
      fired = true;
    });
    await clock.advance(2 ** 31 - 1);
    assert.equal(fired, false);
    await clock.advance(11);
    assert.equal(fired, true);
    const cancel = schedule(clock, 2 ** 32, () => {
      fired = false;
    });
    cancel();
    cancel();
    await clock.advance(2 ** 33);
    assert.equal(fired, true);
  });

  it('ignores a chunked timer cancelled between chunks', async () => {
    const clock = new FakeClock();
    let fired = false;
    const cancel = schedule(clock, 2 ** 31 + 10, () => {
      fired = true;
    });
    await clock.advance(2 ** 31 - 1);
    cancel();
    await clock.advance(100);
    assert.equal(fired, false);
  });

  it('uses the system clock with real timers', async () => {
    assert.equal(typeof systemClock.now(), 'number');
    const value = systemClock.random();
    assert.ok(value >= 0 && value < 1);
    const handle = systemClock.setTimeout(() => assert.fail('cleared timer fired'), 5);
    systemClock.clearTimeout(handle);
    const result = await withResilience(() => new Promise(() => {}), { attemptTimeoutMs: 5 });
    assert.equal(result.ok, false);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('removes nodes from a linked queue in any position', () => {
    const queue = new LinkedQueue<number>();
    const a = queue.push(1);
    const b = queue.push(2);
    const c = queue.push(3);
    assert.equal(queue.remove(b), true);
    assert.equal(queue.remove(b), false);
    assert.equal(queue.remove(c), true);
    assert.equal(queue.remove(a), true);
    assert.equal(queue.shift(), undefined);
    queue.push(4);
    queue.push(5);
    assert.deepEqual(queue.drain(), [4, 5]);
    assert.equal(queue.size, 0);
  });
});
